// ============================================================
// LIBRERÍA — adaptadores base de datos <-> API v1
// La base de datos tiene nombres propios (precio_venta, stock_actual,
// numero_interno, serie_documento…). Las pantallas siguen hablando el
// formato de la API v1 (precio, stock, numero, serie…), así que aquí
// se traduce en ambos sentidos. Si un día se cambia el formato de la
// API, es el único archivo que debe tocarse.
// ============================================================

import { Prisma } from "@prisma/client";

type Dec = Prisma.Decimal | number | string | null | undefined;

export const dinero = (v: Dec): string => Number(v ?? 0).toFixed(2);

// ------------------------------------------------------------
// Estados: la API muestra los mismos 5 estados que la base de datos:
// BORRADOR, PENDIENTE_CERTIFICACION, CERTIFICADA, RECHAZADA y ANULADA.
// PENDIENTE se sigue aceptando solo como FILTRO (BORRADOR + PENDIENTE_CERTIFICACION).
// ------------------------------------------------------------
export const ESTADOS_PENDIENTES = ["BORRADOR", "PENDIENTE_CERTIFICACION"];
export type EstadoApi = "BORRADOR" | "PENDIENTE_CERTIFICACION" | "PENDIENTE" | "CERTIFICADA" | "RECHAZADA" | "ANULADA";

export const estadoApi = (estadoBd: string): string => estadoBd;
export const estadosBd = (estado: EstadoApi): string[] => (estado === "PENDIENTE" ? ESTADOS_PENDIENTES : [estado]);

/** Documentos que cuentan como venta (suman); la nota de crédito resta. */
export const DOCUMENTOS_VENTA = ["FACT", "FCAM", "FPEQ"];

// ------------------------------------------------------------
// IVA: la API usa GRAVADO/EXENTO; la base guarda la tasa.
// ------------------------------------------------------------
export const TASA_GRAVADO = 0.12;
export const tipoIvaDe = (tasa: Dec): "GRAVADO" | "EXENTO" => (Number(tasa ?? 0) > 0 ? "GRAVADO" : "EXENTO");
export const tasaDe = (tipoIva: "GRAVADO" | "EXENTO"): number => (tipoIva === "EXENTO" ? 0 : TASA_GRAVADO);

// ------------------------------------------------------------
// Producto / Cliente / Serie / Negocio
// ------------------------------------------------------------
export function aProducto(p: Prisma.productoGetPayload<object>) {
  return {
    id_producto: p.id_producto,
    nombre_producto: p.nombre_producto,
    codigo_barras: p.codigo_barras,
    sku: p.sku,
    precio: dinero(p.precio_venta),
    stock: Number(p.stock_actual),
    tipo_iva: tipoIvaDe(p.tasa_iva),
    codigo_unidad: p.codigo_unidad,
    tipo_item: p.tipo_item, // BIEN | SERVICIO
    controla_stock: p.controla_stock, // un servicio no se agota
    activo: p.activo,
  };
}

export function aCliente(c: Prisma.clienteGetPayload<object>) {
  return {
    id_cliente: c.id_cliente,
    nombre_cliente: c.nombre_cliente,
    nit: c.documento,
    tipo_documento: c.tipo_documento,
    correo: c.correo,
    telefono: c.telefono,
    direccion: c.direccion,
  };
}

export function aSerie(s: Prisma.serie_documentoGetPayload<object>) {
  return {
    id_serie: s.id_serie_documento,
    tipo_documento: s.codigo_dte,
    serie: s.serie_interna,
    correlativo: s.ultimo_numero.toString(),
    activa: s.activa,
  };
}

const REGIMEN_A_AFILIACION = { GEN: "GENERAL", PEQ: "PEQUENO_CONTRIBUYENTE" } as const;
export const afiliacionDe = (regimen: "GEN" | "PEQ") => REGIMEN_A_AFILIACION[regimen];
export const regimenDe = (afiliacion: string): "GEN" | "PEQ" => (afiliacion === "PEQUENO_CONTRIBUYENTE" ? "PEQ" : "GEN");

export function aNegocio(n: Prisma.negocioGetPayload<object>) {
  return {
    id_negocio: n.id_negocio,
    nit: n.nit,
    razon_social: n.razon_social,
    nombre_comercial: n.nombre_comercial ?? "",
    direccion: n.direccion,
    municipio: n.municipio,
    departamento: n.departamento,
    regimen: regimenDe(n.afiliacion_iva),
    certificador: n.certificador,
    ambiente: n.ambiente_fel,
    usuario_api: n.usuario_api,
    llaveApiConfigurada: !!n.llave_api,
    llaveFirmaConfigurada: !!n.llave_firma,
  };
}

// ------------------------------------------------------------
// Factura
// ------------------------------------------------------------
export const incluirFacturaLista = {
  cliente: { select: { nombre_cliente: true, documento: true } },
  serie_documento: { select: { codigo_dte: true, serie_interna: true } },
  usuario: { select: { nombre_usuario: true } },
  cobro_aplicacion: { where: { cobro: { estado: "APLICADO" } }, select: { monto: true } },
} satisfies Prisma.facturaInclude;

export type FacturaLista = Prisma.facturaGetPayload<{ include: typeof incluirFacturaLista }>;

const sumar = (xs: { monto: Prisma.Decimal }[]) => xs.reduce((a, x) => a + Number(x.monto), 0);

/**
 * Lo que falta por pagar, tal como lo muestra la API:
 *  - certificada y cobrable  -> el saldo que mantiene la base de datos
 *  - anulada o nota de crédito -> 0
 *  - aún sin certificar -> el total (todavía no se puede cobrar, pero se debe)
 */
function saldoApi(f: { estado: string; estado_pago: string; saldo_pendiente: Dec; total: Dec }): string {
  if (f.estado_pago !== "NO_APLICA") return dinero(f.saldo_pendiente);
  if (f.estado === "ANULADA") return "0.00";
  return ESTADOS_PENDIENTES.includes(f.estado) || f.estado === "RECHAZADA" ? dinero(f.total) : "0.00";
}

const base = (f: FacturaLista) => ({
  id_factura: Number(f.id_factura),
  id_cliente: f.id_cliente,
  numero: String(f.numero_interno),
  fecha_factura: f.fecha_emision,
  subtotal: dinero(Number(f.subtotal_gravado) + Number(f.subtotal_exento)), // subtotal + iva = total
  iva: dinero(f.iva_total),
  total: dinero(f.total),
  estado: estadoApi(f.estado),
  uuid_fel: f.uuid_fel,
  serie_fel: f.serie_fel,
  numero_fel: f.numero_fel,
  fecha_certificacion: f.fecha_certificacion,
  motivo_anulacion: f.motivo_anulacion,
  cliente: { nombre_cliente: f.cliente.nombre_cliente, nit: f.cliente.documento },
  serie: { tipo_documento: f.serie_documento.codigo_dte, serie: f.serie_documento.serie_interna },
  usuario: f.usuario,
});

export function aFacturaLista(f: FacturaLista) {
  const pagado = sumar(f.cobro_aplicacion);
  return { ...base(f), pagado: dinero(pagado), saldo: saldoApi(f) };
}

// --- ficha completa (detalle de una factura) ---
export const incluirFacturaFicha = {
  cliente: true,
  serie_documento: true,
  usuario: { select: { nombre_usuario: true } },
  // Para una nota de credito/debito: la factura que corrige
  factura_referencia: {
    select: {
      id_factura: true,
      numero_interno: true,
      fecha_emision: true,
      serie_fel: true,
      numero_fel: true,
      serie_documento: { select: { codigo_dte: true, serie_interna: true } },
    },
  },
  detalle_factura: { include: { producto: true }, orderBy: { id_detalle: "asc" } },
  cobro_aplicacion: {
    where: { cobro: { estado: "APLICADO" } },
    include: { cobro: true },
    orderBy: { fecha: "asc" },
  },
} satisfies Prisma.facturaInclude;

export type FacturaFicha = Prisma.facturaGetPayload<{ include: typeof incluirFacturaFicha }>;

export function aFacturaFicha(f: FacturaFicha) {
  const pagado = sumar(f.cobro_aplicacion);
  const lista = f as unknown as FacturaLista;
  return {
    factura: {
      ...base(lista),
      motivo_referencia: f.motivo_referencia,
      referencia: f.factura_referencia
        ? {
            id_factura: Number(f.factura_referencia.id_factura),
            numero: String(f.factura_referencia.numero_interno),
            fecha: f.factura_referencia.fecha_emision,
            serie: f.factura_referencia.serie_documento.serie_interna,
            tipo_documento: f.factura_referencia.serie_documento.codigo_dte,
            serie_fel: f.factura_referencia.serie_fel,
            numero_fel: f.factura_referencia.numero_fel,
          }
        : null,
      cliente: {
        nombre_cliente: f.cliente.nombre_cliente,
        nit: f.cliente.documento,
        direccion: f.cliente.direccion,
        correo: f.cliente.correo,
        telefono: f.cliente.telefono,
      },
      detalle_factura: f.detalle_factura.map((d) => ({
        id_detalle: Number(d.id_detalle),
        id_producto: d.id_producto,
        cantidad: Number(d.cantidad),
        precio_unitario: dinero(d.precio_unitario),
        descuento: dinero(d.descuento_linea),
        subtotal_linea: dinero(d.total_linea),
        producto: {
          nombre_producto: d.descripcion,
          codigo_barras: d.producto.codigo_barras,
          tipo_iva: tipoIvaDe(d.tasa_iva),
        },
      })),
      pago: f.cobro_aplicacion.map((a) => ({
        id_pago: Number(a.id_aplicacion),
        id_cobro: Number(a.id_cobro),
        fecha_pago: a.cobro.fecha_cobro,
        monto: dinero(a.monto),
        metodo_pago: a.cobro.codigo_metodo,
        referencia: a.cobro.referencia,
      })),
    },
    pagado: dinero(pagado),
    saldo: saldoApi(f),
  };
}
