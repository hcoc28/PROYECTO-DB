"use client";

// ============================================================
// PÁGINA DE PAGOS — ruta: /pagos
// Dos vistas:
//  · Historial: todos los cobros con filtros (fecha, método, texto),
//    resumen por método de pago y corte de caja imprimible.
//  · Por cobrar: facturas con saldo pendiente, para cobrarlas o
//    registrar abonos.
// ============================================================

import { descargarCsv } from "@/lib/client/csv";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario, puedeOperar, esDirectivo } from "@/lib/client/apiCliente";
import { fechaLocalISO, quetzales } from "@/lib/client/formato";
import NavBar from "../_components/NavBar";
import ModalPago, { type FacturaParaPago } from "../_components/ModalPago";
import ModalAnularCobro, { type CobroParaAnular } from "../_components/ModalAnularCobro";
import {
  IconoAlerta,
  IconoBuscar,
  IconoDescarga,
  IconoDinero,
  IconoEdificio,
  IconoFactura,
  IconoImpresora,
  IconoQr,
  IconoReloj,
  IconoTarjeta,
  IconoTendencia,
  IconoTransferencia,
} from "../_components/iconos";

interface Pago {
  id_pago: number;
  id_cobro: number;
  estado: string; // APLICADO | ANULADO
  fecha_pago: string;
  monto: string;
  metodo_pago: string;
  referencia: string | null;
  factura: {
    id_factura: number;
    uuid_fel: string | null;
    serie_fel: string | null;
    numero_fel: string | null;
    numero: string;
    estado: string;
    total: string;
    serie: { tipo_documento: string; serie: string };
    cliente: { nombre_cliente: string; nit: string };
  };
}

interface Resumen {
  total: string;
  cantidad: number;
  porMetodo: Record<string, { monto: string; cantidad: number }>;
}

interface PorCobrar {
  id_factura: number;
  numero: string;
  fecha_factura: string;
  total: string;
  pagado: string;
  saldo: string;
  estado: string;
  cliente: { nombre_cliente: string; nit: string };
  serie: { tipo_documento: string; serie: string };
}

const METODO: Record<string, { texto: string; chip: string; Icono: typeof IconoDinero }> = {
  EFECTIVO: { texto: "Efectivo", chip: "chip-ok", Icono: IconoDinero },
  TARJETA: { texto: "Tarjeta", chip: "chip-info", Icono: IconoTarjeta },
  TRANSFERENCIA: { texto: "Transferencia", chip: "chip-marca", Icono: IconoTransferencia },
  QR: { texto: "Código QR", chip: "chip-neutro", Icono: IconoQr },
  DEPOSITO: { texto: "Depósito", chip: "chip-info", Icono: IconoEdificio },
  CHEQUE: { texto: "Cheque", chip: "chip-neutro", Icono: IconoFactura },
};

const POR_PAGINA = 25;

type Periodo = "hoy" | "semana" | "mes" | "todo" | "rango";

function rangoDe(periodo: Periodo): { desde: string; hasta: string } {
  const hoy = new Date();
  if (periodo === "hoy") return { desde: fechaLocalISO(hoy), hasta: fechaLocalISO(hoy) };
  if (periodo === "semana") {
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - 6);
    return { desde: fechaLocalISO(inicio), hasta: fechaLocalISO(hoy) };
  }
  if (periodo === "mes") return { desde: fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fechaLocalISO(hoy) };
  return { desde: "", hasta: "" };
}

function etiquetaFactura(p: Pago["factura"]): string {
  // mismo nombre que en la lista de facturas (FACT-A #4), no la serie del certificador
  return `${p.serie.tipo_documento}-${p.serie.serie} #${p.numero}`;
}

export default function PaginaPagos() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [vista, setVista] = useState<"historial" | "cobrar">("historial");

  // ---- historial ----
  const [periodo, setPeriodo] = useState<Periodo>("hoy");
  const [desde, setDesde] = useState(rangoDe("hoy").desde);
  const [hasta, setHasta] = useState(rangoDe("hoy").hasta);
  const [metodo, setMetodo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [anuladas, setAnuladas] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);

  // ---- por cobrar ----
  const [porCobrar, setPorCobrar] = useState<PorCobrar[]>([]);
  const [totalPorCobrar, setTotalPorCobrar] = useState("0");
  const [aCobrar, setACobrar] = useState<FacturaParaPago | null>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [anularCobro, setAnularCobro] = useState<CobroParaAnular | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    setEsAdmin(obtenerUsuario()?.rol === "ADMIN");
    setListo(true);
  }, [router]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  function elegirPeriodo(p: Periodo) {
    setPeriodo(p);
    if (p !== "rango") {
      const r = rangoDe(p);
      setDesde(r.desde);
      setHasta(r.hasta);
    }
    setPagina(1);
  }

  const parametros = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams(extra);
      if (metodo) params.set("metodo", metodo);
      if (q) params.set("q", q);
      if (anuladas) params.set("anuladas", "1");
      if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
      if (hasta) params.set("hasta", new Date(`${hasta}T23:59:59.999`).toISOString());
      return params;
    },
    [metodo, q, anuladas, desde, hasta]
  );

  const cargarHistorial = useCallback(async () => {
    setCargando(true);
    const r = await apiFetch<{ pagos: Pago[]; resumen: Resumen; paginacion: { paginas: number } }>(
      `/api/v1/pagos?${parametros({ pagina: String(pagina), porPagina: String(POR_PAGINA) })}`
    );
    if (r.ok && r.datos) {
      setPagos(r.datos.pagos);
      setResumen(r.datos.resumen);
      setTotalPaginas(r.datos.paginacion.paginas);
      setError(null);
    } else {
      setError(r.error?.mensaje ?? "No se pudieron cargar los pagos");
    }
    setCargando(false);
  }, [parametros, pagina]);

  const cargarPorCobrar = useCallback(async () => {
    const r = await apiFetch<{ facturas: PorCobrar[]; totalPorCobrar: string }>("/api/v1/pagos/por-cobrar");
    if (r.ok && r.datos) {
      setPorCobrar(r.datos.facturas);
      setTotalPorCobrar(r.datos.totalPorCobrar);
    }
  }, []);

  useEffect(() => {
    if (listo) cargarHistorial();
  }, [listo, cargarHistorial]);

  useEffect(() => {
    if (listo) cargarPorCobrar();
  }, [listo, cargarPorCobrar]);

  async function exportarCsv() {
    // Exporta todo lo que cumple el filtro (no solo la página visible)
    const r = await apiFetch<{ pagos: Pago[] }>(`/api/v1/pagos?${parametros({ pagina: "1", porPagina: "100" })}`);
    const filas = r.datos?.pagos ?? [];
    descargarCsv(`pagos-${desde || "inicio"}-${hasta || "hoy"}.csv`, [
      ["Fecha", "Cliente", "NIT", "Factura", "Método", "Referencia", "Monto"],
      ...filas.map((p) => [
        new Date(p.fecha_pago).toLocaleString("es-GT"),
        p.factura.cliente.nombre_cliente,
        p.factura.cliente.nit,
        etiquetaFactura(p.factura),
        METODO[p.metodo_pago]?.texto ?? p.metodo_pago,
        p.referencia ?? "",
        p.monto,
      ]),
    ]);
  }

  if (!listo) return null;

  const textoPeriodo =
    periodo === "todo" || (!desde && !hasta)
      ? "Todo el historial"
      : desde === hasta
        ? new Date(`${desde}T12:00:00`).toLocaleDateString("es-GT", { dateStyle: "long" })
        : `${desde || "…"} al ${hasta || "…"}`;

  return (
    <>
      <NavBar titulo="Pagos" />
      <main className="pagina">
        <div className="encabezado-pagina">
          <div>
            <h1 className="titulo-pagina">Pagos</h1>
            <p className="subtitulo-pagina">Cobros recibidos, corte de caja y cuentas por cobrar</p>
          </div>
          <div className="flex gap-2" role="tablist" aria-label="Vista">
            <button
              role="tab"
              aria-selected={vista === "historial"}
              onClick={() => setVista("historial")}
              className={`pildora ${vista === "historial" ? "pildora-activa" : ""}`}
            >
              Historial de cobros
            </button>
            <button
              role="tab"
              aria-selected={vista === "cobrar"}
              onClick={() => setVista("cobrar")}
              className={`pildora ${vista === "cobrar" ? "pildora-activa" : ""}`}
            >
              Por cobrar
              {porCobrar.length > 0 && <span className="chip chip-aviso ml-2 !px-1.5 !py-0">{porCobrar.length}</span>}
            </button>
          </div>
        </div>

        {error && (
          <div className="alerta alerta-error mb-4" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* =================== HISTORIAL =================== */}
        {vista === "historial" && (
          <>
            <div className="tarjeta no-imprimir mb-5 space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
                {(
                  [
                    ["hoy", "Hoy"],
                    ["semana", "Últimos 7 días"],
                    ["mes", "Este mes"],
                    ["todo", "Todo"],
                  ] as [Periodo, string][]
                ).map(([valor, texto]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => elegirPeriodo(valor)}
                    aria-pressed={periodo === valor}
                    className={`pildora ${periodo === valor ? "pildora-activa" : ""}`}
                  >
                    {texto}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="p-desde" className="etiqueta">
                    Desde
                  </label>
                  <input
                    id="p-desde"
                    type="date"
                    value={desde}
                    max={hasta || undefined}
                    onChange={(e) => {
                      setDesde(e.target.value);
                      setPeriodo("rango");
                      setPagina(1);
                    }}
                    className="campo !w-44"
                  />
                </div>
                <div>
                  <label htmlFor="p-hasta" className="etiqueta">
                    Hasta
                  </label>
                  <input
                    id="p-hasta"
                    type="date"
                    value={hasta}
                    min={desde || undefined}
                    onChange={(e) => {
                      setHasta(e.target.value);
                      setPeriodo("rango");
                      setPagina(1);
                    }}
                    className="campo !w-44"
                  />
                </div>
                <div>
                  <label htmlFor="p-metodo" className="etiqueta">
                    Método
                  </label>
                  <select
                    id="p-metodo"
                    value={metodo}
                    onChange={(e) => {
                      setMetodo(e.target.value);
                      setPagina(1);
                    }}
                    className="campo !w-44"
                  >
                    <option value="">Todos</option>
                    {Object.entries(METODO).map(([valor, m]) => (
                      <option key={valor} value={valor}>
                        {m.texto}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative min-w-56 flex-1">
                  <label htmlFor="p-q" className="etiqueta">
                    Buscar
                  </label>
                  <IconoBuscar className="pointer-events-none absolute bottom-3 left-3.5 size-4 text-slate-500" />
                  <input
                    id="p-q"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Cliente, NIT o referencia…"
                    className="campo campo-con-icono"
                    autoComplete="off"
                  />
                </div>
              </div>
              <label className="flex w-fit items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={anuladas}
                  onChange={(e) => {
                    setAnuladas(e.target.checked);
                    setPagina(1);
                  }}
                  className="size-4 rounded border-slate-300 accent-marca-600"
                />
                Incluir pagos de facturas anuladas
              </label>
            </div>

            {/* Todo lo de aquí abajo es lo que se imprime como corte de caja */}
            <div className="documento-imprimible">
              <div className="mb-4 hidden print:block">
                <h2 className="text-xl font-bold">Corte de caja</h2>
                <p className="text-sm">
                  {textoPeriodo}
                  {metodo && ` · ${METODO[metodo]?.texto}`} · impreso {new Date().toLocaleString("es-GT")}
                </p>
              </div>

              <section className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3" aria-label="Resumen de cobros">
                <div className="tarjeta aparecer col-span-2 border-marca-200 bg-marca-50/60 p-5 lg:col-span-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-marca-700">Total cobrado</p>
                      <p className="indicador-valor text-marca-900">{quetzales(resumen?.total)}</p>
                    </div>
                    <span className="icono-caja no-imprimir bg-marca-100 text-marca-700">
                      <IconoTendencia className="size-5" />
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-marca-700">
                    {resumen?.cantidad ?? 0} {resumen?.cantidad === 1 ? "pago" : "pagos"} · {textoPeriodo}
                  </p>
                </div>
                {Object.entries(METODO).map(([valor, m]) => (
                  <div key={valor} className="tarjeta aparecer p-5">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                      <m.Icono className="size-4" />
                      {m.texto}
                    </div>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                      {quetzales(resumen?.porMetodo[valor]?.monto)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{resumen?.porMetodo[valor]?.cantidad ?? 0} pago(s)</p>
                  </div>
                ))}
              </section>

              <div className="tabla-contenedor aparecer">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Factura</th>
                      <th>Método</th>
                      <th>Referencia</th>
                      <th className="num">Monto</th>
                      {esAdmin && <th><span className="sr-only">Acciones</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pagos.map((p) => {
                      const m = METODO[p.metodo_pago] ?? { texto: p.metodo_pago, chip: "chip-neutro", Icono: IconoDinero };
                      const anulada = p.factura.estado === "ANULADA" || p.estado === "ANULADO";
                      return (
                        <tr key={p.id_pago} className={anulada ? "opacity-60" : undefined}>
                          <td className="whitespace-nowrap text-slate-500">{new Date(p.fecha_pago).toLocaleString("es-GT")}</td>
                          <td>{p.factura.cliente.nombre_cliente}</td>
                          <td className="whitespace-nowrap font-medium tabular-nums">
                            <Link href={`/facturas/${p.factura.id_factura}`} className="text-marca-700 hover:underline">
                              {etiquetaFactura(p.factura)}
                            </Link>
                            {anulada && <span className="chip chip-neutro ml-2">Anulada</span>}
                          </td>
                          <td>
                            <span className={`chip ${m.chip}`}>
                              <m.Icono className="size-3.5" />
                              {m.texto}
                            </span>
                          </td>
                          <td className="text-slate-500">{p.referencia ?? "—"}</td>
                          <td className={`num font-semibold text-slate-900 ${anulada ? "line-through" : ""}`}>{quetzales(p.monto)}</td>
                          {esAdmin && (
                            <td className="no-imprimir text-right">
                              {!anulada && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAnularCobro({
                                      id_cobro: p.id_cobro,
                                      monto: p.monto,
                                      metodo: m.texto,
                                      etiqueta: etiquetaFactura(p.factura),
                                    })
                                  }
                                  className="boton boton-texto boton-chico text-red-600 hover:!bg-red-50"
                                  title="Anular este cobro (se registró por error)"
                                >
                                  Anular
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!cargando && pagos.length === 0 && (
                  <div className="vacio">
                    <IconoTarjeta className="size-10 text-slate-300" />
                    <p className="font-medium text-slate-500">No hay pagos en este período</p>
                    <p>Cambia las fechas o quita algún filtro.</p>
                  </div>
                )}
                {cargando && pagos.length === 0 && <div className="vacio">Cargando…</div>}
              </div>
            </div>

            <div className="no-imprimir mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2.5">
                <button onClick={() => window.print()} className="boton boton-secundario boton-chico">
                  <IconoImpresora className="size-4" />
                  Imprimir corte de caja
                </button>
                <button onClick={exportarCsv} disabled={pagos.length === 0} className="boton boton-secundario boton-chico">
                  <IconoDescarga className="size-4" />
                  Exportar CSV
                </button>
              </div>
              {totalPaginas > 1 && (
                <nav className="flex items-center gap-3 text-sm" aria-label="Paginación">
                  <button
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    disabled={pagina <= 1}
                    className="boton boton-secundario boton-chico"
                  >
                    Anterior
                  </button>
                  <span className="text-slate-500">
                    Página {pagina} de {totalPaginas}
                  </span>
                  <button
                    onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                    disabled={pagina >= totalPaginas}
                    className="boton boton-secundario boton-chico"
                  >
                    Siguiente
                  </button>
                </nav>
              )}
            </div>
          </>
        )}

        {/* =================== POR COBRAR =================== */}
        {vista === "cobrar" && (
          <>
            <div className="tarjeta aparecer mb-5 flex items-center gap-4 border-amber-200 bg-amber-50/60 p-5">
              <span className="icono-caja bg-amber-100 text-amber-700">
                <IconoReloj className="size-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-amber-800">Total por cobrar</p>
                <p className="indicador-valor text-amber-900">{quetzales(totalPorCobrar)}</p>
              </div>
              <p className="ml-auto text-sm text-amber-800">
                {porCobrar.length} {porCobrar.length === 1 ? "factura con saldo" : "facturas con saldo"}
              </p>
            </div>

            <div className="tabla-contenedor aparecer">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th className="num">Total</th>
                    <th className="num">Pagado</th>
                    <th className="num">Saldo</th>
                    <th><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {porCobrar.map((f) => {
                    const dias = Math.floor((Date.now() - new Date(f.fecha_factura).getTime()) / 86_400_000);
                    const etiqueta = `${f.serie.tipo_documento}-${f.serie.serie} #${f.numero}`;
                    return (
                      <tr key={f.id_factura}>
                        <td className="whitespace-nowrap font-semibold">
                          <Link href={`/facturas/${f.id_factura}`} className="text-marca-700 hover:underline">
                            {etiqueta}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap text-slate-500">
                          {new Date(f.fecha_factura).toLocaleDateString("es-GT")}
                          <span className={`ml-2 text-xs ${dias >= 15 ? "font-semibold text-red-600" : "text-slate-500"}`}>
                            {dias === 0 ? "hoy" : `hace ${dias} d`}
                          </span>
                        </td>
                        <td>
                          {f.cliente.nombre_cliente} <span className="text-slate-500">({f.cliente.nit})</span>
                        </td>
                        <td className="num">{quetzales(f.total)}</td>
                        <td className="num text-slate-500">{quetzales(f.pagado)}</td>
                        <td className="num font-bold text-amber-700">{quetzales(f.saldo)}</td>
                        <td className="text-right">
                          {puedeOperar() && (
                          <button
                            onClick={() =>
                              setACobrar({
                                id_factura: f.id_factura,
                                etiqueta,
                                cliente: f.cliente.nombre_cliente,
                                saldo: Number(f.saldo),
                              })
                            }
                            className="boton boton-primario boton-chico"
                          >
                            Cobrar
                          </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {porCobrar.length === 0 && (
                <div className="vacio">
                  <IconoDinero className="size-10 text-slate-300" />
                  <p className="font-medium text-slate-500">No hay cuentas por cobrar</p>
                  <p>Todas las facturas están pagadas completas.</p>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {anularCobro && (
        <ModalAnularCobro
          cobro={anularCobro}
          onCerrar={() => setAnularCobro(null)}
          onAnulado={() => {
            setAnularCobro(null);
            cargarHistorial();
            cargarPorCobrar();
          }}
        />
      )}

      {aCobrar && (
        <ModalPago
          factura={aCobrar}
          onCerrar={() => setACobrar(null)}
          onRegistrado={() => {
            setACobrar(null);
            cargarPorCobrar();
            cargarHistorial();
          }}
        />
      )}
    </>
  );
}
