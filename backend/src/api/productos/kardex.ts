// ============================================================
// API — GET /api/v1/productos/{id}/kardex
// El kardex de un producto: cada entrada y salida de mercadería, con
// la existencia que quedó después y quién lo hizo. Es el registro que
// la base de datos escribe sola cada vez que cambia el stock.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../../base-de-datos/prisma";
import { ErrorApi, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";

type Params = { params: Promise<{ id: string }> };

const esquemaFiltros = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = manejarErrores(async (req: NextRequest, { params }: Params) => {
  await sesionDesdeRequest(req);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErrorApi(400, "ID_INVALIDO", "Identificador de producto inválido");
  const f = esquemaFiltros.parse(Object.fromEntries(req.nextUrl.searchParams));

  const producto = await prisma.producto.findUnique({ where: { id_producto: id } });
  if (!producto) throw new ErrorApi(404, "PRODUCTO_NO_ENCONTRADO", "El producto no existe");

  const where = { id_producto: id };
  const [total, filas] = await Promise.all([
    prisma.movimiento_inventario.count({ where }),
    prisma.movimiento_inventario.findMany({
      where,
      include: {
        usuario: { select: { nombre_usuario: true } },
        factura: { select: { id_factura: true, numero_interno: true, serie_documento: { select: { codigo_dte: true, serie_interna: true } } } },
      },
      orderBy: { id_movimiento: "desc" },
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
  ]);

  return respuestaOk({
    producto: {
      id_producto: producto.id_producto,
      nombre_producto: producto.nombre_producto,
      stock: Number(producto.stock_actual),
      controla_stock: producto.controla_stock,
    },
    movimientos: filas.map((m) => ({
      id_movimiento: Number(m.id_movimiento),
      fecha: m.fecha_movimiento,
      tipo: m.tipo_movimiento,
      cantidad: Number(m.cantidad),
      stock_resultante: Number(m.stock_resultante),
      observacion: m.observacion,
      usuario: m.usuario?.nombre_usuario ?? null,
      id_factura: m.factura ? Number(m.factura.id_factura) : null,
      documento: m.factura
        ? `${m.factura.serie_documento.codigo_dte}-${m.factura.serie_documento.serie_interna} #${m.factura.numero_interno}`
        : null,
    })),
    paginacion: { pagina: f.pagina, porPagina: f.porPagina, total, paginas: Math.ceil(total / f.porPagina) },
  });
});
