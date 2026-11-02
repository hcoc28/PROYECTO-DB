// ============================================================
// LÓGICA DE NEGOCIO — facturación
// La base de datos (triggers y procedimientos) es dueña de la
// numeración, los totales, el inventario, los saldos y el historial.
// Este archivo hace solo lo que SQL no puede: hablar con el
// certificador FEL, validar antes de enviar a SAT y traducir formatos.
//
// Flujo de una factura:
//   BORRADOR -> PENDIENTE_CERTIFICACION -> CERTIFICADA (stock y cargo al cliente)
//                                       -> RECHAZADA   (se puede corregir y reintentar)
//   CERTIFICADA -> ANULADA (devuelve el stock y anula sus cobros)
// ============================================================

import { createHash } from "node:crypto";
import { prisma } from "../base-de-datos/prisma";
import { conUsuario, opcional, type Tx } from "../base-de-datos/sql";
import { incluirFacturaLista, aFacturaLista, regimenDe, tipoIvaDe } from "../base-de-datos/adaptadores";
import { descifrar } from "../seguridad/crypto";
import { ErrorApi } from "../seguridad/auth";
import { registrarAuditoria } from "../seguridad/audit";
import { calcularLinea } from "../fel/calculos";
import { obtenerCertificador } from "../fel/certificador";
import type { DocumentoFel, TipoDte } from "../fel/tipos";
import { clasificarDocumento } from "../validaciones/nit";

export interface NuevaFacturaInput {
  id_serie: number;
  clienteId?: number;
  /** Si no hay clienteId: NIT o "CF" para resolver/crear el cliente */
  nitReceptor?: string;
  nombreReceptor?: string;
  items: {
    id_producto: number;
    cantidad: number;
    precioUnitario?: number; // si no viene, usa el del producto
    descuento?: number;
  }[];
  condicionPago?: "CONTADO" | "CREDITO";
  /** YYYY-MM-DD; si es crédito y no viene, se usan 30 días */
  fechaVencimiento?: string;
  /** Para notas de crédito/débito: el documento que corrigen */
  idFacturaReferencia?: number;
  motivoReferencia?: string;
}

const DIAS_CREDITO = 30;
const UTC_MENOS_6 = 6 * 3600 * 1000;

// ------------------------------------------------------------
// Precios y descuentos
// El cajero vende al precio del catalogo. Cambiar un precio o dar un descuento
// es decision del administrador: si no, bastaria con mandar precioUnitario=0.01 a la API.
// ------------------------------------------------------------

export async function exigirPreciosDelCatalogo(items: { id_producto: number; precioUnitario?: number; descuento?: number }[]) {
  const ids = [...new Set(items.map((i) => i.id_producto))];
  const productos = await prisma.producto.findMany({ where: { id_producto: { in: ids } }, select: { id_producto: true, precio_venta: true } });
  for (const it of items) {
    const p = productos.find((x) => x.id_producto === it.id_producto);
    const cambiaPrecio = it.precioUnitario !== undefined && p && Math.abs(it.precioUnitario - Number(p.precio_venta)) > 0.005;
    if ((it.descuento ?? 0) > 0 || cambiaPrecio) {
      throw new ErrorApi(403, "PRECIO_NO_AUTORIZADO", "Solo un administrador puede cambiar precios o aplicar descuentos");
    }
  }
}

// ------------------------------------------------------------
// Crear
// ------------------------------------------------------------

export async function crearFactura(usuarioId: number, input: NuevaFacturaInput, ip?: string | null) {
  const serie = await prisma.serie_documento.findFirst({
    where: { id_serie_documento: input.id_serie, activa: true },
    include: { tipo_dte: true },
  });
  if (!serie) throw new ErrorApi(404, "SERIE_INVALIDA", "Serie no válida o inactiva");

  const id_cliente = await resolverCliente(input, usuarioId);
  if (serie.tipo_dte.signo_inventario < 0) await verificarStock(input.items);

  const credito = input.condicionPago === "CREDITO";
  const vencimiento = credito
    ? input.fechaVencimiento ?? new Date(Date.now() - UTC_MENOS_6 + DIAS_CREDITO * 86_400_000).toISOString().slice(0, 10)
    : null;

  // Todo en una sola transaccion: si falla una linea, no queda ni la factura a medias.
  const id_factura = await conUsuario(usuarioId, async (tx) => {
    // 1) crear la factura vacia (la base le asigna el siguiente numero de la serie)
    const [creada] = await tx.$queryRaw<{ id_factura: bigint }[]>`
      DECLARE @id BIGINT, @num BIGINT;
      EXEC dbo.usp_crear_factura_borrador
        @id_negocio = ${serie.id_negocio}, @id_serie_documento = ${serie.id_serie_documento},
        @id_cliente = ${id_cliente}, @id_usuario = ${usuarioId},
        @condicion_pago = ${credito ? "CREDITO" : "CONTADO"}${opcional("@fecha_vencimiento", vencimiento)}${opcional("@id_factura_referencia", input.idFacturaReferencia)}${opcional("@motivo_referencia", input.motivoReferencia)},
        @id_factura = @id OUTPUT, @numero_interno = @num OUTPUT;
      SELECT @id AS id_factura;`;

    // 2) agregar cada producto (un trigger recalcula los totales de la factura)
    for (const item of input.items) {
      await tx.$executeRaw`
        DECLARE @detalle BIGINT;
        EXEC dbo.usp_agregar_linea
          @id_factura = ${creada.id_factura}, @id_producto = ${item.id_producto},
          @cantidad = ${item.cantidad}, @id_usuario = ${usuarioId},
          @descuento_linea = ${(item.descuento ?? 0).toFixed(2)}${opcional("@precio_unitario", item.precioUnitario?.toFixed(2))},
          @id_detalle = @detalle OUTPUT;`;
    }
    return creada.id_factura;
  });

  const factura = await obtenerLista(id_factura);
  await registrarAuditoria(
    {
      usuarioId,
      accion: "CREAR_FACTURA",
      detalle: `${factura.serie.tipo_documento} serie ${factura.serie.serie} #${factura.numero} · Q${factura.total}`,
    },
    { ip }
  );
  return factura;
}

async function obtenerLista(id: bigint | number) {
  const f = await prisma.factura.findUniqueOrThrow({
    where: { id_factura: BigInt(id) },
    include: incluirFacturaLista,
  });
  return aFacturaLista(f);
}

async function resolverCliente(input: NuevaFacturaInput, usuarioId: number): Promise<number> {
  if (input.clienteId) {
    const c = await prisma.cliente.findUnique({ where: { id_cliente: input.clienteId } });
    if (!c) throw new ErrorApi(404, "CLIENTE_NO_ENCONTRADO", "Cliente no existe");
    return c.id_cliente;
  }

  const doc = clasificarDocumento(input.nitReceptor ?? "CF");
  if (!doc) throw new ErrorApi(422, "NIT_INVALIDO", `NIT o DPI inválido: ${input.nitReceptor}`);
  const nit = doc.documento;

  const existente = await prisma.cliente.findFirst({ where: { documento: nit } });
  if (existente) {
    if (nit !== "CF" && input.nombreReceptor && input.nombreReceptor !== existente.nombre_cliente) {
      await conUsuario(usuarioId, (tx) =>
        tx.cliente.update({ where: { id_cliente: existente.id_cliente }, data: { nombre_cliente: input.nombreReceptor } })
      );
    }
    return existente.id_cliente;
  }

  const creado = await conUsuario(usuarioId, (tx) =>
    tx.cliente.create({
      data: {
        nombre_cliente: input.nombreReceptor ?? "Cliente",
        tipo_documento: doc.tipo,
        documento: nit,
      },
    })
  );
  return creado.id_cliente;
}

/**
 * Avisa ANTES de enviar nada a SAT si no alcanza la existencia. La base de datos también lo
 * impide al certificar, pero para entonces SAT ya habría aceptado el documento.
 */
export async function verificarStock(items: { id_producto: number; cantidad: number }[]) {
  const pedido = new Map<number, number>();
  for (const i of items) pedido.set(i.id_producto, (pedido.get(i.id_producto) ?? 0) + Number(i.cantidad));

  const productos = await prisma.producto.findMany({
    where: { id_producto: { in: [...pedido.keys()] }, controla_stock: true },
  });
  const faltan = productos.filter((p) => Number(p.stock_actual) < (pedido.get(p.id_producto) ?? 0));
  if (faltan.length) {
    throw new ErrorApi(
      422,
      "STOCK_INSUFICIENTE",
      "No hay existencia suficiente de " +
        faltan
          .map((p) => `"${p.nombre_producto}" (disponible: ${Number(p.stock_actual)}, pedido: ${pedido.get(p.id_producto)})`)
          .join("; ")
    );
  }
}

// ------------------------------------------------------------
// Certificar (reintentable)
// ------------------------------------------------------------

/** True si el negocio tiene todo lo necesario para hablar con un certificador real. */
function certificadorConfigurado(n: { certificador: string | null; usuario_api: string | null; llave_api: string | null; llave_firma: string | null }) {
  return !!(n.certificador && n.usuario_api && n.llave_api && n.llave_firma);
}

export async function certificarFactura(facturaId: number, usuarioId: number) {
  const factura = await prisma.factura.findUnique({
    where: { id_factura: BigInt(facturaId) },
    include: {
      detalle_factura: { include: { producto: true }, orderBy: { id_detalle: "asc" } },
      cliente: true,
      serie_documento: { include: { tipo_dte: true } },
      negocio: true,
    },
  });
  if (!factura) throw new ErrorApi(404, "FACTURA_NO_ENCONTRADA", "Factura no existe");
  if (factura.estado === "CERTIFICADA") return obtenerLista(factura.id_factura);
  if (!["BORRADOR", "PENDIENTE_CERTIFICACION", "RECHAZADA"].includes(factura.estado)) {
    throw new ErrorApi(409, "ESTADO_INVALIDO", `No se puede certificar en estado ${factura.estado}`);
  }

  const { negocio } = factura;
  const real = certificadorConfigurado(negocio);
  if (!real && negocio.ambiente_fel === "PRODUCCION") {
    throw new ErrorApi(409, "FEL_NO_CONFIGURADO", "Configure el certificador FEL en los datos del negocio");
  }

  if (factura.serie_documento.tipo_dte.signo_inventario < 0) {
    await verificarStock(factura.detalle_factura.map((d) => ({ id_producto: d.id_producto, cantidad: Number(d.cantidad) })));
  }

  // BORRADOR / RECHAZADA -> PENDIENTE_CERTIFICACION (desde aquí el documento queda bloqueado)
  if (factura.estado !== "PENDIENTE_CERTIFICACION") {
    await prisma.$executeRaw`EXEC dbo.usp_cambiar_estado_factura @id_factura = ${factura.id_factura}, @estado_nuevo = N'PENDIENTE_CERTIFICACION', @id_usuario = ${usuarioId}`;
  }

  if (!real) {
    // Sin certificador y fuera de producción: certificación simulada (solo desarrollo, serie FEL "SIM")
    await prisma.$executeRaw`EXEC dbo.usp_certificar_simulado @id_factura = ${factura.id_factura}, @id_usuario = ${usuarioId}`;
  } else {
    const doc: DocumentoFel = {
      identificador: `${negocio.nit}-${factura.id_transaccion_fel}`,
      tipoDte: factura.serie_documento.codigo_dte as TipoDte,
      fechaEmision: formatoFechaFel(factura.fecha_emision),
      moneda: factura.moneda,
      emisor: {
        nit: negocio.nit,
        razonSocial: negocio.razon_social,
        nombreComercial: negocio.nombre_comercial ?? negocio.razon_social,
        direccion: negocio.direccion,
        municipio: negocio.municipio,
        departamento: negocio.departamento,
        regimen: regimenDe(negocio.afiliacion_iva),
      },
      receptor: {
        idReceptor: factura.cliente.documento,
        nombre: factura.cliente.nombre_cliente,
        direccion: factura.cliente.direccion ?? undefined,
      },
      items: factura.detalle_factura.map((d, idx) => {
        const calculo = calcularLinea({
          cantidad: Number(d.cantidad),
          precioUnitario: Number(d.precio_unitario),
          descuento: Number(d.descuento_linea),
          tipoIva: tipoIvaDe(d.tasa_iva),
        });
        return {
          linea: idx + 1,
          descripcion: d.descripcion,
          cantidad: String(Number(d.cantidad)),
          precioUnitario: calculo.precioUnitario,
          precio: (Number(d.cantidad) * Number(d.precio_unitario)).toFixed(2),
          descuento: calculo.descuento,
          montoGravable: calculo.montoGravable,
          montoImpuesto: calculo.montoIva,
          total: calculo.total,
        };
      }),
      totales: { granTotal: factura.total.toFixed(2), totalImpuestos: factura.iva_total.toFixed(2) },
    };

    const certificador = obtenerCertificador(negocio.certificador!);
    let resultado;
    try {
      resultado = await certificador.certificar(doc, {
        usuarioApi: negocio.usuario_api!,
        llaveApi: descifrar(negocio.llave_api!),
        llaveFirma: descifrar(negocio.llave_firma!),
        ambiente: negocio.ambiente_fel as "CERTIFICACION" | "PRODUCCION",
      });
    } catch (err) {
      // Contingencia: el certificador no respondio (internet, mantenimiento de la SAT, timeout).
      // La venta NO se pierde: la factura queda en PENDIENTE_CERTIFICACION y el proceso de reintento
      // la vuelve a enviar con el mismo identificador (ver servicios/reintentos.ts).
      await registrarAuditoria({
        usuarioId,
        accion: "CERTIFICAR",
        detalle: `Certificador sin respuesta, factura #${factura.numero_interno} queda pendiente: ${String(err).slice(0, 300)}`,
      });
      return obtenerLista(factura.id_factura);
    }

    if (!resultado.exito) {
      const mensaje = (resultado.errores ?? []).join(" | ").slice(0, 1900);
      await prisma.$executeRaw`EXEC dbo.usp_registrar_rechazo @id_factura = ${factura.id_factura}, @id_usuario = ${usuarioId}, @codigo_respuesta = N'RECHAZO', @mensaje = ${mensaje}`;
      await registrarAuditoria({
        usuarioId,
        accion: "CERTIFICAR",
        detalle: `Rechazada factura #${factura.numero_interno}: ${mensaje.slice(0, 400)}`,
      });
      return obtenerLista(factura.id_factura);
    }

    const xml = xmlParaSql(resultado.xmlCertificado);
    // Huella (SHA-256) del XML certificado: sirve para comprobar despues que no se alteró
    const hash = resultado.xmlCertificado ? createHash("sha256").update(resultado.xmlCertificado).digest() : null;
    await prisma.$executeRaw`EXEC dbo.usp_registrar_certificacion
      @id_factura = ${factura.id_factura}, @id_usuario = ${usuarioId}, @uuid_fel = ${resultado.uuid!},
      @serie_fel = ${resultado.serie!}, @numero_fel = ${resultado.numero!},
      @fecha_certificacion = ${resultado.fechaCertificacion ? new Date(resultado.fechaCertificacion) : new Date()}${opcional("@xml_respuesta", xml)}${opcional("@xml_fel_hash", hash)}${opcional("@url_xml", resultado.urlXml)}${opcional("@url_pdf", resultado.urlPdf)}`;
  }

  const certificada = await obtenerLista(factura.id_factura);
  await registrarAuditoria({
    usuarioId,
    accion: "CERTIFICAR",
    detalle: `Certificada factura #${factura.numero_interno}, UUID ${certificada.uuid_fel}${real ? "" : " (simulada)"}`,
  });
  return certificada;
}

/** SQL Server no acepta XML con declaración de codificación cuando viene como texto Unicode. */
function xmlParaSql(xml?: string): string | null {
  if (!xml || !xml.trim().startsWith("<")) return null;
  return xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
}

// ------------------------------------------------------------
// Anular
// ------------------------------------------------------------

export async function anularFactura(usuarioId: number, idFactura: number, motivo: string) {
  const factura = await prisma.factura.findUnique({
    where: { id_factura: BigInt(idFactura) },
    include: {
      cliente: true,
      negocio: true,
      serie_documento: { include: { tipo_dte: true } },
      detalle_factura: true,
      notas: { where: { estado: "CERTIFICADA" }, select: { id_factura: true } },
      cobro_aplicacion: { where: { cobro: { estado: "APLICADO" } }, include: { cobro: { include: { cobro_aplicacion: true } } } },
    },
  });
  if (!factura) throw new ErrorApi(404, "FACTURA_NO_ENCONTRADA", "Factura no encontrada");
  if (factura.estado === "ANULADA") throw new ErrorApi(409, "YA_ANULADA", "La factura ya estaba anulada");

  // Validar TODO antes de avisar a SAT: una vez anulada allá, ya no hay marcha atrás.
  if (factura.notas.length > 0) {
    throw new ErrorApi(409, "ANULACION_BLOQUEADA", "Tiene notas de crédito/débito certificadas; anúlelas primero");
  }
  const cobros = factura.cobro_aplicacion.map((a) => a.cobro);
  const compartido = cobros.find((c) => c.cobro_aplicacion.length > 1);
  if (compartido) {
    throw new ErrorApi(409, "COBRO_COMPARTIDO", `El cobro #${compartido.id_cobro} cubre varias facturas; anúlelo primero desde Pagos`);
  }
  const certificada = factura.estado === "CERTIFICADA" && !!factura.uuid_fel;
  if (certificada && factura.serie_documento.tipo_dte.signo_inventario > 0) {
    // anular una nota de crédito vuelve a sacar la mercadería
    await verificarStock(factura.detalle_factura.map((d) => ({ id_producto: d.id_producto, cantidad: Number(d.cantidad) })));
  }

  let uuidAnulacion: string | null = null;
  let simulada = false;
  if (certificada) {
    const { negocio } = factura;
    if (certificadorConfigurado(negocio)) {
      const resultado = await obtenerCertificador(negocio.certificador!).anular(
        factura.uuid_fel!,
        negocio.nit,
        factura.cliente.documento,
        formatoFechaFel(factura.fecha_emision),
        motivo,
        {
          usuarioApi: negocio.usuario_api!,
          llaveApi: descifrar(negocio.llave_api!),
          llaveFirma: descifrar(negocio.llave_firma!),
          ambiente: negocio.ambiente_fel as "CERTIFICACION" | "PRODUCCION",
        }
      );
      if (!resultado.exito) {
        throw new ErrorApi(502, "ANULACION_RECHAZADA", "El certificador rechazó la anulación", resultado.errores);
      }
      uuidAnulacion = resultado.uuid ?? `ANUL-${factura.uuid_fel}`;
    } else if (negocio.ambiente_fel === "PRODUCCION") {
      throw new ErrorApi(409, "FEL_NO_CONFIGURADO", "Configure el certificador FEL en los datos del negocio");
    } else {
      simulada = true;
    }
  }

  // Cobros de esta factura (uno por uno) y luego la factura, en una sola transacción.
  const etiqueta = `${factura.serie_documento.codigo_dte}-${factura.serie_documento.serie_interna} #${factura.numero_interno}`;
  await conUsuario(usuarioId, async (tx: Tx) => {
    for (const c of cobros) {
      await tx.$executeRaw`EXEC dbo.usp_anular_cobro @id_cobro = ${c.id_cobro}, @id_usuario = ${usuarioId}, @motivo = ${`Anulación de ${etiqueta}`}`;
    }
    if (simulada) {
      await tx.$executeRaw`EXEC dbo.usp_anular_simulado @id_factura = ${factura.id_factura}, @id_usuario = ${usuarioId}, @motivo = ${motivo}`;
    } else {
      await tx.$executeRaw`EXEC dbo.usp_anular_factura @id_factura = ${factura.id_factura}, @id_usuario = ${usuarioId}, @motivo = ${motivo}${opcional("@uuid_anulacion", uuidAnulacion)}${opcional("@fecha_anulacion_fel", uuidAnulacion ? new Date() : null)}`;
    }
  });

  await registrarAuditoria({ usuarioId, accion: "ANULAR", detalle: `${etiqueta}: ${motivo}` });
  return obtenerLista(factura.id_factura);
}

/** Fecha en formato FEL: ISO local de Guatemala con offset -06:00 */
export function formatoFechaFel(fecha: Date): string {
  const gt = new Date(fecha.getTime() - UTC_MENOS_6);
  return gt.toISOString().slice(0, 19) + "-06:00";
}

export { obtenerLista as obtenerFacturaLista };
