// ============================================================
// API — /api/v1/facturas/{uuid o id}
// GET:    consulta UNA factura con todo su detalle (productos,
//         cliente, pagos, saldo y datos del negocio emisor).
// DELETE: anula la factura (requiere motivo). Devuelve la mercadería al
//         inventario y anula sus cobros; si estaba certificada, además
//         se anula ante la SAT. Las reglas las hace cumplir la base de datos.
// El identificador puede ser el UUID de autorización (si lo tiene)
// o el número interno id_factura, que sí existe en TODAS las facturas.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../../base-de-datos/prisma";
import { aFacturaFicha, incluirFacturaFicha } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { anularFactura } from "../../servicios/facturacion";

type Params = { params: Promise<{ uuid: string }> };

function seleccion(identificador: string) {
  return /^\d+$/.test(identificador)
    ? { id_factura: BigInt(identificador) }
    : { uuid_fel: identificador };
}

export const GET = manejarErrores(async (req: NextRequest, { params }: Params) => {
  await sesionDesdeRequest(req);
  const { uuid } = await params;

  const factura = await prisma.factura.findFirst({ where: seleccion(uuid), include: incluirFacturaFicha });
  if (!factura) throw new ErrorApi(404, "FACTURA_NO_ENCONTRADA", "No existe esa factura");

  // Solo los datos públicos del emisor (nunca las llaves del certificador)
  const negocio = await prisma.negocio.findUnique({
    where: { id_negocio: factura.id_negocio },
    select: {
      nit: true,
      razon_social: true,
      nombre_comercial: true,
      direccion: true,
      municipio: true,
      departamento: true,
      certificador: true, // solo el nombre; las llaves nunca salen
    },
  });

  // Quién cambió el estado de la factura y cuándo (lo escribe la base de datos con un trigger)
  const historial = await prisma.historial_estado_factura.findMany({
    where: { id_factura: factura.id_factura },
    include: { usuario: { select: { nombre_usuario: true } } },
    orderBy: { id_historial: "asc" },
  });

  // Notas de crédito que corrigen esta factura. Solo las certificadas descuentan: la base de datos
  // impide que, juntas, superen el total de la factura (error NOTA_EXCEDE_FACTURA).
  const notas = await prisma.factura.findMany({
    where: { id_factura_referencia: factura.id_factura, estado: { not: "ANULADA" }, serie_documento: { codigo_dte: "NCRE" } },
    select: {
      id_factura: true,
      numero_interno: true,
      total: true,
      estado: true,
      serie_documento: { select: { serie_interna: true } },
      detalle_factura: { select: { id_producto: true, cantidad: true } },
    },
    orderBy: { id_factura: "asc" },
  });
  const porProducto: Record<number, number> = {};
  let acreditado = 0;
  for (const n of notas.filter((x) => x.estado === "CERTIFICADA")) {
    acreditado += Number(n.total);
    for (const l of n.detalle_factura) porProducto[l.id_producto] = (porProducto[l.id_producto] ?? 0) + Number(l.cantidad);
  }

  return respuestaOk({
    ...aFacturaFicha(factura),
    notas: notas.map((n) => ({
      id_factura: Number(n.id_factura),
      numero: String(n.numero_interno),
      serie: n.serie_documento.serie_interna,
      total: Number(n.total).toFixed(2),
      estado: n.estado,
    })),
    acreditado: { total: acreditado.toFixed(2), porProducto },
    negocio,
    historial: historial.map((h) => ({
      id_historial: Number(h.id_historial),
      fecha: h.fecha,
      estado_anterior: h.estado_anterior,
      estado_nuevo: h.estado_nuevo,
      usuario: h.usuario?.nombre_usuario ?? null,
      motivo: h.motivo,
    })),
  });
});

const esquemaAnulacion = z.object({ motivo: z.string().min(5).max(255) });

export const DELETE = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN"); // un cajero NO anula
  const { uuid } = await params;
  const { motivo } = esquemaAnulacion.parse(await req.json());

  const existente = await prisma.factura.findFirst({ where: seleccion(uuid), select: { id_factura: true } });
  if (!existente) throw new ErrorApi(404, "FACTURA_NO_ENCONTRADA", "Factura no encontrada");

  const factura = await anularFactura(sesion.usuarioId, Number(existente.id_factura), motivo);
  return respuestaOk({ factura });
});
