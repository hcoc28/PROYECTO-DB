"use client";

// ============================================================
// PÁGINA DE REPORTES — ruta: /reportes
// Libro de ventas: totales de las ventas válidas (pendientes y
// certificadas, menos notas de crédito) en un rango de fechas,
// exportable a CSV. Solo para el ADMIN.
// ============================================================

import { descargarCsv } from "@/lib/client/csv";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario, puedeOperar, esDirectivo } from "@/lib/client/apiCliente";
import { fechaLocalISO, quetzales } from "@/lib/client/formato";
import NavBar from "../_components/NavBar";
import { IconoAlerta, IconoDescarga, IconoFactura, IconoGrafica, IconoImpresora, IconoTendencia } from "../_components/iconos";

interface Factura {
  id_factura: number;
  numero: string;
  fecha_factura: string;
  subtotal: string;
  iva: string;
  total: string;
  estado: string;
  uuid_fel: string | null;
  cliente: { nombre_cliente: string; nit: string };
  serie: { tipo_documento: string; serie: string };
}

interface Reporte {
  totales: { cantidad: number; subtotal: string; iva: string; total: string };
  facturas: Factura[];
  hayMas: boolean;
}

function primerDiaDelMes(): string {
  const d = new Date();
  return fechaLocalISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

export default function PaginaReportes() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(fechaLocalISO());
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    if (!esDirectivo()) {
      router.replace("/");
      return;
    }
    setListo(true);
  }, [router]);

  async function buscar() {
    setError(null);
    const r = await apiFetch<Reporte>(`/api/v1/reportes/ventas?desde=${desde}&hasta=${hasta}`);
    if (r.ok && r.datos) setReporte(r.datos);
    else setError(r.error?.mensaje ?? "No se pudo generar el reporte");
  }

  useEffect(() => {
    if (listo) buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, desde, hasta]);

  function atajo(tipo: "hoy" | "semana" | "mes" | "anio") {
    const hoy = new Date();
    const inicio = new Date(hoy);
    if (tipo === "semana") inicio.setDate(hoy.getDate() - 6);
    if (tipo === "mes") inicio.setDate(1);
    if (tipo === "anio") {
      inicio.setMonth(0);
      inicio.setDate(1);
    }
    setDesde(fechaLocalISO(inicio));
    setHasta(fechaLocalISO(hoy));
  }

  const facturas = reporte?.facturas ?? [];

  // las notas de credito restan: en pantalla y en el CSV llevan signo negativo
  const signo = (f: { serie: { tipo_documento: string } }) => (f.serie.tipo_documento === "NCRE" ? "-" : "");

  function exportarCsv() {
    const filas = [
      ["Documento", "Fecha", "Cliente", "NIT", "Estado", "Subtotal", "IVA", "Total", "UUID"],
      ...facturas.map((f) => [
        `${f.serie.tipo_documento}-${f.serie.serie} ${f.numero}`,
        new Date(f.fecha_factura).toLocaleDateString("es-GT"),
        f.cliente.nombre_cliente,
        f.cliente.nit,
        f.estado,
        signo(f) + f.subtotal,
        signo(f) + f.iva,
        signo(f) + f.total,
        f.uuid_fel ?? "",
      ]),
    ];
    descargarCsv(`libro-ventas-${desde}-${hasta}.csv`, filas);
  }

  if (!listo) return null;

  return (
    <>
      <NavBar titulo="Reportes" />
      <main className="pagina">
        <div className="encabezado-pagina">
          <div>
            <h1 className="titulo-pagina">Libro de ventas</h1>
            <p className="subtitulo-pagina">Ventas del período, con las notas de crédito ya restadas</p>
          </div>
        </div>

        {/* ---------- Filtros ---------- */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
          className="tarjeta no-imprimir mb-5 flex flex-wrap items-end gap-3 p-4 sm:p-5"
        >
          <div className="flex w-full flex-wrap gap-2" role="group" aria-label="Atajos de fechas">
            {(
              [
                ["hoy", "Hoy"],
                ["semana", "Últimos 7 días"],
                ["mes", "Este mes"],
                ["anio", "Este año"],
              ] as const
            ).map(([valor, texto]) => (
              <button key={valor} type="button" onClick={() => atajo(valor)} className="pildora">
                {texto}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="f-desde" className="etiqueta">Desde</label>
            <input id="f-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="campo !w-44" />
          </div>
          <div>
            <label htmlFor="f-hasta" className="etiqueta">Hasta</label>
            <input id="f-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="campo !w-44" />
          </div>
          <button type="submit" className="boton boton-primario">Filtrar</button>
          <div className="flex gap-2.5 sm:ml-auto">
            <button type="button" onClick={() => window.print()} disabled={facturas.length === 0} className="boton boton-secundario">
              <IconoImpresora className="size-4" />
              Imprimir
            </button>
            <button type="button" onClick={exportarCsv} disabled={facturas.length === 0} className="boton boton-secundario">
              <IconoDescarga className="size-4" />
              Exportar CSV
            </button>
          </div>
        </form>

        {error && (
          <div className="alerta alerta-error mb-5" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="documento-imprimible">
        <div className="mb-4 hidden print:block">
          <h2 className="text-xl font-bold">Libro de ventas</h2>
          <p className="text-sm">
            Del {desde} al {hasta} · impreso {new Date().toLocaleString("es-GT")}
          </p>
        </div>
        {/* ---------- Totales ---------- */}
        <section className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Totales del período">
          <div className="tarjeta aparecer p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Base (sin IVA)</p>
                <p className="indicador-valor">{quetzales(reporte?.totales.subtotal)}</p>
              </div>
              <span className="icono-caja bg-slate-100 text-slate-600">
                <IconoGrafica className="size-5" />
              </span>
            </div>
          </div>
          <div className="tarjeta aparecer p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">IVA débito fiscal</p>
                <p className="indicador-valor">{quetzales(reporte?.totales.iva)}</p>
              </div>
              <span className="icono-caja bg-sky-50 text-sky-700">
                <IconoFactura className="size-5" />
              </span>
            </div>
          </div>
          <div className="tarjeta aparecer border-marca-200 bg-marca-50/60 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-marca-700">Total vendido</p>
                <p className="indicador-valor text-marca-900">{quetzales(reporte?.totales.total)}</p>
              </div>
              <span className="icono-caja bg-marca-100 text-marca-700">
                <IconoTendencia className="size-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-marca-700">{reporte?.totales.cantidad ?? 0} documento(s)</p>
          </div>
        </section>

        {/* ---------- Detalle ---------- */}
        <div className="tabla-contenedor aparecer">
          <table className="tabla">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Estado</th>
                <th className="num">Base</th>
                <th className="num">IVA</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => (
                <tr key={f.id_factura}>
                  <td className="whitespace-nowrap font-semibold text-slate-900">
                    {f.serie.tipo_documento}-{f.serie.serie} <span className="tabular-nums">#{f.numero}</span>
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{new Date(f.fecha_factura).toLocaleDateString("es-GT")}</td>
                  <td>{f.cliente.nombre_cliente}</td>
                  <td>
                    <span className={`chip ${f.estado === "CERTIFICADA" ? "chip-ok" : "chip-aviso"}`}>{f.estado}</span>
                  </td>
                  <td className={`num ${f.serie.tipo_documento === "NCRE" ? "text-red-700" : ""}`}>{f.serie.tipo_documento === "NCRE" ? "−" : ""}{quetzales(f.subtotal)}</td>
                  <td className={`num ${f.serie.tipo_documento === "NCRE" ? "text-red-700" : ""}`}>{f.serie.tipo_documento === "NCRE" ? "−" : ""}{quetzales(f.iva)}</td>
                  <td className={`num font-semibold ${f.serie.tipo_documento === "NCRE" ? "text-red-700" : "text-slate-900"}`}>{f.serie.tipo_documento === "NCRE" ? "−" : ""}{quetzales(f.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {facturas.length === 0 && (
            <div className="vacio">
              <IconoGrafica className="size-10 text-slate-300" />
              <p className="font-medium text-slate-500">No hay ventas en ese rango</p>
              <p>Prueba con otras fechas.</p>
            </div>
          )}
        </div>
        </div>
        {reporte?.hayMas && (
          <p className="mt-3 text-xs text-slate-500">
            Se muestran las primeras {facturas.length} filas; los totales de arriba incluyen todas.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Las notas de crédito (NCRE) se restan del total. Las facturas anuladas no se cuentan.
        </p>
      </main>
    </>
  );
}
