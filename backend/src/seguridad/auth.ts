// ============================================================
// LIBRERÍA — sesión y permisos
// Crear/verificar el token de sesión (JWT) y comprobar el rol
// de quien hace la petición (ADMIN vs CAJERO). La usan casi
// todas las rutas de la API.
// ============================================================

import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { prisma } from "../base-de-datos/prisma";
import { tokenDeLaPeticion } from "./cliente";

// ============================================================
// Autenticación JWT con `jose`, para un solo negocio.
// Roles reales en la tabla rol: ADMIN (dueño/encargado), CAJERO (vende y cobra) y GERENTE (solo consulta: ve todo y los reportes, no opera).
// El login es por nombre_usuario (no hay columna de correo).
// ============================================================

export type Rol = "ADMIN" | "CAJERO" | "GERENTE";

export interface SesionUsuario {
  usuarioId: number;
  rol: Rol;
  nombreUsuario: string;
}

const encoder = new TextEncoder();

function secreto(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET no configurado o demasiado corto");
  return encoder.encode(s);
}

/**
 * `versionSesion` es el contador del usuario en la base de datos (usuario.version_sesion). Va dentro del token:
 * al cerrar sesion o cambiar la contrasena el contador sube y los tokens anteriores dejan de valer,
 * aunque no hayan vencido (un token robado no sirve despues de salir).
 */
export async function emitirAccessToken(sesion: SesionUsuario, versionSesion: number): Promise<string> {
  const ttlMin = Number(process.env.JWT_ACCESS_TTL_MIN ?? 480); // jornada laboral
  return new SignJWT({ rol: sesion.rol, nombreUsuario: sesion.nombreUsuario, sv: versionSesion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(sesion.usuarioId))
    .setIssuer(process.env.JWT_ISSUER ?? "fel-negocio-gt")
    .setIssuedAt()
    .setExpirationTime(`${ttlMin}m`)
    .sign(secreto());
}

export async function verificarToken(token: string): Promise<SesionUsuario & { versionSesion: number }> {
  const { payload } = await jwtVerify(token, secreto(), {
    issuer: process.env.JWT_ISSUER ?? "fel-negocio-gt",
  });
  const usuarioId = Number(payload.sub);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0 || usuarioId > 2147483647) throw new Error("sub inválido");
  return {
    usuarioId,
    rol: payload.rol as Rol,
    nombreUsuario: payload.nombreUsuario as string,
    versionSesion: typeof payload.sv === "number" ? payload.sv : 0, // los tokens anteriores a este cambio no traen version
  };
}

/**
 * Extrae y valida la sesión desde la petición.
 * Lanza ErrorApi(401) si no hay token válido.
 */
export async function sesionDesdeRequest(req: NextRequest): Promise<SesionUsuario> {
  // El token viaja en la cookie de sesión (o en la cabecera Authorization para clientes de API)
  const token = tokenDeLaPeticion(req);
  if (!token) {
    throw new ErrorApi(401, "AUTH_REQUERIDA", "Se requiere iniciar sesión");
  }

  let sesion: SesionUsuario & { versionSesion: number };
  try {
    sesion = await verificarToken(token);
  } catch {
    throw new ErrorApi(401, "TOKEN_INVALIDO", "Sesión expirada o inválida");
  }

  // El token es una "credencial" que ya se firmo; por si despues pasaron cosas (el usuario se
  // desactivo, le cambiaron el rol) se confirma en la base de datos EN CADA PETICION.
  // Asi desactivar a alguien le quita el acceso al instante, no hasta que caduque su token.
  const usuario = await prisma.usuario.findUnique({
    where: { id_usuario: sesion.usuarioId },
    select: { activo: true, nombre_usuario: true, version_sesion: true, rol: { select: { nombre_rol: true } } },
  });
  if (!usuario || !usuario.activo) {
    throw new ErrorApi(401, "SESION_INVALIDA", "Tu usuario ya no tiene acceso. Inicia sesión de nuevo.");
  }

  // Si la persona cerro sesion (o le cambiaron la contraseña) despues de emitido este token, ya no vale
  if (sesion.versionSesion !== usuario.version_sesion) {
    throw new ErrorApi(401, "SESION_CERRADA", "Tu sesión fue cerrada. Inicia sesión de nuevo.");
  }

  // Se usa el rol ACTUAL de la base de datos, no el que venia escrito en el token
  return { usuarioId: sesion.usuarioId, rol: usuario.rol.nombre_rol as Rol, nombreUsuario: usuario.nombre_usuario };
}

/** Verifica que el rol de la sesión esté permitido. */
export function exigirRol(sesion: SesionUsuario, ...roles: Rol[]): void {
  if (!roles.includes(sesion.rol)) {
    throw new ErrorApi(403, "PERMISO_DENEGADO", `Requiere rol: ${roles.join(", ")}`);
  }
}

// ------------------------------------------------------------
// Error tipado de API (ver src/lib/api.ts para el manejador)
// ------------------------------------------------------------
export class ErrorApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensaje: string,
    public detalles?: unknown
  ) {
    super(mensaje);
  }
}
