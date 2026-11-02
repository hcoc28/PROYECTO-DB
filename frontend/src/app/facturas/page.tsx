"use client";

// ============================================================
// PÁGINA DE FACTURACIÓN — ruta: /facturas
// Historial de facturas emitidas: buscar por cliente/NIT/número,
// filtrar por estado y fechas, abrir cada factura para ver su
// detalle, y (ADMIN) anular. Exporta lo que se está viendo a CSV.
// ============================================================

import { descargarCsv } from "@/lib/client/csv";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario } from "@/lib/client/apiCliente";
import { fechaLocalISO, quetzales } from "@/lib/client/formato";
import NavBar from "../_components/NavBar";
import ModalAnular from "../_components/ModalAnular";
import { IconoAlerta, IconoBuscar, IconoDescarga, IconoFactura, IconoOjo } from "../_components/iconos";

interface Factura {
  id_factura: number;
  numero: string;
  fecha_factura: string;
  subtotal: string;
  iva: string;
  total: string;
  pagado: string;
  saldo: string;
  estado: string;
  uuid_fel: string | null;
  cliente: { nombre_cliente: string; nit: string };
  serie: { tipo_documento: string; serie: string };
  usuario: { nombre_usuario: string };
}

interface Paginacion {
  pagina: number;
  paginas: number;
  total: number;
}

const CHIP: Record<string, string> = {
  BORRADOR: "chip-neutro",
  PENDIENTE_CERTIFICACION: "chip-aviso",
  CERTIFICADA: "chip-ok",
  PENDIENTE: "chip-aviso",
  RECHAZADA: "chip-error",
  ANULADA: "chip-neutro line-through",
};

const ESTADOS = [
  { valor: "", texto: "Todas" },
  { valor: "CERTIFICADA", texto: "Certificadas" },
  { valor: "BORRADOR", texto: "Borradores" },
  { valor: "PENDIENTE_CERTIFICACION", texto: "Pendientes de certificación" },
  { valor: "RECHAZADA", texto: "Rechazadas" },
  { valor: "ANULADA", texto: "Anuladas" },
];

const POR_PAGINA = 25;

export default function PaginaFacturas() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [esAdmin, setEsAdmin] = useState(false);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [paginacion, setPaginacion] = useState<Paginacion>({ pagina: 1, paginas: 1, total: 0 });
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState(""); // la búsqueda ya aplicada (con pausa al escribir)
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aAnular, setAAnular] = useState<Factura | null>(null);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    setEsAdmin(obtenerUsuario()?.rol === "ADMIN");
    setListo(true);
  }, [router]);

  // Espera un momento después de dejar de escribir antes de buscar
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ pagina: String(pagina), porPagina: String(POR_PAGINA) });
    if (estado) params.set("estado", estado);
    if (q) params.set("q", q);
    // Día completo en hora local: de las 00:00 a las 23:59:59
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (hasta) params.set("hasta", new Date(`${hasta}T23:59:59.999`).toISOString());
    const r = await apiFetch<{ facturas: Factura[]; paginacion: Paginacion }>(`/api/v1/facturas?${params}`);
    if (r.ok && r.datos) {
      setFacturas(r.datos.facturas);
      setPaginacion(r.datos.paginacion);
      setError(null);
    } else {
      setError(r.error?.mensaje ?? "No se pudieron cargar las facturas");
    }
    setCargando(false);
  }, [estado, q, desde, hasta, pagina]);

  useEffect(() => {
    if (listo) cargar();
  }, [listo, cargar]);

  function cambiarFiltro(fn: () => void) {
    fn();
    setPagina(1);
  }

  function limpiar() {
    setEstado("");
    setBusqueda("");
    setQ("");
    setDesde("");
    setHasta("");
    setPagina(1);
  }

  function exportarCsv() {
    const filas = [
      ["Documento", "Fecha", "Cliente", "NIT", "Estado", "Subtotal", "IVA", "Total", "Pagado", "Saldo", "Atendió"],
      ...facturas.map((f) => [
        `${f.serie.tipo_documento}-${f.serie.serie} ${f.numero}`,
        new Date(f.fecha_factura).toLocaleString("es-GT"),
        f.cliente.nombre_cliente,
        f.cliente.nit,
        f.estado,
        f.subtotal,
        f.iva,
        f.total,
        f.pagado,
        f.saldo,
        f.usuario.nombre_usuario,
      ]),
    ];
    descargarCsv(`facturas-${fechaLocalISO()}.csv`, filas);
  }

  if (!listo) return null;

  const hayFiltros = estado || q || desde || hasta;

  return (
    <>
      <NavBar titulo="Facturas" />
      <main className="pagina">
        <div className="encabezado-pagina">
          <div>
            <h1 className="titulo-pagina">Facturas</h1>
            <p className="subtitulo-pagina">
              {paginacion.total} {paginacion.total === 1 ? "documento" : "documentos"}
              {hayFiltros ? " con los filtros aplicados" : paginacion.total === 1 ? " emitido" : " emitidos"}
            </p>
          </div>
          <button onClick={exportarCsv} disabled={facturas.length === 0} className="boton boton-secundario">
            <IconoDescarga className="size-4" />
            Exportar CSV
          </button>
        </div>

        {/* ---------- Filtros ---------- */}
        <div className="tarjeta mb-5 space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-60 flex-1">
              <label htmlFor="f-q" className="etiqueta">
                Buscar
              </label>
              <IconoBuscar className="pointer-events-none absolute bottom-3 left-3.5 size-4 text-slate-500" />
              <input
                id="f-q"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Cliente, NIT o número de factura…"
                className="campo campo-con-icono"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="f-desde" className="etiqueta">
                Desde
              </label>
              <input
                id="f-desde"
                type="date"
                value={desde}
                max={hasta || undefined}
                onChange={(e) => cambiarFiltro(() => setDesde(e.target.value))}
                className="campo !w-44"
              />
            </div>
            <div>
              <label htmlFor="f-hasta" className="etiqueta">
                Hasta
              </label>
              <input
                id="f-hasta"
                type="date"
                value={hasta}
                min={desde || undefined}
                onChange={(e) => cambiarFiltro(() => setHasta(e.target.value))}
                className="campo !w-44"
              />
            </div>
            {hayFiltros && (
              <button type="button" onClick={limpiar} className="boton boton-texto">
                Limpiar filtros
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
            {ESTADOS.map((e) => (
              <button
                key={e.valor}
                type="button"
                onClick={() => cambiarFiltro(() => setEstado(e.valor))}
                aria-pressed={estado === e.valor}
                className={`pildora ${estado === e.valor ? "pildora-activa" : ""}`}
              >
                {e.texto}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="alerta alerta-error mb-4" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="tabla-contenedor aparecer">
          <table className="tabla">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th className="num">Total</th>
                <th>Pago</th>
                <th>Estado</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => {
                const anulada = f.estado === "ANULADA";
                const debe = Number(f.saldo);
                const esVenta = f.serie.tipo_documento === "FACT";
                return (
                  <tr key={f.id_factura} className={anulada ? "bg-slate-50 [&_td]:text-slate-600 [&_.text-slate-500]:text-slate-600" : undefined}>
                    <td className="whitespace-nowrap font-semibold">
                      <Link href={`/facturas/${f.id_factura}`} className="text-marca-700 hover:underline">
                        {f.serie.tipo_documento}-{f.serie.serie} <span className="tabular-nums">#{f.numero}</span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{new Date(f.fecha_factura).toLocaleString("es-GT")}</td>
                    <td>
                      {f.cliente.nombre_cliente} <span className="text-slate-500">({f.cliente.nit})</span>
                    </td>
                    <td className="num font-semibold text-slate-900">{quetzales(f.total)}</td>
                    <td className="whitespace-nowrap">
                      {anulada || !esVenta ? (
                        <span className="text-slate-300">—</span>
                      ) : debe > 0.005 ? (
                        <span className="chip chip-aviso">Debe {quetzales(debe)}</span>
                      ) : (
                        <span className="chip chip-ok">Pagada</span>
                      )}
                    </td>
                    <td>
                      <span className={`chip ${CHIP[f.estado] ?? "chip-neutro"}`}>{f.estado}</span>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Link href={`/facturas/${f.id_factura}`} className="boton boton-texto boton-chico">
                        <IconoOjo className="size-4" />
                        Ver
                      </Link>
                      {esAdmin && !anulada && (
                        <button onClick={() => setAAnular(f)} className="boton boton-texto boton-chico text-red-600 hover:!bg-red-50">
                          Anular
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!cargando && facturas.length === 0 && (
            <div className="vacio">
              <IconoFactura className="size-10 text-slate-300" />
              <p className="font-medium text-slate-500">No hay facturas para mostrar</p>
              <p>{hayFiltros ? "Prueba quitando algún filtro." : "Cuando hagas una venta aparecerá aquí."}</p>
            </div>
          )}
          {cargando && facturas.length === 0 && <div className="vacio">Cargando…</div>}
        </div>

        {paginacion.paginas > 1 && (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginación">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1}
              className="boton boton-secundario boton-chico"
            >
              Anterior
            </button>
            <span className="text-slate-500">
              Página {paginacion.pagina} de {paginacion.paginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(paginacion.paginas, p + 1))}
              disabled={pagina >= paginacion.paginas}
              className="boton boton-secundario boton-chico"
            >
              Siguiente
            </button>
          </nav>
        )}
      </main>

      {aAnular && (
        <ModalAnular
          idFactura={aAnular.id_factura}
          etiqueta={`${aAnular.serie.tipo_documento}-${aAnular.serie.serie} #${aAnular.numero}`}
          onCerrar={() => setAAnular(null)}
          onAnulada={() => {
            setAAnular(null);
            cargar();
          }}
        />
      )}
    </>
  );
}
