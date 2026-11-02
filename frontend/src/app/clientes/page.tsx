"use client";

// ============================================================
// PÁGINA DE CLIENTES — ruta: /clientes
// Directorio de clientes (tabla cliente): buscar, registrar,
// editar, ver su historial de compras, venderle directamente y
// exportar la lista. El consumidor final (CF) está protegido.
// ============================================================

import { descargarCsv } from "@/lib/client/csv";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario, puedeOperar, esDirectivo } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { fechaLocalISO, quetzales } from "@/lib/client/formato";
import NavBar from "../_components/NavBar";
import {
  IconoAlerta,
  IconoBasura,
  IconoBuscar,
  IconoCarrito,
  IconoCerrar,
  IconoClientes,
  IconoDescarga,
  IconoEditar,
  IconoMas,
  IconoOjo,
} from "../_components/iconos";

interface Cliente {
  id_cliente: number;
  nombre_cliente: string;
  nit: string;
  tipo_documento: string;
  correo: string | null;
  telefono: string | null;
  direccion: string | null;
  compras: { cantidad: number; total: string; ultima: string | null };
}

interface FacturaCliente {
  id_factura: number;
  numero: string;
  fecha_factura: string;
  total: string;
  saldo: string;
  estado: string;
  serie: { tipo_documento: string; serie: string };
}

interface Ficha {
  cliente: Cliente;
  resumen: { cantidad: number; total: string };
  facturas: FacturaCliente[];
}

interface MovimientoCuenta {
  id_movimiento: number;
  fecha: string;
  tipo: string;
  id_factura: number | null;
  descripcion: string | null;
  cargo: string;
  abono: string;
  saldo: string;
}

// Estado de cuenta: lo que debe el cliente. Saldo positivo = debe; negativo = tiene saldo a favor.
interface Cuenta {
  saldo: string;
  cargos: string;
  abonos: string;
  movimientos: MovimientoCuenta[];
  hayMas: boolean;
}

const TIPO_MOVIMIENTO: Record<string, string> = {
  FACTURA: "Factura",
  NOTA_DEBITO: "Nota de débito",
  NOTA_CREDITO: "Nota de crédito",
  ANULACION_DOCUMENTO: "Anulación",
  COBRO: "Cobro",
  ANULACION_COBRO: "Cobro anulado",
};

const FORM_VACIO = { nombre_cliente: "", nit: "", correo: "", telefono: "", direccion: "" };
const POR_PAGINA = 25;

const CHIP: Record<string, string> = {
  BORRADOR: "chip-neutro",
  PENDIENTE_CERTIFICACION: "chip-aviso",
  CERTIFICADA: "chip-ok",
  PENDIENTE: "chip-aviso",
  RECHAZADA: "chip-error",
  ANULADA: "chip-neutro",
};

export default function PaginaClientes() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [esAdmin, setEsAdmin] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [paginas, setPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // formulario (crear / editar)
  const [formAbierto, setFormAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // ficha (historial)
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);

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

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ pagina: String(pagina), porPagina: String(POR_PAGINA) });
    if (q) params.set("q", q);
    const r = await apiFetch<{ clientes: Cliente[]; paginacion: { total: number; paginas: number } }>(
      `/api/v1/clientes?${params}`
    );
    if (r.ok && r.datos) {
      setClientes(r.datos.clientes);
      setTotal(r.datos.paginacion.total);
      setPaginas(r.datos.paginacion.paginas);
      setError(null);
    } else {
      setError(r.error?.mensaje ?? "No se pudieron cargar los clientes");
    }
    setCargando(false);
  }, [q, pagina]);

  useEffect(() => {
    if (listo) cargar();
  }, [listo, cargar]);

  function abrirNuevo() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setErrorForm(null);
    setFormAbierto(true);
  }

  function abrirEdicion(c: Cliente) {
    setEditandoId(c.id_cliente);
    setForm({
      nombre_cliente: c.nombre_cliente,
      nit: c.nit,
      correo: c.correo ?? "",
      telefono: c.telefono ?? "",
      direccion: c.direccion ?? "",
    });
    setErrorForm(null);
    setFicha(null);
    setFormAbierto(true);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setErrorForm(null);
    const r = await apiFetch(editandoId ? `/api/v1/clientes/${editandoId}` : "/api/v1/clientes", {
      method: editandoId ? "PUT" : "POST",
      body: JSON.stringify({
        nombre_cliente: form.nombre_cliente,
        nit: form.nit,
        correo: form.correo || null,
        telefono: form.telefono || null,
        direccion: form.direccion || null,
      }),
    });
    setGuardando(false);
    if (!r.ok) {
      setErrorForm(r.error?.mensaje ?? "No se pudo guardar el cliente");
      return;
    }
    notificar.ok(form.nombre_cliente, { titulo: editandoId ? "Cliente actualizado" : "Cliente creado" });
    setFormAbierto(false);
    cargar();
  }

  async function verFicha(c: Cliente) {
    setCuenta(null);
    const [r, rc] = await Promise.all([
      apiFetch<Ficha>(`/api/v1/clientes/${c.id_cliente}`),
      apiFetch<Cuenta>(`/api/v1/clientes/${c.id_cliente}/estado-cuenta`),
    ]);
    if (rc.ok && rc.datos) setCuenta(rc.datos);
    if (r.ok && r.datos) setFicha(r.datos);
    else setError(r.error?.mensaje ?? "No se pudo abrir la ficha");
  }

  async function eliminar(c: Cliente) {
    if (!confirm(`¿Eliminar al cliente "${c.nombre_cliente}"? Esta acción no se puede deshacer.`)) return;
    const r = await apiFetch(`/api/v1/clientes/${c.id_cliente}`, { method: "DELETE" });
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo eliminar");
      return;
    }
    notificar.ok(c.nombre_cliente, { titulo: "Cliente eliminado" });
    setFicha(null);
    cargar();
  }

  async function exportarCsv() {
    const r = await apiFetch<{ clientes: Cliente[] }>(`/api/v1/clientes?${new URLSearchParams({ porPagina: "100", ...(q && { q }) })}`);
    const filas = r.datos?.clientes ?? [];
    descargarCsv(`clientes-${fechaLocalISO()}.csv`, [
      ["Cliente", "NIT / DPI", "Correo", "Teléfono", "Dirección", "Compras", "Total comprado"],
      ...filas.map((c) => [c.nombre_cliente, c.nit, c.correo ?? "", c.telefono ?? "", c.direccion ?? "", c.compras.cantidad, c.compras.total]),
    ]);
  }

  if (!listo) return null;

  return (
    <>
      <NavBar titulo="Clientes" />
      <main className="pagina">
        <div className="encabezado-pagina">
          <div>
            <h1 className="titulo-pagina">Clientes</h1>
            <p className="subtitulo-pagina">
              {total} {total === 1 ? "cliente registrado" : "clientes registrados"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <div className="relative">
              <IconoBuscar className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre, NIT, correo o teléfono…"
                aria-label="Buscar cliente"
                className="campo campo-con-icono w-64"
                autoComplete="off"
              />
            </div>
            <button onClick={exportarCsv} disabled={clientes.length === 0} className="boton boton-secundario">
              <IconoDescarga className="size-4" />
              Exportar CSV
            </button>
            {puedeOperar() && (
              <button onClick={abrirNuevo} className="boton boton-primario">
                <IconoMas className="size-4" />
                Nuevo cliente
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
                <th>Cliente</th>
                <th>NIT / DPI</th>
                <th>Contacto</th>
                <th className="num">Compras</th>
                <th className="num">Total comprado</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => {
                const esCf = c.nit === "CF";
                return (
                  <tr key={c.id_cliente}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-marca-50 text-sm font-bold text-marca-700">
                          {c.nombre_cliente.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <button onClick={() => verFicha(c)} className="truncate text-left font-semibold text-slate-900 hover:text-marca-700 hover:underline">
                            {c.nombre_cliente}
                          </button>
                          {c.direccion && <p className="max-w-[16rem] truncate text-xs text-slate-500">{c.direccion}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs text-slate-600">
                      {c.nit} {esCf && <span className="chip chip-neutro ml-1">Consumidor final</span>}
                    </td>
                    <td className="text-sm text-slate-500">
                      {c.telefono && <p>{c.telefono}</p>}
                      {c.correo && <p className="max-w-[14rem] truncate text-xs text-slate-500">{c.correo}</p>}
                      {!c.telefono && !c.correo && <span className="text-slate-300">—</span>}
                    </td>
                    <td className="num">{c.compras.cantidad}</td>
                    <td className="num font-semibold text-slate-900">{quetzales(c.compras.total)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button onClick={() => verFicha(c)} className="boton boton-texto boton-chico" title="Ver historial">
                        <IconoOjo className="size-4" />
                        Ver
                      </button>
                      {puedeOperar() && (
                        <Link href={`/pos?nit=${encodeURIComponent(c.nit)}`} className="boton boton-texto boton-chico" title="Iniciar una venta a este cliente">
                          <IconoCarrito className="size-4" />
                          Vender
                        </Link>
                      )}
                      {!esCf && puedeOperar() && (
                        <button onClick={() => abrirEdicion(c)} className="boton boton-texto boton-chico" title="Editar">
                          <IconoEditar className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!cargando && clientes.length === 0 && (
            <div className="vacio">
              <IconoClientes className="size-10 text-slate-300" />
              <p className="font-medium text-slate-500">{q ? "Ningún cliente coincide" : "Aún no hay clientes"}</p>
              <p>{q ? "Prueba con otra búsqueda." : "Registra el primero con «Nuevo cliente»."}</p>
            </div>
          )}
          {cargando && clientes.length === 0 && <div className="vacio">Cargando…</div>}
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

      {/* ---------- Formulario: nuevo / editar ---------- */}
      {formAbierto && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setFormAbierto(false)}
        >
          <form onSubmit={guardar} className="tarjeta aparecer w-full max-w-lg p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="titulo-cliente">
            <h2 id="titulo-cliente" className="text-lg font-bold text-slate-900">
              {editandoId ? "Editar cliente" : "Nuevo cliente"}
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="c-nombre">Nombre completo o razón social</label>
                <input id="c-nombre" required autoFocus value={form.nombre_cliente} onChange={(e) => setForm({ ...form, nombre_cliente: e.target.value })} className="campo" maxLength={100} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="c-nit">NIT o DPI (CUI)</label>
                <input id="c-nit" required value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value.toUpperCase() })} className="campo uppercase" maxLength={15} placeholder="1234567-8 o DPI de 13 dígitos" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="c-tel">Teléfono</label>
                <input id="c-tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="campo" maxLength={15} />
              </div>
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="c-correo">Correo electrónico</label>
                <input id="c-correo" type="email" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} className="campo" maxLength={100} />
              </div>
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="c-dir">Dirección</label>
                <input id="c-dir" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="campo" maxLength={255} />
                <p className="ayuda">La dirección aparece en la factura cuando el cliente tiene NIT.</p>
              </div>
            </div>
            {errorForm && (
              <div className="alerta alerta-error mt-4" role="alert">
                <IconoAlerta className="mt-0.5 size-4 shrink-0" />
                <span>{errorForm}</span>
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setFormAbierto(false)} className="boton boton-secundario">
                Cancelar
              </button>
              <button type="submit" disabled={guardando} className="boton boton-primario">
                {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Registrar cliente"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------- Ficha del cliente ---------- */}
      {ficha && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setFicha(null)}
        >
          <div className="tarjeta aparecer w-full max-w-2xl p-6 shadow-2xl" role="dialog" aria-modal="true" aria-label="Ficha del cliente">
            <div className="flex items-start gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-marca-50 text-2xl font-bold text-marca-700">
                {ficha.cliente.nombre_cliente.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-bold text-slate-900">{ficha.cliente.nombre_cliente}</h2>
                <p className="text-sm text-slate-500">{ficha.cliente.tipo_documento === "CUI" ? "DPI" : "NIT"} {ficha.cliente.nit}</p>
                <p className="text-sm text-slate-500">
                  {[ficha.cliente.telefono, ficha.cliente.correo].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                </p>
                {ficha.cliente.direccion && <p className="text-sm text-slate-500">{ficha.cliente.direccion}</p>}
              </div>
              <button onClick={() => setFicha(null)} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
                <IconoCerrar className="size-5" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-500">Compras</p>
                <p className="text-2xl font-bold tabular-nums text-slate-900">{ficha.resumen.cantidad}</p>
              </div>
              <div className="rounded-xl bg-marca-50 p-4">
                <p className="text-xs font-medium text-marca-700">Total comprado</p>
                <p className="text-2xl font-bold tabular-nums text-marca-900">{quetzales(ficha.resumen.total)}</p>
              </div>
              {cuenta && (
                <div className={`rounded-xl p-4 ${Number(cuenta.saldo) > 0.005 ? "bg-amber-50" : Number(cuenta.saldo) < -0.005 ? "bg-emerald-50" : "bg-slate-50"}`}>
                  <p className={`text-xs font-medium ${Number(cuenta.saldo) > 0.005 ? "text-amber-700" : Number(cuenta.saldo) < -0.005 ? "text-emerald-700" : "text-slate-500"}`}>
                    {Number(cuenta.saldo) < -0.005 ? "Saldo a favor" : "Saldo que debe"}
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-slate-900">{quetzales(Math.abs(Number(cuenta.saldo)))}</p>
                </div>
              )}
            </div>

            <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Últimos documentos</h3>
            {ficha.facturas.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
                Todavía no tiene compras.
              </p>
            ) : (
              <div className="tabla-contenedor max-h-64 overflow-y-auto !shadow-none">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Documento</th>
                      <th>Fecha</th>
                      <th className="num">Total</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficha.facturas.map((f) => (
                      <tr key={f.id_factura}>
                        <td className="whitespace-nowrap font-semibold">
                          <Link href={`/facturas/${f.id_factura}`} className="text-marca-700 hover:underline">
                            {f.serie.tipo_documento}-{f.serie.serie} #{f.numero}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap text-slate-500">{new Date(f.fecha_factura).toLocaleDateString("es-GT")}</td>
                        <td className="num font-semibold text-slate-900">{quetzales(f.total)}</td>
                        <td>
                          <span className={`chip ${CHIP[f.estado] ?? "chip-neutro"}`}>{f.estado}</span>
                          {f.estado !== "ANULADA" && f.serie.tipo_documento === "FACT" && Number(f.saldo) > 0.005 && (
                            <span className="chip chip-aviso ml-1.5">Debe {quetzales(f.saldo)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Estado de cuenta</h3>
            {!cuenta || cuenta.movimientos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
                Todavía no tiene movimientos.
              </p>
            ) : (
              <>
                <div className="tabla-contenedor max-h-64 overflow-y-auto !shadow-none">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Movimiento</th>
                        <th className="num">Cargo</th>
                        <th className="num">Abono</th>
                        <th className="num">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuenta.movimientos.map((m) => (
                        <tr key={m.id_movimiento}>
                          <td className="whitespace-nowrap text-slate-500">{new Date(m.fecha).toLocaleDateString("es-GT")}</td>
                          <td>
                            <span className="font-medium text-slate-900">{TIPO_MOVIMIENTO[m.tipo] ?? m.tipo}</span>
                            {m.descripcion && (
                              <span className="block text-xs text-slate-500">
                                {m.id_factura ? (
                                  <Link href={`/facturas/${m.id_factura}`} className="hover:text-marca-700 hover:underline">
                                    {m.descripcion}
                                  </Link>
                                ) : (
                                  m.descripcion
                                )}
                              </span>
                            )}
                          </td>
                          <td className="num text-slate-900">{Number(m.cargo) > 0 ? quetzales(m.cargo) : ""}</td>
                          <td className="num text-emerald-700">{Number(m.abono) > 0 ? quetzales(m.abono) : ""}</td>
                          <td className="num font-semibold text-slate-900">{quetzales(m.saldo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Cargo = lo que se le factura · Abono = lo que paga o se le acredita.
                  {cuenta.hayMas && " Se muestran los 200 movimientos más recientes."}
                </p>
              </>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {ficha.cliente.nit !== "CF" && (
                  <button onClick={() => abrirEdicion(ficha.cliente)} className="boton boton-secundario">
                    <IconoEditar className="size-4" />
                    Editar
                  </button>
                )}
                {esAdmin && ficha.cliente.nit !== "CF" && ficha.resumen.cantidad === 0 && ficha.facturas.length === 0 && (
                  <button onClick={() => eliminar(ficha.cliente)} className="boton boton-texto text-red-600 hover:!bg-red-50">
                    <IconoBasura className="size-4" />
                    Eliminar
                  </button>
                )}
              </div>
              <Link href={`/pos?nit=${encodeURIComponent(ficha.cliente.nit)}`} className="boton boton-primario">
                <IconoCarrito className="size-4" />
                Iniciar venta
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
