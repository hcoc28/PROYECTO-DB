// ============================================================
// API — POST /api/v1/auth/login
// Verifica usuario y contraseña, y devuelve el token de sesión.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "../../base-de-datos/prisma";
import { emitirAccessToken, ErrorApi, type Rol } from "../../seguridad/auth";
import { cuentaBloqueada, MINUTOS_DE_BLOQUEO, registrarLogin } from "../../seguridad/bloqueo";
import { NOMBRE_COOKIE_SESION, opcionesCookieSesion } from "../../seguridad/sesion-cookie";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest } from "../../seguridad/audit";

// POST /api/v1/auth/login
// Body: { nombreUsuario, password }
// 200: { ok, datos: { accessToken, usuario } }

const esquema = z.object({
  nombreUsuario: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
});

export const POST = manejarErrores(async (req: NextRequest) => {
  const { nombreUsuario, password } = esquema.parse(await req.json());
  const ctx = contextoRequest(req);

  const usuario = await prisma.usuario.findUnique({
    where: { nombre_usuario: nombreUsuario },
    include: { rol: true },
  });

  // Verificación en tiempo constante aun si el usuario no existe
  // (evita enumeración de cuentas por timing).
  // Cuenta bloqueada por demasiados intentos fallidos: ni se revisa la contraseña
  if (await cuentaBloqueada(nombreUsuario)) {
    await registrarLogin(nombreUsuario, "LOGIN_BLOQUEADO", ctx.ip);
    throw new ErrorApi(
      429,
      "CUENTA_BLOQUEADA",
      `Demasiados intentos fallidos. Intenta de nuevo en ${MINUTOS_DE_BLOQUEO} minutos.`
    );
  }

  const hashDummy = "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const valido = await argon2
    .verify(usuario?.contrasena ?? hashDummy, password)
    .catch(() => false);

  if (!usuario || !usuario.activo || !valido) {
    // Queda en la bitácora aunque el usuario no exista (se guarda el nombre intentado)
    await registrarLogin(nombreUsuario, "LOGIN_FALLIDO", ctx.ip);
    throw new ErrorApi(401, "CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos");
  }

  const accessToken = await emitirAccessToken(
    { usuarioId: usuario.id_usuario, rol: usuario.rol.nombre_rol as Rol, nombreUsuario: usuario.nombre_usuario },
    usuario.version_sesion
  );

  await registrarLogin(nombreUsuario, "LOGIN", ctx.ip);

  // El token va en una cookie httpOnly: el JavaScript de la pagina nunca lo ve (ni lo puede robar)
  const respuesta = respuestaOk({
    usuario: {
      id_usuario: usuario.id_usuario,
      nombre_usuario: usuario.nombre_usuario,
      rol: usuario.rol.nombre_rol,
    },
  });
  respuesta.cookies.set({ name: NOMBRE_COOKIE_SESION, value: accessToken, ...opcionesCookieSesion() });
  return respuesta;
});
