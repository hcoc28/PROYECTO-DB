// ============================================================
// API — /api/v1/usuarios/{id}
// PUT: cambia el rol, activa/desactiva o restablece la contraseña
//      de un usuario (solo ADMIN).
// Reglas de seguridad: nadie puede quitarse su propio acceso y
// siempre debe quedar al menos un administrador activo.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { esquemaContrasena } from "../../seguridad/contrasena";

type Params = { params: Promise<{ id: string }> };

const esquema = z.object({
  activo: z.boolean().optional(),
  nombre_rol: z.enum(["ADMIN", "CAJERO", "GERENTE"]).optional(),
  password: esquemaContrasena.optional(),
});

export const PUT = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErrorApi(400, "ID_INVALIDO", "Identificador de usuario inválido");
  const input = esquema.parse(await req.json());

  const usuario = await prisma.usuario.findUnique({ where: { id_usuario: id }, include: { rol: true } });
  if (!usuario) throw new ErrorApi(404, "USUARIO_NO_ENCONTRADO", "El usuario no existe");

  const quitaAcceso = input.activo === false || (input.nombre_rol && input.nombre_rol !== "ADMIN");
  if (id === sesion.usuarioId && quitaAcceso) {
    throw new ErrorApi(409, "AUTO_BLOQUEO", "No puedes desactivarte ni quitarte el rol de administrador a ti mismo");
  }

  // Siempre debe quedar al menos un ADMIN activo
  if (usuario.rol.nombre_rol === "ADMIN" && usuario.activo && quitaAcceso) {
    const otros = await prisma.usuario.count({
      where: { activo: true, rol: { nombre_rol: "ADMIN" }, id_usuario: { not: id } },
    });
    if (otros === 0) throw new ErrorApi(409, "ULTIMO_ADMIN", "Debe quedar al menos un administrador activo");
  }

  const data: { activo?: boolean; id_rol?: number; contrasena?: string; version_sesion?: { increment: number } } = {};
  const cambios: string[] = [];

  if (input.activo !== undefined && input.activo !== usuario.activo) {
    data.activo = input.activo;
    cambios.push(input.activo ? "reactivado" : "desactivado");
  }
  if (input.nombre_rol && input.nombre_rol !== usuario.rol.nombre_rol) {
    const rol = await prisma.rol.findUnique({ where: { nombre_rol: input.nombre_rol } });
    if (!rol) throw new ErrorApi(404, "ROL_NO_ENCONTRADO", "Rol no existe");
    data.id_rol = rol.id_rol;
    cambios.push(`rol ${usuario.rol.nombre_rol} → ${input.nombre_rol}`);
  }
  if (input.password) {
    data.contrasena = await argon2.hash(input.password, { type: argon2.argon2id });
    data.version_sesion = { increment: 1 }; // si la clave se restablece porque alguien la conocia, sus sesiones abiertas se cierran
    cambios.push("contraseña restablecida");
  }
  if (cambios.length === 0) return respuestaOk({ sinCambios: true });

  const actualizado = await conUsuario(sesion.usuarioId, (tx) =>
    tx.usuario.update({
      where: { id_usuario: id },
      data,
      select: { id_usuario: true, nombre_usuario: true, activo: true, rol: { select: { nombre_rol: true } } },
    })
  );

  await registrarAuditoria(
    { usuarioId: sesion.usuarioId, accion: "ACTUALIZAR_USUARIO", detalle: `${usuario.nombre_usuario}: ${cambios.join("; ")}` },
    contextoRequest(req)
  );

  return respuestaOk({ usuario: actualizado });
});
