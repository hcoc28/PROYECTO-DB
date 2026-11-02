// ============================================================
// API — GET /api/v1/reportes/resumen
// Datos del tablero de inicio (solo ADMIN): ventas de hoy y de la
// semana, lo cobrado, lo que falta por cobrar, alertas de inventario,
// los productos más vendidos y los documentos recientes.
// ============================================================

import { NextRequest } from "next/server";
import { prisma } from "../../base-de-datos/prisma";
import { aFacturaLista, DOCUMENTOS_VENTA, dinero, incluirFacturaLista } from "../../base-de-datos/adaptadores";
import { exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";

const STOCK_MINIMO = 5; // mismo valor que frontend/src/lib/client/constantes.ts
const UTC_MENOS_6 = 6 * 3600 * 1000;

/** Fecha YYYY-MM-DD en Guatemala para un instante dado. */
const diaGt = (d: Date) => new Date(d.getTime() - UTC_MENOS_6).toISOString().slice(0, 10);
const inicioDia = (dia: string) => new Date(`${dia}T00:00:00.000-06:00`);
const finDia = (dia: string) => new Date(`${dia}T23:59:59.999-06:00`);

export const GET = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN", "GERENTE");

  const ahora = new Date();
  const hoy = diaGt(ahora);
  const hace6 = diaGt(new Date(ahora.getTime() - 6 * 86_400_000));
  const inicioMes = `${hoy.slice(0, 7)}-01`;

  const [semana, cobradoHoy, porCobrar, bajos, agotados, topRaw, recientes] = await Promise.all([
    prisma.factura.findMany({
      where: { fecha_emision: { gte: inicioDia(hace6), lte: finDia(hoy) }, estado: "CERTIFICADA" },
      select: { fecha_emision: true, total: true, serie_documento: { select: { codigo_dte: true } } },
    }),
    prisma.cobro.aggregate({
      where: { fecha_cobro: { gte: inicioDia(hoy), lte: finDia(hoy) }, estado: "APLICADO" },
      _sum: { monto: true },
    }),
    prisma.factura.aggregate({ where: { estado: "CERTIFICADA", saldo_pendiente: { gt: 0 } }, _sum: { saldo_pendiente: true } }),
    prisma.producto.count({ where: { activo: true, controla_stock: true, stock_actual: { gt: 0, lte: STOCK_MINIMO } } }),
    prisma.producto.count({ where: { activo: true, controla_stock: true, stock_actual: 0 } }),
    prisma.detalle_factura.groupBy({
      by: ["id_producto"],
      where: {
        factura: {
          fecha_emision: { gte: inicioDia(inicioMes), lte: finDia(hoy) },
          estado: "CERTIFICADA",
          serie_documento: { codigo_dte: { in: DOCUMENTOS_VENTA } },
        },
      },
      _sum: { cantidad: true, total_linea: true },
      orderBy: { _sum: { cantidad: "desc" } },
      take: 5,
    }),
    prisma.factura.findMany({
      orderBy: { fecha_emision: "desc" },
      take: 6,
      include: incluirFacturaLista,
    }),
  ]);

  const dias: { fecha: string; total: number; cantidad: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    dias.push({ fecha: diaGt(new Date(ahora.getTime() - i * 86_400_000)), total: 0, cantidad: 0 });
  }
  for (const f of semana) {
    const fila = dias.find((d) => d.fecha === diaGt(f.fecha_emision));
    if (!fila) continue;
    const signo = f.serie_documento.codigo_dte === "NCRE" ? -1 : 1;
    fila.total += signo * Number(f.total);
    fila.cantidad += 1;
  }
  const hoyFila = dias[dias.length - 1];

  const nombres = await prisma.producto.findMany({
    where: { id_producto: { in: topRaw.map((t) => t.id_producto) } },
    select: { id_producto: true, nombre_producto: true },
  });
  const nombrePorId = new Map(nombres.map((n) => [n.id_producto, n.nombre_producto]));

  return respuestaOk({
    hoy: { total: hoyFila.total.toFixed(2), cantidad: hoyFila.cantidad, cobrado: dinero(cobradoHoy._sum.monto) },
    semana: dias.map((d) => ({ ...d, total: d.total.toFixed(2) })),
    totalSemana: dias.reduce((a, d) => a + d.total, 0).toFixed(2),
    porCobrar: dinero(porCobrar._sum.saldo_pendiente),
    inventario: { bajos, agotados, stockMinimo: STOCK_MINIMO },
    topProductos: topRaw.map((t) => ({
      id_producto: t.id_producto,
      nombre: nombrePorId.get(t.id_producto) ?? `Producto ${t.id_producto}`,
      unidades: Number(t._sum.cantidad ?? 0),
      total: dinero(t._sum.total_linea),
    })),
    recientes: recientes.map(aFacturaLista),
  });
});
