// ============================================================
// API — POST /api/v1/pos/ventas
// El corazón del punto de venta: crea la factura, la certifica ante
// la SAT y registra los cobros, todo en una sola llamada.
// Orden obligado por la base de datos: un cobro solo se aplica a una
// factura ya CERTIFICADA, así que primero se certifica y luego se cobra.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { certificarFactura, crearFactura, exigirPreciosDelCatalogo, obtenerFacturaLista, verificarStock } from "../../servicios/facturacion";
import { METODOS_COBRO, registrarCobro } from "../../servicios/cobros";
import { contextoRequest } from "../../seguridad/audit";

const esquemaPago = z.object({
  metodo: z.enum(METODOS_COBRO),
  monto: z.number().positive(),
  referencia: z.string().max(100).optional(),
});

const esquemaVenta = z.object({
  id_serie: z.number().int().positive(),
  nitReceptor: z.string().max(15).default("CF"),
  nombreReceptor: z.string().max(100).optional(),
  items: z
    .array(
      z.object({
        id_producto: z.number().int().positive().optional(),
        codigoBarras: z.string().max(80).optional(),
        cantidad: z.number().int().positive().default(1),
        precioUnitario: z.number().nonnegative().optional(),
        descuento: z.number().nonnegative().optional(),
      })
    )
    .min(1),
  // Sin pagos = venta a crédito (queda como saldo por cobrar). Solo para clientes con NIT.
  pagos: z.array(esquemaPago).default([]),
});

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "CAJERO", "ADMIN");
  const venta = esquemaVenta.parse(await req.json());

  const esCredito = venta.pagos.length === 0;
  if (esCredito && (venta.nitReceptor ?? "CF").trim().toUpperCase() === "CF") {
    throw new ErrorApi(422, "CREDITO_SIN_CLIENTE", "Una venta a crédito necesita un cliente con NIT (no consumidor final)");
  }
  // La referencia del banco es opcional; si un método se configura con requiere_referencia = 1, la base la exige

  // Resolver códigos de barras a producto
  const lineas = await Promise.all(
    venta.items.map(async (it) => {
      const p = it.id_producto
        ? await prisma.producto.findFirst({ where: { id_producto: it.id_producto, activo: true } })
        : it.codigoBarras
          ? await prisma.producto.findFirst({ where: { codigo_barras: it.codigoBarras, activo: true } })
          : (() => {
              throw new ErrorApi(422, "PRODUCTO_REQUERIDO", "Cada línea necesita id_producto o codigoBarras");
            })();
      if (!p) throw new ErrorApi(404, "CODIGO_NO_ENCONTRADO", `Producto no encontrado: ${it.codigoBarras ?? it.id_producto}`);
      return { ...it, id_producto: p.id_producto, precio: it.precioUnitario ?? Number(p.precio_venta) };
    })
  );

  // El cajero vende al precio del catalogo y sin descuentos (solo el administrador puede cambiarlos)
  if (sesion.rol !== "ADMIN") {
    await exigirPreciosDelCatalogo(lineas.map((l) => ({ id_producto: l.id_producto, precioUnitario: l.precioUnitario, descuento: l.descuento })));
  }

  // Validar TODO antes de crear el documento: existencia y que los pagos cuadren con el total
  await verificarStock(lineas);
  const totalEsperado = redondear(lineas.reduce((a, l) => a + redondear(l.cantidad * l.precio - (l.descuento ?? 0)), 0));
  const totalPagos = redondear(venta.pagos.reduce((a, p) => a + p.monto, 0));
  if (!esCredito && Math.abs(totalPagos - totalEsperado) > 0.01) {
    throw new ErrorApi(422, "PAGO_INSUFICIENTE", `Los pagos (${totalPagos.toFixed(2)}) no cuadran con el total (${totalEsperado.toFixed(2)})`, {
      totalFactura: totalEsperado.toFixed(2),
    });
  }

  const factura = await crearFactura(
    sesion.usuarioId,
    {
      id_serie: venta.id_serie,
      nitReceptor: venta.nitReceptor,
      nombreReceptor: venta.nombreReceptor,
      condicionPago: esCredito ? "CREDITO" : "CONTADO",
      items: lineas.map((l) => ({
        id_producto: l.id_producto,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        descuento: l.descuento,
      })),
    },
    contextoRequest(req).ip
  );

  let certificada = factura;
  try {
    certificada = await certificarFactura(factura.id_factura, sesion.usuarioId);
  } catch (err) {
    console.error("[POS] La certificación no se completó:", err);
    throw new ErrorApi(
      502,
      "FEL_NO_DISPONIBLE",
      `La factura #${factura.numero} quedó pendiente de certificar y no se registró ningún cobro. Se podrá cobrar cuando se certifique.`,
      { idFactura: factura.id_factura }
    );
  }
  if (certificada.estado !== "CERTIFICADA") {
    throw new ErrorApi(
      422,
      "FEL_RECHAZADA",
      `El certificador rechazó la factura #${factura.numero}; no se registró ningún cobro.`,
      { idFactura: factura.id_factura }
    );
  }

  // Cobros: todos o ninguno
  if (!esCredito) {
    await conUsuario(sesion.usuarioId, async (tx) => {
      for (const p of venta.pagos) {
        await registrarCobro({ usuarioId: sesion.usuarioId, idFactura: factura.id_factura, ...p }, tx);
      }
    });
  }

  // Estado final (con los cobros ya aplicados)
  const final = esCredito ? certificada : await obtenerFacturaLista(factura.id_factura);

  return respuestaOk(
    {
      factura: final,
      ticket: {
        uuid: certificada.uuid_fel,
        serie: certificada.serie_fel,
        numero: certificada.numero_fel,
        total: certificada.total,
        estadoFel: certificada.estado,
      },
    },
    201
  );
});
