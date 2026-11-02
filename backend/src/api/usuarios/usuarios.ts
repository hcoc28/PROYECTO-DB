// ============================================================
// API — /api/v1/usuarios
// GET:  lista los usuarios del sistema (solo ADMIN).
// POST: crea un usuario nuevo, ej. un cajero (solo ADMIN).
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

// GET  /api/v1/usuarios → listado (solo ADMIN)
// POST /api/v1/usuarios → crear cajero/admin (solo ADMIN)

export const GET = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");

  const usuarios = await prisma.usuario.findMany({
    select: { id_usuario: true, nombre_usuario: true, activo: true, rol: { select: { nombre_rol: true } } },
    orderBy: { nombre_usuario: "asc" },
  });
  await registrarAuditoria({ usuarioId: sesion.usuarioId, accion: "LEER_USUARIOS" }, contextoRequest(req));
  return respuestaOk({ usuarios });
});

const esquemaCrear = z.object({
  nombre_usuario: z.string().min(3).max(50),
  password: esquemaContrasena,
  nombre_rol: z.enum(["ADMIN", "CAJERO", "GERENTE"]),
});

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const input = esquemaCrear.parse(await req.json());

  const rol = await prisma.rol.findUnique({ where: { nombre_rol: input.nombre_rol } });
  if (!rol) throw new ErrorApi(404, "ROL_NO_ENCONTRADO", "Rol no existe");

  const existente = await prisma.usuario.findUnique({ where: { nombre_usuario: input.nombre_usuario } });
  if (existente) throw new ErrorApi(409, "USUARIO_EXISTE", "Ese nombre de usuario ya está en uso");

  const hash = await argon2.hash(input.password, { type: argon2.argon2id });

  const usuario = await conUsuario(sesion.usuarioId, (tx) =>
    tx.usuario.create({
      data: { nombre_usuario: input.nombre_usuario, contrasena: hash, id_rol: rol.id_rol, activo: true },
      select: { id_usuario: true, nombre_usuario: true, activo: true },
    })
  );

  await registrarAuditoria({
    usuarioId: sesion.usuarioId,
    accion: "CREAR_USUARIO",
    detalle: `${usuario.nombre_usuario} (${input.nombre_rol})`,
  });

  return respuestaOk({ usuario }, 201);
});
