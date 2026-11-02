// ============================================================
// API — POST /api/v1/auth/cambiar-password
// Cada persona cambia SU propia contraseña (admin, cajero o gerente).
// Exige la contraseña actual: si alguien deja la sesión abierta, no puede
// cambiarla sin saberla. Se cumple la misma política que al crear usuarios.
// Body: { actual, nueva }
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { emitirAccessToken, ErrorApi, sesionDesdeRequest } from "../../seguridad/auth";
import { NOMBRE_COOKIE_SESION, opcionesCookieSesion } from "../../seguridad/sesion-cookie";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { esquemaContrasena } from "../../seguridad/contrasena";

const esquema = z.object({
  actual: z.string().min(1).max(200),
  nueva: esquemaContrasena,
});

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  const input = esquema.parse(await req.json());

  const usuario = await prisma.usuario.findUnique({ where: { id_usuario: sesion.usuarioId } });
  if (!usuario || !usuario.activo) throw new ErrorApi(401, "NO_AUTORIZADO", "La sesión ya no es válida");

  // 400 y no 401: un 401 haria que la pantalla cierre la sesion, y aqui solo se equivoco al escribir
  const correcta = await argon2.verify(usuario.contrasena, input.actual).catch(() => false);
  if (!correcta) throw new ErrorApi(400, "CONTRASENA_ACTUAL_INCORRECTA", "La contraseña actual no es correcta");
  if (input.actual === input.nueva) throw new ErrorApi(400, "CONTRASENA_IGUAL", "La contraseña nueva debe ser distinta de la actual");

  const hash = await argon2.hash(input.nueva, { type: argon2.argon2id });
  // Al subir version_sesion se cierran las demas sesiones abiertas de esta persona (la de un posible intruso incluida)
  const actualizado = await conUsuario(sesion.usuarioId, (tx) =>
    tx.usuario.update({
      where: { id_usuario: sesion.usuarioId },
      data: { contrasena: hash, version_sesion: { increment: 1 } },
      select: { version_sesion: true },
    })
  );

  await registrarAuditoria({ usuarioId: sesion.usuarioId, accion: "CAMBIAR_CONTRASENA" }, contextoRequest(req));

  // Quien cambia su clave sigue dentro: se le da un token nuevo con la version actualizada
  const respuesta = respuestaOk({ cambiada: true });
  const token = await emitirAccessToken(sesion, actualizado.version_sesion);
  respuesta.cookies.set({ name: NOMBRE_COOKIE_SESION, value: token, ...opcionesCookieSesion() });
  return respuesta;
});
