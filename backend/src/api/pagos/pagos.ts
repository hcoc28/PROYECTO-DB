// ============================================================
// API — /api/v1/pagos
// POST: registra un pago (o abono) sobre una factura certificada.
// GET:  lista el historial de pagos con filtros y un resumen
//       (total cobrado, por método de pago) para el corte de caja.
// En la base de datos un pago es un COBRO (el recibo) aplicado a la
// factura (cobro_aplicacion). Las reglas —saldo, sobrepago, factura
// cobrable, referencia obligatoria— las hacen cumplir sus triggers.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../base-de-datos/prisma";
import { dinero } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { METODOS_COBRO, registrarCobro } from "../../servicios/cobros";

const esquemaPago = z
  .object({
    facturaId: z.number().int().positive().optional(),
    facturaUuid: z.string().max(80).optional(),
    metodo: z.enum(METODOS_COBRO),
    monto: z.number().positive(),
    referencia: z.string().max(100).optional(),
  })
  .refine((v) => v.facturaId || v.facturaUuid, { message: "Indique la factura (facturaId o facturaUuid)" });

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "CAJERO", "ADMIN");
  const input = esquemaPago.parse(await req.json());

  const factura = await prisma.factura.findFirst({
    where: input.facturaId ? { id_factura: BigInt(input.facturaId) } : { uuid_fel: input.facturaUuid },
    include: { serie_documento: true },
  });
  if (!factura) throw new ErrorApi(404, "FACTURA_NO_ENCONTRADA", "Factura no encontrada");

  // La referencia del banco es opcional; si un método se configura con requiere_referencia = 1, la base la exige
  if (input.monto > Number(factura.saldo_pendiente) + 0.01 && factura.estado === "CERTIFICADA") {
    throw new ErrorApi(422, "SOBREPAGO", `El pago excede el saldo pendiente (Q${dinero(factura.saldo_pendiente)})`);
  }

  const idCobro = await registrarCobro({
    usuarioId: sesion.usuarioId,
    idFactura: factura.id_factura,
    metodo: input.metodo,
    monto: input.monto,
    referencia: input.referencia,
  });

  const [cobro, actual] = await Promise.all([
    prisma.cobro.findUniqueOrThrow({ where: { id_cobro: BigInt(idCobro) } }),
    prisma.factura.findUniqueOrThrow({ where: { id_factura: factura.id_factura }, select: { saldo_pendiente: true } }),
  ]);

  await registrarAuditoria(
    {
      usuarioId: sesion.usuarioId,
      accion: "PAGAR",
      detalle: `Q${input.monto} (${input.metodo}) a ${factura.serie_documento.codigo_dte}-${factura.serie_documento.serie_interna} #${factura.numero_interno}`,
    },
    contextoRequest(req)
  );

  return respuestaOk(
    {
      pago: {
        id_pago: idCobro,
        id_factura: Number(factura.id_factura),
        fecha_pago: cobro.fecha_cobro,
        monto: dinero(cobro.monto),
        metodo_pago: cobro.codigo_metodo,
        referencia: cobro.referencia,
      },
      saldoRestante: dinero(actual.saldo_pendiente),
    },
    201
  );
});

const esquemaFiltros = z.object({
  metodo: z.enum(METODOS_COBRO).optional(),
  facturaId: z.coerce.number().int().optional(),
  q: z.string().max(100).optional(), // cliente, NIT o referencia
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  anuladas: z.enum(["1", "0"]).optional(), // "1" = incluir los cobros anulados
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = manejarErrores(async (req: NextRequest) => {
  await sesionDesdeRequest(req);
  const f = esquemaFiltros.parse(Object.fromEntries(req.nextUrl.searchParams));

  const where: Prisma.cobro_aplicacionWhereInput = {
    ...(f.facturaId && { id_factura: BigInt(f.facturaId) }),
    cobro: {
      ...(f.anuladas !== "1" && { estado: "APLICADO" }),
      ...(f.metodo && { codigo_metodo: f.metodo }),
      ...((f.desde || f.hasta) && {
        fecha_cobro: { ...(f.desde && { gte: f.desde }), ...(f.hasta && { lte: f.hasta }) },
      }),
    },
    ...(f.q && {
      OR: [
        { cobro: { referencia: { contains: f.q } } },
        { factura: { cliente: { nombre_cliente: { contains: f.q } } } },
        { factura: { cliente: { documento: { contains: f.q } } } },
      ],
    }),
  };

  const [total, aplicaciones, montos] = await Promise.all([
    prisma.cobro_aplicacion.count({ where }),
    prisma.cobro_aplicacion.findMany({
      where,
      include: {
        cobro: true,
        factura: { include: { serie_documento: true, cliente: true } },
      },
      orderBy: { fecha: "desc" },
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
    // El resumen cubre TODO el filtro, no solo la página que se ve
    prisma.cobro_aplicacion.findMany({ where, select: { monto: true, cobro: { select: { codigo_metodo: true } } } }),
  ]);

  const porMetodo = Object.fromEntries(
    METODOS_COBRO.map((m) => {
      const filas = montos.filter((x) => x.cobro.codigo_metodo === m);
      return [m, { monto: filas.reduce((a, x) => a + Number(x.monto), 0).toFixed(2), cantidad: filas.length }];
    })
  );

  return respuestaOk({
    pagos: aplicaciones.map((a) => ({
      id_pago: Number(a.id_aplicacion),
      id_cobro: Number(a.id_cobro),
      fecha_pago: a.cobro.fecha_cobro,
      monto: dinero(a.monto),
      metodo_pago: a.cobro.codigo_metodo,
      referencia: a.cobro.referencia,
      estado: a.cobro.estado,
      factura: {
        id_factura: Number(a.factura.id_factura),
        uuid_fel: a.factura.uuid_fel,
        serie_fel: a.factura.serie_fel,
        numero_fel: a.factura.numero_fel,
        numero: String(a.factura.numero_interno),
        estado: a.factura.estado,
        total: dinero(a.factura.total),
        serie: { tipo_documento: a.factura.serie_documento.codigo_dte, serie: a.factura.serie_documento.serie_interna },
        cliente: { nombre_cliente: a.factura.cliente.nombre_cliente, nit: a.factura.cliente.documento },
      },
    })),
    resumen: {
      total: montos.reduce((a, x) => a + Number(x.monto), 0).toFixed(2),
      cantidad: total,
      porMetodo,
    },
    paginacion: { pagina: f.pagina, porPagina: f.porPagina, total, paginas: Math.ceil(total / f.porPagina) },
  });
});
