// ============================================================
// SEGURIDAD — bloqueo de cuenta por intentos fallidos
// La regla vive en la BASE DE DATOS (procedimientos usp_login_bloqueado y
// usp_registrar_login, en 10_seguridad_db.sql): 5 intentos fallidos en 15 minutos
// bloquean la cuenta. Funciona tambien con nombres de usuario que no existen.
// Aqui solo se llaman esos procedimientos.
// ============================================================

import { prisma } from "../base-de-datos/prisma";

export const MINUTOS_DE_BLOQUEO = 15;

export type ResultadoLogin = "LOGIN" | "LOGIN_FALLIDO" | "LOGIN_BLOQUEADO";

/** Pregunta a la base de datos si la cuenta esta bloqueada. */
export async function cuentaBloqueada(nombreUsuario: string): Promise<boolean> {
  const filas = await prisma.$queryRaw<{ bloqueado: boolean }[]>`
    DECLARE @b BIT;
    EXEC dbo.usp_login_bloqueado ${nombreUsuario}, @b OUTPUT;
    SELECT @b AS bloqueado`;
  return Boolean(filas[0]?.bloqueado);
}

/** Anota el resultado de un intento de login en la bitacora (la base de datos genera las alertas). */
export async function registrarLogin(nombreUsuario: string, resultado: ResultadoLogin, ip?: string | null): Promise<void> {
  try {
    await prisma.$executeRaw`EXEC dbo.usp_registrar_login ${nombreUsuario}, ${resultado}, ${ip ?? ""}`;
  } catch (err) {
    console.error("[BITACORA] Fallo al registrar el login:", err);
  }
}
