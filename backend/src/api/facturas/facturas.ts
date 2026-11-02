// ============================================================
// API — /api/v1/facturas
// POST: crea una factura y la envía a certificar a la SAT.
// GET:  lista el historial de facturas con filtros.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../base-de-datos/prisma";
import { aFacturaLista, estadosBd, incluirFacturaLista } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { certificarFactura, crearFactura, exigirPreciosDelCatalogo } from "../../servicios/facturacion";
import { contextoRequest } from "../../seguridad/audit";

// ============================================================
// POST /api/v1/facturas  → crea el DTE y lo envía a certificar
// GET  /api/v1/facturas  → historial con filtros
// ============================================================

const esquemaItem = z.object({
  id_producto: z.number().int().positive(),
  cantidad: z.number().int().positive(),
  precioUnitario: z.number().nonnegative().optional(),
  descuento: z.number().nonnegative().optional(),
});

const esquemaCrear = z.object({
  id_serie: z.number().int().positive(),
  clienteId: z.number().int().positive().optional(),
  nitReceptor: z.string().max(15).optional(),
  nombreReceptor: z.string().max(100).optional(),
  certificarInmediato: z.boolean().default(true),
  condicionPago: z.enum(["CONTADO", "CREDITO"]).optional(),
  fechaVencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idFacturaReferencia: z.number().int().positive().optional(),
  motivoReferencia: z.string().max(500).optional(),
  items: z.array(esquemaItem).min(1).max(500),
});

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN", "CAJERO");

  const { certificarInmediato, ...input } = esquemaCrear.parse(await req.json());
  if (sesion.rol !== "ADMIN") {
    // Una nota de credito/debito (o cualquier cambio de precio) la autoriza el administrador
    if (input.idFacturaReferencia) throw new ErrorApi(403, "SOLO_ADMIN", "Las notas de crédito y débito las emite un administrador");
    await exigirPreciosDelCatalogo(input.items);
  }
  const factura = await crearFactura(sesion.usuarioId, input, contextoRequest(req).ip);

  let resultado = factura;
  if (certificarInmediato) {
    try {
      resultado = await certificarFactura(factura.id_factura, sesion.usuarioId);
    } catch (err) {
      console.error("[FEL] Certificación inmediata falló, quedará pendiente:", err);
    }
  }

  return respuestaOk({ factura: resultado }, 201);
});

const esquemaFiltros = z.object({
  estado: z.enum(["BORRADOR", "PENDIENTE_CERTIFICACION", "PENDIENTE", "CERTIFICADA", "RECHAZADA", "ANULADA"]).optional(),
  clienteId: z.coerce.number().int().optional(),
  q: z.string().max(100).optional(), // nombre o NIT del cliente, o número de factura
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  montoMin: z.coerce.number().optional(),
  montoMax: z.coerce.number().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = manejarErrores(async (req: NextRequest) => {
  await sesionDesdeRequest(req);
  const f = esquemaFiltros.parse(Object.fromEntries(req.nextUrl.searchParams));

  const where: Prisma.facturaWhereInput = {
    ...(f.estado && { estado: { in: estadosBd(f.estado) } }),
    ...(f.clienteId && { id_cliente: f.clienteId }),
    ...(f.q && {
      OR: [
        { cliente: { nombre_cliente: { contains: f.q } } },
        { cliente: { documento: { contains: f.q } } },
        ...(/^\d{1,15}$/.test(f.q) ? [{ numero_interno: BigInt(f.q) }] : []),
      ],
    }),
    ...((f.desde || f.hasta) && {
      fecha_emision: { ...(f.desde && { gte: f.desde }), ...(f.hasta && { lte: f.hasta }) },
    }),
    ...((f.montoMin != null || f.montoMax != null) && {
      total: { ...(f.montoMin != null && { gte: f.montoMin }), ...(f.montoMax != null && { lte: f.montoMax }) },
    }),
  };

  const [total, facturas] = await Promise.all([
    prisma.factura.count({ where }),
    prisma.factura.findMany({
      where,
      include: incluirFacturaLista,
      orderBy: { fecha_emision: "desc" },
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
  ]);

  return respuestaOk({
    facturas: facturas.map(aFacturaLista),
    paginacion: { pagina: f.pagina, porPagina: f.porPagina, total, paginas: Math.ceil(total / f.porPagina) },
  });
});
