// ============================================================
// LIBRERÍA — respuestas de la API
// Da forma uniforme a toda respuesta { ok, datos } o
// { ok:false, error }, y atrapa errores para que la API
// nunca devuelva un stack trace al navegador.
// ============================================================

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ErrorApi } from "../seguridad/auth";
import { traducirErrorBd } from "../base-de-datos/sql";

// Mensajes de validacion en espanol (por defecto zod los da en ingles)
z.config(z.locales.es());

// ============================================================
// Respuestas estándar de la API (v1)
// Éxito:  { ok: true,  datos: ... }
// Error:  { ok: false, error: { codigo, mensaje, detalles? } }
// Códigos de error documentados en docs/04-api.md
// ============================================================

// SQL Server devuelve BIGINT (ids de factura, de cobro, de bitácora…) como
// BigInt de JS, que JSON.stringify no sabe serializar. Se convierte a número
// (o a texto si no cabe de forma segura) de forma recursiva, SOLO en objetos planos y
// arreglos: los Decimal de Prisma y las Date ya saben serializarse solos
// (tienen su propio toJSON) y no deben reconstruirse a mano, o se rompen.
function serializar(valor: unknown): unknown {
  if (typeof valor === "bigint") return valor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(valor) : valor.toString();
  if (Array.isArray(valor)) return valor.map(serializar);
  if (valor && typeof valor === "object" && valor.constructor === Object) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, serializar(v)]));
  }
  return valor;
}

export function respuestaOk<T>(datos: T, status = 200) {
  return NextResponse.json({ ok: true, datos: serializar(datos) }, { status });
}

export function respuestaError(status: number, codigo: string, mensaje: string, detalles?: unknown) {
  return NextResponse.json(
    { ok: false, error: { codigo, mensaje, ...(detalles ? { detalles } : {}) } },
    { status }
  );
}

/**
 * Envuelve un handler de route para manejo uniforme de errores.
 * Nunca filtra stack traces ni SQL al cliente.
 */
export function manejarErrores<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ErrorApi) {
        return respuestaError(err.status, err.codigo, err.message, err.detalles);
      }
      // req.json() lanza SyntaxError cuando el cuerpo esta vacio o no es JSON: es un error de quien llama, no del servidor
      if (err instanceof SyntaxError) {
        return respuestaError(400, "JSON_INVALIDO", "El cuerpo de la petición no es un JSON válido");
      }
      if (err instanceof ZodError) {
        // Se muestra el primer problema (por ejemplo "La contraseña debe incluir un número")
        const primero = err.issues[0]?.message;
        return respuestaError(
          422,
          "VALIDACION",
          primero && !/^(Required|Invalid)/.test(primero) ? primero : "Datos de entrada inválidos",
          err.flatten().fieldErrors
        );
      }
      // Errores de reglas que lanzan los triggers/procedimientos de la base de datos (códigos 51xxx)
      const deBd = traducirErrorBd(err);
      if (deBd) return respuestaError(deBd.status, deBd.codigo, deBd.message, deBd.detalles);
      console.error("[API] Error no controlado:", err);
      return respuestaError(500, "ERROR_INTERNO", "Error interno del servidor");
    }
  };
}
