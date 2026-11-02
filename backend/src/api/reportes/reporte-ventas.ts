// ============================================================
// API — GET /api/v1/reportes/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Libro de ventas y resumen: suma las facturas válidas del rango
// (pendientes y certificadas; las anuladas y rechazadas no cuentan)
// y RESTA las notas de crédito. Solo para el ADMIN.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../base-de-datos/prisma";
import { aFacturaLista, DOCUMENTOS_VENTA, incluirFacturaLista } from "../../base-de-datos/adaptadores";
import { exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";

const MAX_FILAS = 1000;
// Solo cuentan los documentos CERTIFICADOS. Las notas de débito suman; las de crédito restan.
const SUMAN = [...DOCUMENTOS_VENTA, "NDEB"];

const esquema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function aDecimal(valor: unknown): Decimal {
  return new Decimal(valor == null ? 0 : String(valor));
}

export const GET = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN", "GERENTE");
  const { desde, hasta } = esquema.parse(Object.fromEntries(req.nextUrl.searchParams));

  // Guatemala no cambia de horario: siempre UTC-6. Así "hoy" abarca
  // el día completo de Guatemala y no el día UTC.
  const where: Prisma.facturaWhereInput = {
    fecha_emision: {
      gte: new Date(`${desde}T00:00:00.000-06:00`),
      lte: new Date(`${hasta}T23:59:59.999-06:00`),
    },
    estado: "CERTIFICADA",
  };
  const campos = { subtotal_gravado: true, subtotal_exento: true, iva_total: true, total: true } as const;

  const [ventas, devoluciones, facturas] = await Promise.all([
    prisma.factura.aggregate({ where: { ...where, serie_documento: { codigo_dte: { in: SUMAN } } }, _sum: campos, _count: true }),
    prisma.factura.aggregate({ where: { ...where, serie_documento: { codigo_dte: "NCRE" } }, _sum: campos, _count: true }),
    prisma.factura.findMany({
      where,
      include: incluirFacturaLista,
      orderBy: { fecha_emision: "desc" },
      take: MAX_FILAS,
    }),
  ]);

  await registrarAuditoria({ usuarioId: sesion.usuarioId, accion: "LEER_REPORTE_VENTAS", detalle: `${desde} a ${hasta}` }, contextoRequest(req));

  const subtotal = (g: typeof ventas) => aDecimal(g._sum.subtotal_gravado).plus(aDecimal(g._sum.subtotal_exento));
  const restar = (campo: "iva_total" | "total") =>
    aDecimal(ventas._sum[campo]).minus(aDecimal(devoluciones._sum[campo])).toFixed(2);
  const cantidad = ventas._count + devoluciones._count;

  return respuestaOk({
    desde,
    hasta,
    totales: {
      cantidad,
      subtotal: subtotal(ventas).minus(subtotal(devoluciones)).toFixed(2),
      iva: restar("iva_total"),
      total: restar("total"),
    },
    facturas: facturas.map(aFacturaLista),
    hayMas: cantidad > MAX_FILAS,
  });
});
