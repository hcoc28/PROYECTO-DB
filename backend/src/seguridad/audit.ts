// ============================================================
// LIBRERÍA — bitácora (auditoría)
// Guarda en la tabla "bitacora" cada acción importante:
// quién la hizo, cuándo y desde qué IP.
// ============================================================

import type { NextRequest } from "next/server";
import { prisma } from "../base-de-datos/prisma";
import { ipDelCliente } from "./cliente";

// ============================================================
// Auditoría: registro append-only de TODA acción relevante.
// La tabla real es "bitacora" (id_bitacora, id_usuario, accion,
// detalle, ip, fecha) — más simple que el diseño original, así
// que aquí se resume todo en accion + detalle (texto libre).
// La aplicación solo INSERTA en esta tabla (nunca actualiza ni borra). El
// trigger tr_inmutable_bitacora (05_triggers.sql) lo impide a nivel de base de datos.
// Ademas de los cambios, se anota QUIEN CONSULTA informacion sensible (acciones LEER_*).
// ============================================================

export interface EventoAuditoria {
  usuarioId?: number | null;
  accion:
    | "CREAR_FACTURA"
    | "CERTIFICAR"
    | "ANULAR"
    | "PAGAR"
    | "LOGIN"
    | "LOGIN_FALLIDO"
    | "LOGIN_BLOQUEADO"
    | "LOGOUT"
    | "CREAR_USUARIO"
    | "ACTUALIZAR_USUARIO"
    | "CAMBIAR_CONTRASENA"
    | "CREAR_CLIENTE"
    | "ACTUALIZAR_CLIENTE"
    | "ACTUALIZAR_SERIE"
    | "CREAR_PRODUCTO"
    | "ACTUALIZAR_PRODUCTO"
    | "ACTUALIZAR_NEGOCIO"
    // Lecturas de informacion sensible (quien consulto que)
    | "LEER_ESTADO_CUENTA"
    | "LEER_USUARIOS"
    | "LEER_BITACORA"
    | "LEER_REPORTE_VENTAS";
  detalle?: string;
}

export function contextoRequest(req: NextRequest) {
  return { ip: ipDelCliente(req) };
}

export async function registrarAuditoria(
  evento: EventoAuditoria,
  contexto?: { ip?: string | null }
): Promise<void> {
  try {
    // La bitácora exige id_usuario (NOT NULL); si no hay usuario
    // (ej. login fallido de una cuenta inexistente) no se puede
    // insertar una fila real — se deja constancia solo en logs.
    if (evento.usuarioId == null) {
      console.warn("[BITACORA] Evento sin usuario, no se persiste:", evento.accion, evento.detalle);
      return;
    }
    await prisma.bitacora.create({
      data: {
        id_usuario: evento.usuarioId,
        accion: evento.accion,
        detalle: evento.detalle?.slice(0, 500) ?? null,
        ip: contexto?.ip ?? null,
        fecha: new Date(),
      },
    });
  } catch (err) {
    // La auditoría no debe tumbar la operación de negocio, pero sí alertar.
    console.error("[BITACORA] Fallo al registrar evento:", err);
  }
}
