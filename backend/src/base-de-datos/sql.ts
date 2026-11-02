// ============================================================
// LIBRERÍA — acceso a la lógica que vive en SQL Server
// - conUsuario(): ejecuta operaciones fijando QUIÉN las hace, para
//   que los triggers de historial y auditoría lo registren.
// - traducirErrorBd(): convierte los errores que lanzan los triggers
//   y procedimientos (códigos 51xxx) en errores de la API.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ErrorApi } from "../seguridad/auth";

export type Tx = Prisma.TransactionClient;

/**
 * Parámetro opcional de un EXEC: si no hay valor se OMITE (el procedimiento usa su valor por defecto).
 * Hace falta porque Prisma envía un NULL como entero, y SQL Server no lo convierte a DATE/DATETIMEOFFSET.
 * Uso: Prisma.sql`EXEC dbo.usp @a = ${a}${opcional("@b", b)}`
 */
export function opcional(nombre: string, valor: unknown): Prisma.Sql {
  return valor == null ? Prisma.empty : Prisma.sql`${Prisma.raw(`, ${nombre} = `)}${valor}`;
}

/**
 * Ejecuta `fn` dentro de una transacción en la que SESSION_CONTEXT('id_usuario')
 * vale `usuarioId`. Los procedimientos almacenados ya lo hacen por su cuenta;
 * esto es para las escrituras directas a tablas (clientes, productos, usuarios…),
 * cuyos triggers de auditoría necesitan saber quién hizo el cambio.
 */
export async function conUsuario<T>(usuarioId: number | null | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      if (usuarioId != null) {
        await tx.$executeRaw`EXEC sys.sp_set_session_context @key = N'id_usuario', @value = ${usuarioId}`;
      }
      return fn(tx);
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

// ------------------------------------------------------------
// Errores de la base de datos
// ------------------------------------------------------------

// código SQL -> [status HTTP, código de la API]. Lo no listado en 51xxx cae en 422 REGLA_DE_NEGOCIO.
const CODIGOS: Record<number, [number, string]> = {
  51020: [422, "STOCK_INSUFICIENTE"],
  51021: [422, "STOCK_INSUFICIENTE"],
  51022: [409, "STOCK_PROTEGIDO"],
  51030: [409, "DOCUMENTO_BLOQUEADO"],
  51041: [409, "DOCUMENTO_BLOQUEADO"],
  51042: [409, "TRANSICION_INVALIDA"],
  51043: [422, "DOCUMENTO_INVALIDO"],
  51044: [422, "REFERENCIA_INVALIDA"],
  51045: [422, "NOTA_EXCEDE_FACTURA"],
  51046: [409, "ANULACION_BLOQUEADA"],
  51047: [409, "NO_SE_BORRA"],
  51053: [409, "NO_SE_BORRA"],
  51051: [422, "REFERENCIA_REQUERIDA"],
  51060: [409, "COBRO_ANULADO"],
  51061: [409, "FACTURA_NO_COBRABLE"],
  51062: [422, "SOBREPAGO"],
  51063: [422, "SOBREPAGO"],
  51100: [404, "SERIE_INVALIDA"],
  51101: [404, "PRODUCTO_NO_ENCONTRADO"],
  51102: [404, "FACTURA_NO_ENCONTRADA"],
  51103: [404, "FACTURA_NO_ENCONTRADA"],
  51110: [409, "FACTURA_NO_COBRABLE"],
  51111: [409, "CLIENTE_DISTINTO"],
  51112: [422, "SOBREPAGO"],
  51114: [409, "COBRO_NO_ANULABLE"],
  51131: [409, "SIMULADOR_DESHABILITADO"],
  51142: [404, "PRODUCTO_NO_ENCONTRADO"],
  51150: [404, "CLIENTE_NO_ENCONTRADO"],
  51151: [409, "CLIENTE_PROTEGIDO"],
  51152: [409, "CLIENTE_CON_COMPRAS"],
};

/** Extrae el número y el texto del error de SQL Server que devuelve Prisma, si es uno nuestro (51xxx). */
function extraer(err: unknown): { numero: number; mensaje: string } | null {
  const e = err as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null;
  if (!e) return null;
  const texto = `${e.meta?.message ?? ""} ${e.message ?? ""}`;
  const numero = Number(e.meta?.code) || Number(/\b(51\d{3})\b/.exec(texto)?.[1]);
  if (!numero || numero < 51000 || numero > 51999) return null;

  // Mensaje legible: lo que está entre comillas invertidas tras "Message:", o el texto sin el prefijo de Prisma
  const m = /Message:\s*`([\s\S]*?)`(?:\s|$)/.exec(texto);
  const limpio = (m?.[1] ?? e.meta?.message ?? e.message ?? "").replace(/^Raw query failed\.\s*Code:\s*`?\d+`?\.\s*Message:\s*`?/i, "");
  return { numero, mensaje: limpio.replace(/`$/, "").trim() };
}

export function traducirErrorBd(err: unknown): ErrorApi | null {
  // El NIT, CUI o pasaporte no tiene un formato valido (restriccion de la tabla cliente)
  const e = err as { message?: string; meta?: { message?: string } } | null;
  if (`${e?.meta?.message ?? ""} ${e?.message ?? ""}`.includes("ck_cliente_formato_documento")) {
    return new ErrorApi(422, "DOCUMENTO_INVALIDO", "El NIT, CUI o pasaporte no tiene un formato valido (CUI: 13 digitos; NIT: digitos y al final un digito o K).");
  }
  const x = extraer(err);
  if (!x) return null;
  const [status, codigo] = CODIGOS[x.numero] ?? [422, "REGLA_DE_NEGOCIO"];
  return new ErrorApi(status, codigo, x.mensaje, { codigoBd: x.numero });
}
