// ============================================================
// API — /api/v1/productos/{id}
// PUT: edita un producto (nombre, precio, IVA, código, activo)
//      y/o ajusta su existencia (entrada o salida de mercadería).
// Solo ADMIN. El ajuste queda en el kardex (movimiento_inventario).
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { aProducto, tasaDe, tipoIvaDe } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";

type Params = { params: Promise<{ id: string }> };

const esquemaEditar = z.object({
  nombre_producto: z.string().min(1).max(160).optional(),
  codigo_barras: z.string().max(80).nullable().optional(),
  precio: z.number().nonnegative().optional(),
  tipo_iva: z.enum(["GRAVADO", "EXENTO"]).optional(),
  activo: z.boolean().optional(),
  codigo_unidad: z.string().min(1).max(10).optional(),
  tipo_item: z.enum(["BIEN", "SERVICIO"]).optional(),
  // Ajuste de existencia: positivo = entra mercadería, negativo = sale
  // (merma, daño, conteo). Se aplica sobre el valor actual, no lo pisa.
  ajusteStock: z.number().int().optional(),
  motivoAjuste: z.string().min(3).max(100).optional(),
});

export const PUT = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErrorApi(400, "ID_INVALIDO", "Identificador de producto inválido");

  const { ajusteStock, motivoAjuste, tipo_iva, precio, tipo_item, ...cambios } = esquemaEditar.parse(await req.json());

  const actual = await prisma.producto.findUnique({ where: { id_producto: id } });
  if (!actual) throw new ErrorApi(404, "PRODUCTO_NO_ENCONTRADO", "El producto no existe");

  if (cambios.codigo_unidad) {
    const unidad = await prisma.unidad_medida.findUnique({ where: { codigo: cambios.codigo_unidad } });
    if (!unidad) throw new ErrorApi(422, "UNIDAD_INVALIDA", `La unidad de medida "${cambios.codigo_unidad}" no existe`);
  }
  // Pasar a SERVICIO solo si no queda mercadería en existencia; el servicio no lleva inventario.
  const cambiaTipo = tipo_item !== undefined && tipo_item !== actual.tipo_item;
  if (cambiaTipo && tipo_item === "SERVICIO" && Number(actual.stock_actual) !== 0) {
    throw new ErrorApi(422, "SERVICIO_CON_STOCK", `No se puede convertir en servicio mientras haya existencia (${Number(actual.stock_actual)}). Ajústala a 0 primero.`);
  }
  if (ajusteStock && (tipo_item ?? actual.tipo_item) === "SERVICIO") {
    throw new ErrorApi(422, "SERVICIO_SIN_STOCK", "Un servicio no lleva existencia");
  }
  if (ajusteStock && Number(actual.stock_actual) + ajusteStock < 0) {
    throw new ErrorApi(422, "STOCK_NEGATIVO", `La existencia no puede quedar negativa (actual: ${Number(actual.stock_actual)})`);
  }

  const producto = await conUsuario(sesion.usuarioId, async (tx) => {
    await tx.producto.update({
      where: { id_producto: id },
      data: {
        ...cambios,
        ...(precio !== undefined && { precio_venta: precio }),
        ...(tipo_iva && { tasa_iva: tasaDe(tipo_iva) }),
        ...(cambiaTipo && { tipo_item, controla_stock: tipo_item === "BIEN" }),
      },
    });
    if (ajusteStock) {
      await tx.$executeRaw`EXEC dbo.usp_ajustar_inventario @id_producto = ${id}, @cantidad = ${ajusteStock}, @tipo = N'AJUSTE', @id_usuario = ${sesion.usuarioId}, @observacion = ${motivoAjuste ?? "ajuste manual"}`;
    }
    return tx.producto.findUniqueOrThrow({ where: { id_producto: id } });
  });

  const partes: string[] = [];
  if (precio !== undefined && Number(actual.precio_venta) !== precio) {
    partes.push(`precio Q${actual.precio_venta} → Q${precio}`);
  }
  if (tipo_iva && tipoIvaDe(actual.tasa_iva) !== tipo_iva) partes.push(`IVA ${tipoIvaDe(actual.tasa_iva)} → ${tipo_iva}`);
  if (cambiaTipo) partes.push(`tipo ${actual.tipo_item} → ${tipo_item}`);
  if (cambios.codigo_unidad && cambios.codigo_unidad !== actual.codigo_unidad) {
    partes.push(`unidad ${actual.codigo_unidad} → ${cambios.codigo_unidad}`);
  }
  if (cambios.activo !== undefined && actual.activo !== cambios.activo) {
    partes.push(cambios.activo ? "reactivado" : "desactivado");
  }
  if (ajusteStock) {
    partes.push(`stock ${Number(actual.stock_actual)} → ${Number(producto.stock_actual)} (${motivoAjuste ?? "ajuste manual"})`);
  }
  await registrarAuditoria(
    {
      usuarioId: sesion.usuarioId,
      accion: "ACTUALIZAR_PRODUCTO",
      detalle: `${actual.nombre_producto}${partes.length ? ": " + partes.join("; ") : ""}`,
    },
    contextoRequest(req)
  );

  return respuestaOk({ producto: aProducto(producto) });
});
