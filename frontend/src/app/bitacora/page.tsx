"use client";

// ============================================================
// PÁGINA DE BITÁCORA — ruta: /bitacora   (solo ADMIN)
// Registro de auditoría (tabla bitacora): quién hizo qué, cuándo
// y desde qué IP. Se puede filtrar por usuario, acción, texto y
// fechas, y exportar. Es de solo lectura.
// ============================================================

import { descargarCsv } from "@/lib/client/csv";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario } from "@/lib/client/apiCliente";
import { fechaLocalISO } from "@/lib/client/formato";
import NavBar from "../_components/NavBar";
import { IconoAlerta, IconoBitacora, IconoBuscar, IconoDescarga } from "../_components/iconos";

interface Registro {
  id_bitacora: string;
  accion: string;
  detalle: string | null;
  ip: string | null;
  fecha: string;
  usuario: { nombre_usuario: string } | null;
  usuario_intentado: string | null;
}

interface Respuesta {
  registros: Registro[];
  acciones: string[];
  usuarios: { id_usuario: number; nombre_usuario: string }[];
  paginacion: { total: number; paginas: number };
}

type Periodo = "hoy" | "semana" | "mes" | "todo" | "rango";

const POR_PAGINA = 30;

// Etiqueta legible y color de cada acción
const ACCIONES: Record<string, { texto: string; chip: string }> = {
  LOGIN: { texto: "Inicio de sesión", chip: "chip-neutro" },
  LOGIN_FALLIDO: { texto: "Intento fallido", chip: "chip-error" },
  CREAR_FACTURA: { texto: "Factura creada", chip: "chip-ok" },
  CERTIFICAR: { texto: "Certificación", chip: "chip-ok" },
  ANULAR: { texto: "Anulación", chip: "chip-error" },
  PAGAR: { texto: "Pago", chip: "chip-info" },
  CREAR_USUARIO: { texto: "Usuario creado", chip: "chip-marca" },
  ACTUALIZAR_USUARIO: { texto: "Usuario modificado", chip: "chip-aviso" },
  CREAR_PRODUCTO: { texto: "Producto creado", chip: "chip-ok" },
  ACTUALIZAR_PRODUCTO: { texto: "Producto modificado", chip: "chip-aviso" },
  CREAR_CLIENTE: { texto: "Cliente creado", chip: "chip-ok" },
  ACTUALIZAR_CLIENTE: { texto: "Cliente modificado", chip: "chip-aviso" },
  ACTUALIZAR_SERIE: { texto: "Serie modificada", chip: "chip-aviso" },
  ACTUALIZAR_NEGOCIO: { texto: "Negocio modificado", chip: "chip-aviso" },
  CAMBIAR_CONTRASENA: { texto: "Cambio de contraseña", chip: "chip-aviso" },
  LOGIN_BLOQUEADO: { texto: "Acceso bloqueado", chip: "chip-error" },
  ALERTA_FUERZA_BRUTA: { texto: "Alerta de fuerza bruta", chip: "chip-error" },
  LOGOUT: { texto: "Cierre de sesión", chip: "chip-neutro" },
  LEER_ESTADO_CUENTA: { texto: "Consulta de estado de cuenta", chip: "chip-neutro" },
  LEER_USUARIOS: { texto: "Consulta de usuarios", chip: "chip-neutro" },
  LEER_BITACORA: { texto: "Consulta de bitácora", chip: "chip-neutro" },
  LEER_REPORTE_VENTAS: { texto: "Consulta del libro de ventas", chip: "chip-neutro" },
};

function rangoDe(p: Periodo): { desde: string; hasta: string } {
  const hoy = new Date();
  if (p === "hoy") return { desde: fechaLocalISO(hoy), hasta: fechaLocalISO(hoy) };
  if (p === "semana") {
    const i = new Date(hoy);
    i.setDate(hoy.getDate() - 6);
    return { desde: fechaLocalISO(i), hasta: fechaLocalISO(hoy) };
  }
  if (p === "mes") return { desde: fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fechaLocalISO(hoy) };
  return { desde: "", hasta: "" };
}

export default function PaginaBitacora() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [desde, setDesde] = useState(rangoDe("semana").desde);
  const [hasta, setHasta] = useState(rangoDe("semana").hasta);
  const [accion, setAccion] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    if (obtenerUsuario()?.rol !== "ADMIN") {
      router.replace("/");
      return;
    }
    setListo(true);
  }, [router]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const parametros = useCallback(
    (extra: Record<string, string>) => {
      const params = new URLSearchParams(extra);
      if (accion) params.set("accion", accion);
      if (usuarioId) params.set("usuarioId", usuarioId);
      if (q) params.set("q", q);
      if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
      if (hasta) params.set("hasta", new Date(`${hasta}T23:59:59.999`).toISOString());
      return params;
    },
    [accion, usuarioId, q, desde, hasta]
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await apiFetch<Respuesta>(`/api/v1/bitacora?${parametros({ pagina: String(pagina), porPagina: String(POR_PAGINA) })}`);
    if (r.ok && r.datos) {
      setDatos(r.datos);
      setError(null);
    } else {
      setError(r.error?.mensaje ?? "No se pudo cargar la bitácora");
    }
    setCargando(false);
  }, [parametros, pagina]);

  useEffect(() => {
    if (listo) cargar();
  }, [listo, cargar]);

  function elegirPeriodo(p: Periodo) {
    setPeriodo(p);
    if (p !== "rango") {
      const r = rangoDe(p);
      setDesde(r.desde);
      setHasta(r.hasta);
    }
    setPagina(1);
  }

  async function exportarCsv() {
    const r = await apiFetch<Respuesta>(`/api/v1/bitacora?${parametros({ pagina: "1", porPagina: "200" })}`);
    const filas = r.datos?.registros ?? [];
    descargarCsv(`bitacora-${fechaLocalISO()}.csv`, [
      ["Fecha", "Usuario", "Acción", "Detalle", "IP"],
      ...filas.map((x) => [new Date(x.fecha).toLocaleString("es-GT"), x.usuario?.nombre_usuario ?? x.usuario_intentado ?? "", x.accion, x.detalle ?? "", x.ip ?? ""]),
    ]);
  }

  if (!listo) return null;

  const registros = datos?.registros ?? [];
  const total = datos?.paginacion.total ?? 0;
  const paginas = datos?.paginacion.paginas ?? 1;
  const hayFiltros = accion || usuarioId || q || periodo !== "semana";

  return (
    <>
      <NavBar titulo="Bitácora" />
      <main className="pagina">
        <div className="encabezado-pagina">
          <div>
            <h1 className="titulo-pagina">Bitácora</h1>
            <p className="subtitulo-pagina">
              {total} {total === 1 ? "evento registrado" : "eventos registrados"} · quién hizo qué y cuándo
            </p>
          </div>
          <button onClick={exportarCsv} disabled={registros.length === 0} className="boton boton-secundario">
            <IconoDescarga className="size-4" />
            Exportar CSV
          </button>
        </div>

        <div className="tarjeta mb-5 space-y-4 p-4 sm:p-5">
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
              <label htmlFor="b-desde" className="etiqueta">Desde</label>
              <input id="b-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => { setDesde(e.target.value); setPeriodo("rango"); setPagina(1); }} className="campo !w-44" />
            </div>
            <div>
              <label htmlFor="b-hasta" className="etiqueta">Hasta</label>
              <input id="b-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => { setHasta(e.target.value); setPeriodo("rango"); setPagina(1); }} className="campo !w-44" />
            </div>
            <div>
              <label htmlFor="b-usuario" className="etiqueta">Usuario</label>
              <select id="b-usuario" value={usuarioId} onChange={(e) => { setUsuarioId(e.target.value); setPagina(1); }} className="campo !w-44">
                <option value="">Todos</option>
                {datos?.usuarios.map((u) => (
                  <option key={u.id_usuario} value={u.id_usuario}>{u.nombre_usuario}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="b-accion" className="etiqueta">Acción</label>
              <select id="b-accion" value={accion} onChange={(e) => { setAccion(e.target.value); setPagina(1); }} className="campo !w-52">
                <option value="">Todas</option>
                {datos?.acciones.map((a) => (
                  <option key={a} value={a}>{ACCIONES[a]?.texto ?? a}</option>
                ))}
              </select>
            </div>
            <div className="relative min-w-52 flex-1">
              <label htmlFor="b-q" className="etiqueta">Buscar en el detalle</label>
              <IconoBuscar className="pointer-events-none absolute bottom-3 left-3.5 size-4 text-slate-500" />
              <input id="b-q" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej. Coca-Cola, factura #5…" className="campo campo-con-icono" autoComplete="off" />
            </div>
            {hayFiltros && (
              <button
                type="button"
                onClick={() => {
                  setAccion("");
                  setUsuarioId("");
                  setBusqueda("");
                  setQ("");
                  elegirPeriodo("semana");
                }}
                className="boton boton-texto"
              >
                Limpiar filtros
              </button>
            )}
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
                <th>Fecha y hora</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Detalle</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((x) => {
                const a = ACCIONES[x.accion] ?? { texto: x.accion, chip: "chip-neutro" };
                return (
                  <tr key={x.id_bitacora}>
                    <td className="whitespace-nowrap text-slate-500">{new Date(x.fecha).toLocaleString("es-GT")}</td>
                    <td className="whitespace-nowrap font-semibold text-slate-900">{x.usuario?.nombre_usuario ?? (x.usuario_intentado ? `${x.usuario_intentado} (no existe)` : "")}</td>
                    <td>
                      <span className={`chip ${a.chip}`}>{a.texto}</span>
                    </td>
                    <td className="max-w-md text-slate-600">{x.detalle ?? <span className="text-slate-300">—</span>}</td>
                    <td className="whitespace-nowrap font-mono text-xs text-slate-500">{x.ip ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!cargando && registros.length === 0 && (
            <div className="vacio">
              <IconoBitacora className="size-10 text-slate-300" />
              <p className="font-medium text-slate-500">No hay eventos con estos filtros</p>
              <p>Amplía el período o quita algún filtro.</p>
            </div>
          )}
          {cargando && registros.length === 0 && <div className="vacio">Cargando…</div>}
        </div>

        {paginas > 1 && (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginación">
            <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} className="boton boton-secundario boton-chico">
              Anterior
            </button>
            <span className="text-slate-500">
              Página {pagina} de {paginas}
            </span>
            <button onClick={() => setPagina((p) => Math.min(paginas, p + 1))} disabled={pagina >= paginas} className="boton boton-secundario boton-chico">
              Siguiente
            </button>
          </nav>
        )}
      </main>
    </>
  );
}
