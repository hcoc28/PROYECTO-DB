"use client";

// ============================================================
// PÁGINA DE UNA FACTURA — ruta: /facturas/{id}
// El documento completo: quién emite, a quién, qué se vendió,
// totales con IVA, pagos y saldo. Se puede imprimir (hoja carta),
// registrar un pago/abono y, si eres ADMIN, anular.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario, puedeOperar, esDirectivo } from "@/lib/client/apiCliente";
import { montoEnLetras, quetzales } from "@/lib/client/formato";
import NavBar from "../../_components/NavBar";
import ModalPago from "../../_components/ModalPago";
import ModalAnular from "../../_components/ModalAnular";
import ModalNotaCredito from "../../_components/ModalNotaCredito";
import ModalAnularCobro, { type CobroParaAnular } from "../../_components/ModalAnularCobro";
import { IconoAlerta, IconoFlecha, IconoImpresora, IconoTarjeta } from "../../_components/iconos";

interface Detalle {
  factura: {
    id_factura: number;
    id_cliente: number;
    numero: string;
    fecha_factura: string;
    subtotal: string;
    iva: string;
    total: string;
    estado: string;
    uuid_fel: string | null;
    serie_fel: string | null;
    numero_fel: string | null;
    fecha_certificacion: string | null;
    motivo_anulacion: string | null;
    motivo_referencia: string | null;
    referencia: {
      id_factura: number;
      numero: string;
      fecha: string;
      serie: string;
      tipo_documento: string;
      serie_fel: string | null;
      numero_fel: string | null;
    } | null;
    cliente: { nombre_cliente: string; nit: string; direccion: string | null; correo: string | null; telefono: string | null };
    serie: { tipo_documento: string; serie: string };
    usuario: { nombre_usuario: string };
    detalle_factura: {
      id_detalle: number;
      id_producto: number;
      cantidad: number;
      precio_unitario: string;
      descuento: string;
      subtotal_linea: string;
      producto: { nombre_producto: string; codigo_barras: string | null; tipo_iva: string };
    }[];
    pago: { id_pago: number; id_cobro: number; fecha_pago: string; monto: string; metodo_pago: string; referencia: string | null }[];
  };
  // Cada cambio de estado de la factura: lo escribe la base de datos sola
  historial: {
    id_historial: number;
    fecha: string;
    estado_anterior: string | null;
    estado_nuevo: string;
    usuario: string | null;
    motivo: string | null;
  }[];
  negocio: {
    nit: string;
    razon_social: string;
    nombre_comercial: string;
    direccion: string;
    municipio: string;
    departamento: string;
    certificador: string | null;
  } | null;
  pagado: string;
  saldo: string;
  // Notas de crédito que corrigen esta factura; "acreditado" cuenta solo las certificadas
  notas: { id_factura: number; numero: string; serie: string; total: string; estado: string }[];
  acreditado: { total: string; porProducto: Record<number, number> };
}

const ESTADO_HISTORIAL: Record<string, string> = {
  BORRADOR: "Creada",
  PENDIENTE_CERTIFICACION: "Enviada a certificar",
  CERTIFICADA: "Certificada",
  RECHAZADA: "Rechazada por el certificador",
  ANULADA: "Anulada",
};

const CHIP: Record<string, string> = {
  BORRADOR: "chip-neutro",
  PENDIENTE_CERTIFICACION: "chip-aviso",
  CERTIFICADA: "chip-ok",
  PENDIENTE: "chip-aviso",
  RECHAZADA: "chip-error",
  ANULADA: "chip-neutro",
};

const TEXTO_ESTADO: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE_CERTIFICACION: "Pendiente de certificación",
  CERTIFICADA: "Certificada",
  PENDIENTE: "Pendiente",
  RECHAZADA: "Rechazada",
  ANULADA: "Anulada",
};

const TEXTO_METODO: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  TRANSFERENCIA: "Transferencia",
  QR: "Código QR",
  DEPOSITO: "Depósito",
  CHEQUE: "Cheque",
};

// Datos publicos del certificador (aparecen en toda factura FEL). Solo se conoce el NIT de Infile.
function datosCertificador(nombre: string | null, simulado: boolean) {
  if (simulado) return { nombre: "Certificador simulado (pruebas)", nit: null };
  if (nombre && nombre.toLowerCase().includes("infile")) return { nombre: "INFILE, S.A.", nit: "1252133-7" };
  return nombre ? { nombre, nit: null } : null;
}

const BASE_IMPRESION = 600;

export default function PaginaFactura() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [listo, setListo] = useState(false);
  const [esAdmin, setEsAdmin] = useState(false);
  const [datos, setDatos] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"pago" | "anular" | "nota" | null>(null);
  const [anularCobro, setAnularCobro] = useState<CobroParaAnular | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    setEsAdmin(obtenerUsuario()?.rol === "ADMIN");
    setListo(true);
  }, [router]);

  const cargar = useCallback(async () => {
    const r = await apiFetch<Detalle>(`/api/v1/facturas/${id}`);
    if (r.ok && r.datos) {
      setDatos(r.datos);
      setError(null);
    } else {
      setError(r.error?.mensaje ?? "No se pudo cargar la factura");
    }
  }, [id]);

  useEffect(() => {
    if (listo) cargar();
  }, [listo, cargar]);

  const uuidFel = datos?.factura.uuid_fel ?? null;
  const esSimulado = !!uuidFel && uuidFel.startsWith("SIM-");
  const nitEmisor = datos?.negocio?.nit ?? "";
  const nitReceptor = datos?.factura.cliente.nit ?? "";
  const totalDoc = datos?.factura.total ?? "";
  useEffect(() => {
    if (!uuidFel) {
      setQr(null);
      return;
    }
    // Certificada de verdad: el QR abre el verificador publico de la SAT. Simulada: solo lleva el UUID.
    const soloDigitos = (n: string) => n.replace(/[^0-9Kk]/g, "");
    const contenido = esSimulado
      ? uuidFel
      : `https://felpub.c.sat.gob.gt/verificador-web/publico/vista/verificacion.xhtml?tipo=autorizacion&numero=${uuidFel}&emisor=${soloDigitos(nitEmisor)}&receptor=${soloDigitos(nitReceptor)}&monto=${totalDoc}`;
    QRCode.toDataURL(contenido, { margin: 0, width: 160 }).then(setQr).catch(() => setQr(null));
  }, [uuidFel, esSimulado, nitEmisor, nitReceptor, totalDoc]);

  if (!listo) return null;

  const f = datos?.factura;
  const saldo = Number(datos?.saldo ?? 0);
  const anulada = f?.estado === "ANULADA";
  const esVenta = f?.serie.tipo_documento === "FACT";
  const etiqueta = f ? `${f.serie.tipo_documento}-${f.serie.serie} #${f.numero}` : "";
  const exento = f ? Number(f.total) - Number(f.subtotal) - Number(f.iva) : 0;
  const nombreDocumento = f?.serie.tipo_documento === "NCRE" ? "Nota de crédito" : "Factura";
  const simulado = !!f && (f.serie_fel === "SIM" || !!f.uuid_fel?.startsWith("SIM-"));
  // Escala al imprimir para que quede en UNA sola hoja carta. Los numeros salen de medir el documento impreso:
  // BASE_IMPRESION px fijos + ~33 px por linea (+ avisos). Caben ~975 px.
  const alturaImpresion = f
    ? BASE_IMPRESION + 33.4 * f.detalle_factura.length + (f.referencia ? 20 : 0) + (anulada ? 45 : 0)
    : 0;
  const estiloImpresion = { "--zoom-impresion": f ? Math.min(1, Math.max(0.4, 975 / alturaImpresion)).toFixed(3) : "1" } as React.CSSProperties;
  // Un documento que no esta certificado (o es de prueba) no debe parecer una factura valida
  const sinCertificar = !!f && !["CERTIFICADA", "ANULADA"].includes(f.estado);
  const marcaAgua = anulada ? "ANULADA" : sinCertificar ? "NO CERTIFICADA" : simulado ? "SIN VALIDEZ FISCAL" : null;
  const certificador = f ? datosCertificador(datos?.negocio?.certificador ?? null, simulado) : null;

  return (
    <>
      <NavBar titulo={f ? etiqueta : "Factura"} />
      <main className="pagina max-w-4xl">
        <h1 className="sr-only">{f ? `${f.serie.tipo_documento}-${f.serie.serie} #${f.numero}` : "Factura"}</h1>
        <div className="no-imprimir mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/facturas" className="boton boton-texto">
            <IconoFlecha className="size-4 rotate-180" />
            Todas las facturas
          </Link>
          {f && (
            <div className="flex flex-wrap gap-2.5">
              <button onClick={() => window.print()} className="boton boton-secundario">
                <IconoImpresora className="size-4" />
                Imprimir
              </button>
              {esVenta && !anulada && saldo > 0.005 && puedeOperar() && (
                <button onClick={() => setModal("pago")} className="boton boton-primario">
                  <IconoTarjeta className="size-4" />
                  Registrar pago
                </button>
              )}
              {esAdmin && esVenta && f.estado === "CERTIFICADA" && (
                <button onClick={() => setModal("nota")} className="boton boton-secundario">
                  Nota de crédito
                </button>
              )}
              {esAdmin && !anulada && (
                <button onClick={() => setModal("anular")} className="boton boton-secundario text-red-600 hover:!bg-red-50">
                  Anular
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="alerta alerta-error" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!f && !error && <div className="vacio">Cargando…</div>}

        {f && datos && (
          <>
          <article className="documento-imprimible tarjeta aparecer relative overflow-hidden p-6 text-slate-900 sm:p-10">
            {/* Marca de agua: documento anulado, aun sin certificar, o de prueba */}
            {marcaAgua && (
              <div
                aria-hidden="true"
                className="marca-agua pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden"
              >
                <span
                  className={`-rotate-[28deg] select-none whitespace-nowrap border-[6px] px-6 py-1 text-5xl font-black tracking-widest ${
                    anulada ? "border-red-600/15 text-red-600/15" : "border-slate-500/15 text-slate-500/15"
                  }`}
                >
                  {marcaAgua}
                </span>
              </div>
            )}

            <div className="contenido-doc" style={estiloImpresion}>
            {/* ---------- Encabezado: quien emite y datos del documento ---------- */}
            <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-slate-900 pb-5">
              <div className="min-w-[14rem] flex-1">
                <p className="text-2xl font-extrabold uppercase leading-tight tracking-tight">
                  {datos.negocio?.nombre_comercial ?? "Mi negocio"}
                </p>
                {datos.negocio && (
                  <div className="mt-2 space-y-0.5 text-sm leading-snug text-slate-700">
                    <p>{datos.negocio.razon_social}</p>
                    <p>NIT: {datos.negocio.nit}</p>
                    <p>
                      {datos.negocio.direccion}, {datos.negocio.municipio}, {datos.negocio.departamento}
                    </p>
                  </div>
                )}
              </div>
              <div className="min-w-[15rem] border-2 border-slate-900 px-4 py-3 text-center">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600">FEL · {nombreDocumento} electrónica</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums leading-none">
                  No. {f.serie.serie}-{String(f.numero).padStart(6, "0")}
                </p>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  {TEXTO_ESTADO[f.estado] ?? f.estado}
                </p>
              </div>
            </header>

            {anulada && (
              <div className="alerta alerta-error mt-4">
                <IconoAlerta className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong>Documento anulado.</strong> {f.motivo_anulacion ?? ""}
                </span>
              </div>
            )}

            {/* ---------- Nota de crédito/débito: a qué factura corrige y por qué ---------- */}
            {/* ---------- Cliente y datos del documento ---------- */}
            <section className="mt-5 grid gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2">
              <div className="bg-white p-4">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
                  {esVenta ? "Datos del cliente" : "Cliente"}
                </h2>
                <p className="mt-1.5 text-base font-bold leading-tight">{f.cliente.nombre_cliente}</p>
                <p className="mt-0.5 text-sm text-slate-700">NIT: {f.cliente.nit}</p>
                {f.cliente.direccion && <p className="text-sm text-slate-700">{f.cliente.direccion}</p>}
                {(f.cliente.telefono || f.cliente.correo) && (
                  <p className="text-sm text-slate-700 print:hidden">{[f.cliente.telefono, f.cliente.correo].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <div className="bg-white p-4 text-sm">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Datos del documento</h2>
                <dl className="mt-1.5 space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-600">Fecha y hora</dt>
                  <dd className="font-semibold tabular-nums">
                    {new Date(f.fecha_factura).toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" })}{" "}
                    {new Date(f.fecha_factura).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" })}
                  </dd>
                </div>
                {f.referencia && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Modifica</dt>
                    <dd className="font-semibold">
                      <Link href={`/facturas/${f.referencia.id_factura}`} className="underline-offset-2 hover:underline">
                        Factura {f.referencia.serie}-{String(f.referencia.numero).padStart(6, "0")}
                      </Link>
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-600">Condición de pago</dt>
                  <dd className="font-semibold">{esVenta && saldo > 0.005 && !anulada ? "Crédito" : "Contado"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-600">Moneda</dt>
                  <dd className="font-semibold">Quetzales (GTQ)</dd>
                </div>
                </dl>
              </div>
            </section>

            {/* ---------- Productos ---------- */}
            <section className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="border-y-2 border-slate-900 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
                    <th className="w-10 px-3 py-2 text-center">#</th>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2 text-right">Cant.</th>
                    <th className="px-3 py-2 text-right">Precio unit.</th>
                    <th className="px-3 py-2 text-right">Desc.</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {f.detalle_factura.map((d, i) => (
                    <tr key={d.id_detalle} className="break-inside-avoid border-b border-slate-200">
                      <td className="px-3 py-2.5 print:py-1.5 text-center tabular-nums text-slate-600">{i + 1}</td>
                      <td className="px-3 py-2.5 [overflow-wrap:anywhere] print:py-1.5">
                        <p className="font-semibold">{d.producto.nombre_producto}</p>
                        {(d.producto.codigo_barras || d.producto.tipo_iva === "EXENTO") && (
                          <p className="text-xs text-slate-600">
                            {[d.producto.codigo_barras, d.producto.tipo_iva === "EXENTO" && "exento de IVA"].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 print:py-1.5 text-right tabular-nums">{d.cantidad}</td>
                      <td className="px-3 py-2.5 print:py-1.5 text-right tabular-nums">{quetzales(d.precio_unitario)}</td>
                      <td className="px-3 py-2.5 print:py-1.5 text-right tabular-nums text-slate-600">
                        {Number(d.descuento) > 0 ? quetzales(d.descuento) : "—"}
                      </td>
                      <td className="px-3 py-2.5 print:py-1.5 text-right font-semibold tabular-nums">{quetzales(d.subtotal_linea)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* ---------- Total en letras y totales ---------- */}
            <section className="mt-5 grid items-start gap-6 break-inside-avoid sm:grid-cols-5">
              <div className="sm:col-span-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Total en letras</p>
                <p className="mt-1 text-sm font-semibold leading-snug">{montoEnLetras(f.total)}</p>
                <p className="mt-3 text-xs text-slate-600">Precios con IVA incluido.</p>
              </div>
              <dl className="space-y-1.5 text-sm sm:col-span-2">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Subtotal (sin IVA)</dt>
                  <dd className="tabular-nums">{quetzales(f.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">IVA 12%</dt>
                  <dd className="tabular-nums">{quetzales(f.iva)}</dd>
                </div>
                {exento > 0.005 && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Exento de IVA</dt>
                    <dd className="tabular-nums">{quetzales(exento)}</dd>
                  </div>
                )}
                <div className="mt-2 flex items-baseline justify-between border-t-2 border-slate-900 pt-2">
                  <dt className="text-sm font-bold uppercase tracking-wide">Total</dt>
                  <dd className="text-2xl font-extrabold tabular-nums">{quetzales(f.total)}</dd>
                </div>
              </dl>
            </section>

            {/* ---------- Certificación SAT ---------- */}
            <div className="break-inside-avoid">
            {f.uuid_fel && (
              <section className="mt-6 break-inside-avoid border border-slate-300 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-[16rem] flex-1">
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
                      Documento tributario electrónico · Certificación SAT
                    </h2>
                    <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-slate-600">Serie</dt>
                        <dd className="font-semibold">{f.serie_fel ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-600">No. de DTE</dt>
                        <dd className="font-semibold tabular-nums">{f.numero_fel ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-600">Correlativo</dt>
                        <dd className="font-semibold tabular-nums">
                          {f.serie.serie}-{String(f.numero).padStart(6, "0")}
                        </dd>
                      </div>
                      <div className="sm:col-span-3">
                        <dt className="text-xs text-slate-600">Número de autorización</dt>
                        <dd className="break-all font-mono text-xs font-semibold">{f.uuid_fel}</dd>
                      </div>
                      {f.fecha_certificacion && (
                        <div className="sm:col-span-3">
                          <dt className="text-xs text-slate-600">Fecha de certificación</dt>
                          <dd className="font-semibold tabular-nums">
                            {new Date(f.fecha_certificacion).toLocaleString("es-GT", { timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {certificador && (
                      <p className="mt-3 text-xs text-slate-600">
                        <span className="font-bold uppercase tracking-wider">Datos del certificador:</span>{" "}
                        {certificador.nit && <>NIT {certificador.nit} · </>}
                        {certificador.nombre}
                      </p>
                    )}
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Sujeto a pagos trimestrales ISR</p>
                  </div>
                  {qr && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="Código QR de verificación del documento" className="size-28 shrink-0" />
                  )}
                </div>
              </section>
            )}

            {/* ---------- Pie ---------- */}
            <footer className="mt-8 border-t border-slate-300 pt-4 text-center text-xs text-slate-600">
              {esVenta && !anulada && <p className="text-sm font-semibold text-slate-700">¡Gracias por su compra!</p>}
              <p className="mt-1">{nombreDocumento} {etiqueta} · Documento tributario electrónico</p>
            </footer>
            </div>
            </div>
          </article>

          {/* ---------- Pagos (interno: no forma parte del documento) ---------- */}
          {esVenta && (
            <section className="no-imprimir tarjeta mt-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Pagos recibidos · atendió {f.usuario.nombre_usuario} (interno, no se imprime)</h2>
                {anulada ? null : saldo > 0.005 ? (
                  <span className="chip chip-aviso">Saldo pendiente: {quetzales(saldo)}</span>
                ) : (
                  <span className="chip chip-ok">Pagada completa</span>
                )}
              </div>
              {f.pago.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">Todavía no se ha registrado ningún pago.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-200 text-sm">
                  {f.pago.map((p) => (
                    <li key={p.id_pago} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-slate-600">
                        {new Date(p.fecha_pago).toLocaleString("es-GT")} ·{" "}
                        <span className="font-semibold text-slate-800">{TEXTO_METODO[p.metodo_pago] ?? p.metodo_pago}</span>
                        {p.referencia && <span> · ref. {p.referencia}</span>}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold tabular-nums">{quetzales(p.monto)}</span>
                        {esAdmin && !anulada && (
                          <button
                            type="button"
                            onClick={() =>
                              setAnularCobro({
                                id_cobro: p.id_cobro,
                                monto: p.monto,
                                metodo: TEXTO_METODO[p.metodo_pago] ?? p.metodo_pago,
                                etiqueta,
                              })
                            }
                            className="no-imprimir text-xs font-semibold text-red-600 hover:underline"
                            title="Anular este cobro (se registró por error)"
                          >
                            Anular
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                  <li className="flex justify-between pt-2 font-bold">
                    <span>Total pagado</span>
                    <span className="tabular-nums">{quetzales(datos.pagado)}</span>
                  </li>
                </ul>
              )}
            </section>
          )}

          {datos.notas.length > 0 && (
            <section className="no-imprimir tarjeta mt-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Notas de crédito de esta factura</h2>
                <span className="chip chip-neutro">Acreditado: {quetzales(datos.acreditado.total)}</span>
              </div>
              <ul className="mt-2 divide-y divide-slate-200 text-sm">
                {datos.notas.map((n) => (
                  <li key={n.id_factura} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/facturas/${n.id_factura}`} className="font-semibold text-marca-700 hover:underline">
                      Nota {n.serie}-{String(n.numero).padStart(6, "0")}
                    </Link>
                    <span className="flex items-center gap-3">
                      <span className={`chip ${CHIP[n.estado] ?? "chip-neutro"}`}>{TEXTO_ESTADO[n.estado] ?? n.estado}</span>
                      <span className="font-semibold tabular-nums">−{quetzales(n.total)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {f.motivo_referencia && (
            <section className="no-imprimir tarjeta mt-5 p-5">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Motivo de la nota (interno, no se imprime)</h2>
              <p className="mt-1.5 text-sm font-semibold">{f.motivo_referencia}</p>
            </section>
          )}

            {/* ---------- Historial de estados (no se imprime) ---------- */}
            {datos.historial.length > 0 && (
              <section className="no-imprimir tarjeta mt-5 p-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Historial interno (no se imprime)</h2>
                <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4 text-sm">
                  {datos.historial.map((h) => (
                    <li key={h.id_historial} className="relative">
                      <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-marca-500 ring-4 ring-white" aria-hidden="true" />
                      <p className="font-semibold">{ESTADO_HISTORIAL[h.estado_nuevo] ?? h.estado_nuevo}</p>
                      <p className="text-slate-600">
                        {new Date(h.fecha).toLocaleString("es-GT")}
                        {h.usuario && <> · por {h.usuario}</>}
                      </p>
                      {h.motivo && <p className="text-slate-600">Motivo: {h.motivo}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>

      {modal === "pago" && f && (
        <ModalPago
          factura={{ id_factura: f.id_factura, etiqueta, cliente: f.cliente.nombre_cliente, saldo }}
          onCerrar={() => setModal(null)}
          onRegistrado={() => {
            setModal(null);
            cargar();
          }}
        />
      )}
      {anularCobro && (
        <ModalAnularCobro
          cobro={anularCobro}
          onCerrar={() => setAnularCobro(null)}
          onAnulado={() => {
            setAnularCobro(null);
            cargar();
          }}
        />
      )}
      {modal === "nota" && f && datos && (
        <ModalNotaCredito
          idFactura={f.id_factura}
          idCliente={f.id_cliente}
          etiqueta={etiqueta}
          totalFactura={Number(f.total)}
          lineas={f.detalle_factura.map((d) => ({
            id_producto: d.id_producto,
            nombre: d.producto.nombre_producto,
            cantidad: d.cantidad,
            precio_unitario: Number(d.precio_unitario),
            descuento: Number(d.descuento),
          }))}
          yaAcreditado={datos.acreditado.porProducto}
          onCerrar={() => setModal(null)}
          onEmitida={(idNota) => {
            setModal(null);
            router.push(`/facturas/${idNota}`);
          }}
        />
      )}
      {modal === "anular" && f && (
        <ModalAnular
          idFactura={f.id_factura}
          etiqueta={etiqueta}
          onCerrar={() => setModal(null)}
          onAnulada={() => {
            setModal(null);
            cargar();
          }}
        />
      )}
    </>
  );
}
