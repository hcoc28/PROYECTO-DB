// ============================================================
// API — /api/v1/productos
// GET:  busca productos (por código de barras o por nombre).
// POST: crea un producto nuevo (solo ADMIN).
// El stock no se escribe directo: entra por el kardex de la base de datos.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { aProducto, tasaDe } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { registrarAuditoria } from "../../seguridad/audit";

// GET  /api/v1/productos?codigoBarras=...  → búsqueda exacta (escáner POS)
// GET  /api/v1/productos?q=...             → búsqueda por nombre, SKU o código
// POST /api/v1/productos                   → crear producto (solo ADMIN)

const esquemaFiltros = z.object({
  codigoBarras: z.string().max(80).optional(),
  q: z.string().max(100).optional(),
  inactivos: z.enum(["1", "0"]).optional(), // "1" = incluir los desactivados (inventario)
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = manejarErrores(async (req: NextRequest) => {
  await sesionDesdeRequest(req);
  const f = esquemaFiltros.parse(Object.fromEntries(req.nextUrl.searchParams));

  const where: Prisma.productoWhereInput = {
    ...(f.inactivos !== "1" && { activo: true }),
    ...(f.codigoBarras && { codigo_barras: f.codigoBarras }),
    ...(f.q && {
      OR: [{ nombre_producto: { contains: f.q } }, { codigo_barras: { contains: f.q } }, { sku: { contains: f.q } }],
    }),
  };

  const productos = await prisma.producto.findMany({
    where,
    orderBy: { nombre_producto: "asc" },
    skip: (f.pagina - 1) * f.porPagina,
    take: f.porPagina,
  });

  return respuestaOk({ productos: productos.map(aProducto) });
});

const esquemaCrear = z.object({
  nombre_producto: z.string().min(1).max(160),
  codigo_barras: z.string().max(80).optional(),
  precio: z.number().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
  tipo_iva: z.enum(["GRAVADO", "EXENTO"]).default("GRAVADO"),
  codigo_unidad: z.string().min(1).max(10).default("UNI"),
  // SERVICIO: no se agota ni lleva inventario (consultoría, mano de obra…)
  tipo_item: z.enum(["BIEN", "SERVICIO"]).default("BIEN"),
});

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const input = esquemaCrear.parse(await req.json());

  const unidad = await prisma.unidad_medida.findUnique({ where: { codigo: input.codigo_unidad } });
  if (!unidad) throw new ErrorApi(422, "UNIDAD_INVALIDA", `La unidad de medida "${input.codigo_unidad}" no existe`);
  const esServicio = input.tipo_item === "SERVICIO";
  if (esServicio && input.stock > 0) {
    throw new ErrorApi(422, "SERVICIO_SIN_STOCK", "Un servicio no lleva existencia: déjala en 0");
  }

  const producto = await conUsuario(sesion.usuarioId, async (tx) => {
    const creado = await tx.producto.create({
      data: {
        nombre_producto: input.nombre_producto,
        codigo_barras: input.codigo_barras || null,
        precio_venta: input.precio,
        tasa_iva: tasaDe(input.tipo_iva),
        codigo_unidad: input.codigo_unidad,
        tipo_item: input.tipo_item,
        controla_stock: !esServicio,
      },
    });
    if (input.stock > 0) {
      await tx.$executeRaw`EXEC dbo.usp_ajustar_inventario @id_producto = ${creado.id_producto}, @cantidad = ${input.stock}, @tipo = N'ENTRADA', @id_usuario = ${sesion.usuarioId}, @observacion = N'Existencia inicial'`;
    }
    return tx.producto.findUniqueOrThrow({ where: { id_producto: creado.id_producto } });
  });

  await registrarAuditoria({
    usuarioId: sesion.usuarioId,
    accion: "CREAR_PRODUCTO",
    detalle: `${producto.nombre_producto} (Q${producto.precio_venta})`,
  });

  return respuestaOk({ producto: aProducto(producto) }, 201);
});
