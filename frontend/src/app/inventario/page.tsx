"use client";

// ============================================================
// PÁGINA DE INVENTARIO — ruta: /inventario
// Lista de productos con su existencia (stock) actual.
// El ADMIN puede agregar productos, editarlos (nombre, precio,
// IVA, código), ajustar la existencia (entradas/mermas) y
// desactivar los que ya no se venden.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario, puedeOperar, esDirectivo } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { quetzales } from "@/lib/client/formato";
import { STOCK_MINIMO } from "@/lib/client/constantes";
import NavBar from "../_components/NavBar";
import { IconoAlerta, IconoBuscar, IconoCaja, IconoCerrar, IconoMas } from "../_components/iconos";

interface Producto {
  id_producto: number;
  nombre_producto: string;
  sku: string | null;
  codigo_barras: string | null;
  precio: string;
  stock: number;
  tipo_iva: string;
  codigo_unidad: string;
  tipo_item: string; // BIEN | SERVICIO
  controla_stock: boolean; // un servicio no lleva existencia
  activo: boolean;
}

interface Unidad {
  codigo: string;
  nombre: string;
}

interface MovimientoKardex {
  id_movimiento: number;
  fecha: string;
  tipo: string;
  cantidad: number;
  stock_resultante: number;
  observacion: string | null;
  usuario: string | null;
  id_factura: number | null;
  documento: string | null;
}

const TIPO_MOVIMIENTO: Record<string, string> = {
  ENTRADA: "Entrada",
  AJUSTE: "Ajuste",
  VENTA: "Venta",
  DEVOLUCION: "Devolución de cliente",
  REVERSA_VENTA: "Venta anulada",
  REVERSA_DEVOLUCION: "Devolución anulada",
};

const NUEVO_VACIO = { nombre_producto: "", codigo_barras: "", precio: "", stock: "", tipo_iva: "GRAVADO", codigo_unidad: "UNI", tipo_item: "BIEN" };

const FILTROS = [
  { valor: "todos", texto: "Todos" },
  { valor: "bajo", texto: "Stock bajo" },
  { valor: "agotado", texto: "Agotados" },
  { valor: "inactivo", texto: "Desactivados" },
] as const;

type Filtro = (typeof FILTROS)[number]["valor"];

export default function PaginaInventario() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [esAdmin, setEsAdmin] = useState(false);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nuevo, setNuevo] = useState(NUEVO_VACIO);
  const [error, setError] = useState<string | null>(null);

  // edición
  const [editando, setEditando] = useState<Producto | null>(null);
  const [form, setForm] = useState({ nombre: "", codigo: "", precio: "", iva: "GRAVADO", unidad: "UNI", tipo: "BIEN", ajuste: "", motivo: "" });
  const [unidades, setUnidades] = useState<Unidad[]>([]);

  // kardex (historial de entradas y salidas de un producto)
  const [kardexDe, setKardexDe] = useState<Producto | null>(null);
  const [kardex, setKardex] = useState<MovimientoKardex[] | null>(null);
  const [errorKardex, setErrorKardex] = useState<string | null>(null);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    setEsAdmin(obtenerUsuario()?.rol === "ADMIN");
    setListo(true);
  }, [router]);

  const cargar = useCallback(async () => {
    const params = new URLSearchParams({ inactivos: "1", porPagina: "100" });
    if (q) params.set("q", q);
    const r = await apiFetch<{ productos: Producto[] }>(`/api/v1/productos?${params}`);
    if (r.ok && r.datos) setProductos(r.datos.productos);
  }, [q]);

  useEffect(() => {
    if (listo) cargar();
  }, [listo, cargar]);

  useEffect(() => {
    if (!listo) return;
    apiFetch<{ unidades: Unidad[] }>("/api/v1/unidades").then((r) => {
      if (r.ok && r.datos) setUnidades(r.datos.unidades);
    });
  }, [listo]);

  async function abrirKardex(p: Producto) {
    setKardexDe(p);
    setKardex(null);
    setErrorKardex(null);
    const r = await apiFetch<{ movimientos: MovimientoKardex[] }>(`/api/v1/productos/${p.id_producto}/kardex?porPagina=100`);
    if (r.ok && r.datos) setKardex(r.datos.movimientos);
    else setErrorKardex(r.error?.mensaje ?? "No se pudo cargar el kardex");
  }

  async function crearProducto(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await apiFetch("/api/v1/productos", {
      method: "POST",
      body: JSON.stringify({
        nombre_producto: nuevo.nombre_producto,
        codigo_barras: nuevo.codigo_barras || undefined,
        precio: Number(nuevo.precio),
        stock: nuevo.tipo_item === "SERVICIO" ? 0 : Number(nuevo.stock || 0),
        tipo_iva: nuevo.tipo_iva,
        codigo_unidad: nuevo.codigo_unidad,
        tipo_item: nuevo.tipo_item,
      }),
    });
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo crear el producto");
      return;
    }
    notificar.ok(nuevo.nombre_producto, { titulo: "Producto creado" });
    setNuevo(NUEVO_VACIO);
    setMostrarForm(false);
    cargar();
  }

  function abrirEdicion(p: Producto) {
    setEditando(p);
    setErrorEdicion(null);
    setForm({
      nombre: p.nombre_producto,
      codigo: p.codigo_barras ?? "",
      precio: Number(p.precio).toFixed(2),
      iva: p.tipo_iva,
      unidad: p.codigo_unidad,
      tipo: p.tipo_item,
      ajuste: "",
      motivo: "",
    });
  }

  async function guardarEdicion(e: React.FormEvent, cambioActivo?: boolean) {
    e.preventDefault();
    if (!editando || guardando) return;
    setGuardando(true);
    setErrorEdicion(null);
    const ajuste = Math.trunc(Number(form.ajuste) || 0);
    const r = await apiFetch(`/api/v1/productos/${editando.id_producto}`, {
      method: "PUT",
      body: JSON.stringify({
        nombre_producto: form.nombre.trim(),
        codigo_barras: form.codigo.trim() || null,
        precio: Number(form.precio),
        tipo_iva: form.iva,
        codigo_unidad: form.unidad,
        tipo_item: form.tipo,
        ...(cambioActivo !== undefined && { activo: cambioActivo }),
        ...(ajuste !== 0 && { ajusteStock: ajuste, motivoAjuste: form.motivo.trim() || "ajuste manual" }),
      }),
    });
    setGuardando(false);
    if (!r.ok) {
      setErrorEdicion(r.error?.mensaje ?? "No se pudo guardar");
      return;
    }
    if (cambioActivo !== undefined) notificar.ok(form.nombre.trim(), { titulo: cambioActivo ? "Producto activado" : "Producto desactivado" });
    else notificar.ok(form.nombre.trim(), { titulo: "Producto actualizado" });
    if (ajuste !== 0) notificar.info(`${ajuste > 0 ? "+" : ""}${ajuste} unidad(es) en el kardex`, { titulo: "Existencia ajustada" });
    setEditando(null);
    cargar();
  }

  if (!listo) return null;

  // Los servicios no llevan existencia: no cuentan como "agotados" ni suman al valor del inventario.
  const conStock = productos.filter((p) => p.activo && p.controla_stock);
  const bajos = conStock.filter((p) => p.stock > 0 && p.stock <= STOCK_MINIMO).length;
  const agotados = conStock.filter((p) => p.stock === 0).length;
  const valorInventario = conStock.reduce((a, p) => a + p.stock * Number(p.precio), 0);

  const visibles = productos.filter((p) => {
    if (filtro === "bajo") return p.activo && p.controla_stock && p.stock > 0 && p.stock <= STOCK_MINIMO;
    if (filtro === "agotado") return p.activo && p.controla_stock && p.stock === 0;
    if (filtro === "inactivo") return !p.activo;
    return true;
  });

  const ajusteNum = Math.trunc(Number(form.ajuste) || 0);
  const nuevoEsServicio = nuevo.tipo_item === "SERVICIO";
  const editaServicio = form.tipo === "SERVICIO";

  return (
    <>
      <NavBar titulo="Inventario" />
      <main className="pagina">
        <div className="encabezado-pagina">
          <div>
            <h1 className="titulo-pagina">Inventario</h1>
            <p className="subtitulo-pagina">
              {productos.filter((p) => p.activo).length} productos activos
              {bajos > 0 && <span className="font-medium text-amber-700"> · {bajos} con stock bajo</span>}
              {agotados > 0 && <span className="font-medium text-red-600"> · {agotados} agotados</span>}
              {esDirectivo() && <span className="text-slate-500"> · valor en existencia {quetzales(valorInventario)}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <div className="relative">
              <IconoBuscar className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nombre o código…"
                aria-label="Buscar producto"
                className="campo campo-con-icono w-56"
              />
            </div>
            {esAdmin && (
              <button onClick={() => setMostrarForm((v) => !v)} className="boton boton-primario" aria-expanded={mostrarForm}>
                <IconoMas className="size-4" />
                Nuevo producto
              </button>
            )}
          </div>
        </div>

        {mostrarForm && (
          <form onSubmit={crearProducto} className="tarjeta aparecer mb-5 p-5">
            <h2 className="mb-4 font-semibold text-slate-900">Nuevo producto</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label className="etiqueta" htmlFor="p-nombre">Nombre</label>
                <input id="p-nombre" required value={nuevo.nombre_producto} onChange={(e) => setNuevo({ ...nuevo, nombre_producto: e.target.value })} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="p-codigo">Código de barras</label>
                <input id="p-codigo" value={nuevo.codigo_barras} onChange={(e) => setNuevo({ ...nuevo, codigo_barras: e.target.value })} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="p-precio">Precio (Q)</label>
                <input id="p-precio" required type="number" step="0.01" min="0" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="p-tipo">Tipo</label>
                <select
                  id="p-tipo"
                  value={nuevo.tipo_item}
                  onChange={(e) => {
                    const servicio = e.target.value === "SERVICIO";
                    setNuevo({
                      ...nuevo,
                      tipo_item: e.target.value,
                      stock: servicio ? "" : nuevo.stock,
                      codigo_unidad: servicio ? "SRV" : nuevo.codigo_unidad === "SRV" ? "UNI" : nuevo.codigo_unidad,
                    });
                  }}
                  className="campo"
                >
                  <option value="BIEN">Producto</option>
                  <option value="SERVICIO">Servicio</option>
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="p-unidad">Unidad de medida</label>
                <select id="p-unidad" value={nuevo.codigo_unidad} onChange={(e) => setNuevo({ ...nuevo, codigo_unidad: e.target.value })} className="campo">
                  {unidades.length === 0 && <option value={nuevo.codigo_unidad}>{nuevo.codigo_unidad}</option>}
                  {unidades.map((u) => (
                    <option key={u.codigo} value={u.codigo}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="p-stock">Stock inicial</label>
                <input
                  id="p-stock"
                  type="number"
                  min="0"
                  value={nuevo.stock}
                  onChange={(e) => setNuevo({ ...nuevo, stock: e.target.value })}
                  className="campo"
                  disabled={nuevoEsServicio}
                  placeholder={nuevoEsServicio ? "No aplica" : ""}
                />
              </div>
              <div>
                <label className="etiqueta" htmlFor="p-iva">IVA</label>
                <select id="p-iva" value={nuevo.tipo_iva} onChange={(e) => setNuevo({ ...nuevo, tipo_iva: e.target.value })} className="campo">
                  <option value="GRAVADO">Gravado</option>
                  <option value="EXENTO">Exento</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button type="button" onClick={() => setMostrarForm(false)} className="boton boton-secundario">
                Cancelar
              </button>
              <button type="submit" className="boton boton-primario">
                Guardar producto
              </button>
            </div>
          </form>
        )}

        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar inventario">
          {FILTROS.filter((f) => esAdmin || f.valor !== "inactivo").map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setFiltro(f.valor)}
              aria-pressed={filtro === f.valor}
              className={`pildora ${filtro === f.valor ? "pildora-activa" : ""}`}
            >
              {f.texto}
            </button>
          ))}
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
                <th>Producto</th>
                <th>Código</th>
                <th>IVA</th>
                <th className="num">Precio</th>
                <th className="num">Existencia</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id_producto} className={p.activo ? undefined : "opacity-55"}>
                  <td className="font-semibold text-slate-900">
                    {p.nombre_producto}
                    {!p.activo && <span className="chip chip-neutro ml-2">Desactivado</span>}
                  </td>
                  <td className="font-mono text-xs text-slate-500">{p.sku ?? "—"}
                    {p.codigo_barras && <span className="block text-[11px] text-slate-400">{p.codigo_barras}</span>}
                  </td>
                  <td>
                    <span className={`chip ${p.tipo_iva === "EXENTO" ? "chip-info" : "chip-neutro"}`}>
                      {p.tipo_iva === "EXENTO" ? "Exento" : "Gravado"}
                    </span>
                  </td>
                  <td className="num">{quetzales(p.precio)}</td>
                  <td className="num">
                    {!p.controla_stock ? (
                      <span className="chip chip-info">Servicio</span>
                    ) : p.stock === 0 ? (
                      <span className="chip chip-error">Agotado</span>
                    ) : p.stock <= STOCK_MINIMO ? (
                      <span className="chip chip-aviso">
                        <IconoAlerta className="size-3.5" />
                        {p.stock} · bajo
                      </span>
                    ) : (
                      <span className="font-semibold text-slate-900">{p.stock}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {p.controla_stock && (
                      <button onClick={() => abrirKardex(p)} className="boton boton-texto boton-chico" title="Ver entradas y salidas">
                        Kardex
                      </button>
                    )}
                    {esAdmin && (
                      <button onClick={() => abrirEdicion(p)} className="boton boton-texto boton-chico">
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibles.length === 0 && (
            <div className="vacio">
              <IconoCaja className="size-10 text-slate-300" />
              <p className="font-medium text-slate-500">No hay productos</p>
              {(q || filtro !== "todos") && <p>Prueba con otra búsqueda o filtro.</p>}
            </div>
          )}
        </div>
      </main>

      {/* ---------- Kardex: historial de entradas y salidas ---------- */}
      {kardexDe && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setKardexDe(null)}
        >
          <div className="tarjeta aparecer w-full max-w-3xl p-6 shadow-2xl" role="dialog" aria-modal="true" aria-label="Kardex del producto">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold text-slate-900">Kardex · {kardexDe.nombre_producto}</h2>
                <p className="text-sm text-slate-500">
                  Existencia actual: <strong className="text-slate-900">{kardexDe.stock}</strong> · cada entrada y salida queda registrada
                </p>
              </div>
              <button onClick={() => setKardexDe(null)} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
                <IconoCerrar className="size-5" />
              </button>
            </div>

            {errorKardex && (
              <div className="alerta alerta-error mt-4" role="alert">
                <IconoAlerta className="mt-0.5 size-4 shrink-0" />
                <span>{errorKardex}</span>
              </div>
            )}
            {!kardex && !errorKardex && <p className="mt-6 text-center text-sm text-slate-500">Cargando…</p>}
            {kardex && kardex.length === 0 && (
              <p className="mt-5 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                Este producto todavía no tiene movimientos.
              </p>
            )}
            {kardex && kardex.length > 0 && (
              <div className="tabla-contenedor mt-4 max-h-96 overflow-y-auto !shadow-none">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Movimiento</th>
                      <th>Documento</th>
                      <th className="num">Cantidad</th>
                      <th className="num">Existencia</th>
                      <th>Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kardex.map((m) => (
                      <tr key={m.id_movimiento}>
                        <td className="whitespace-nowrap text-slate-500">{new Date(m.fecha).toLocaleString("es-GT")}</td>
                        <td>
                          <span className="font-medium text-slate-900">{TIPO_MOVIMIENTO[m.tipo] ?? m.tipo}</span>
                          {m.observacion && !m.documento && <span className="block text-xs text-slate-500">{m.observacion}</span>}
                        </td>
                        <td className="whitespace-nowrap">
                          {m.id_factura && m.documento ? (
                            <Link href={`/facturas/${m.id_factura}`} className="font-semibold text-marca-700 hover:underline">
                              {m.documento}
                            </Link>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className={`num font-semibold ${m.cantidad > 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {m.cantidad > 0 ? "+" : ""}
                          {m.cantidad}
                        </td>
                        <td className="num text-slate-900">{m.stock_resultante}</td>
                        <td className="text-slate-500">{m.usuario ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- Editar producto y ajustar existencia ---------- */}
      {editando && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setEditando(null)}
        >
          <form
            onSubmit={(e) => guardarEdicion(e)}
            className="tarjeta aparecer w-full max-w-lg p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-editar"
          >
            <h2 id="titulo-editar" className="text-lg font-bold text-slate-900">
              Editar producto
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="e-nombre">Nombre</label>
                <input id="e-nombre" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="e-codigo">Código de barras</label>
                <input id="e-codigo" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="e-precio">Precio (Q)</label>
                <input id="e-precio" required type="number" step="0.01" min="0" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="e-iva">IVA</label>
                <select id="e-iva" value={form.iva} onChange={(e) => setForm({ ...form, iva: e.target.value })} className="campo">
                  <option value="GRAVADO">Gravado</option>
                  <option value="EXENTO">Exento</option>
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="e-tipo">Tipo</label>
                <select id="e-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="campo">
                  <option value="BIEN">Producto</option>
                  <option value="SERVICIO">Servicio</option>
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="e-unidad">Unidad de medida</label>
                <select id="e-unidad" value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })} className="campo">
                  {unidades.length === 0 && <option value={form.unidad}>{form.unidad}</option>}
                  {unidades.map((u) => (
                    <option key={u.codigo} value={u.codigo}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {editaServicio ? (
              <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Un servicio no lleva existencia: no se agota ni tiene kardex.
                {editando.tipo_item === "BIEN" && editando.stock !== 0 && (
                  <span className="mt-1 block font-medium text-amber-700">
                    Para convertirlo en servicio, primero ajusta su existencia a 0 (hoy hay {editando.stock}).
                  </span>
                )}
              </p>
            ) : (
            <fieldset className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-700">Ajustar existencia</legend>
              <p className="text-sm text-slate-500">
                Ahora hay <strong className="text-slate-900">{editando.stock}</strong>. Escribe cuántas unidades entran (+) o salen (−).
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="etiqueta" htmlFor="e-ajuste">Cantidad (+/−)</label>
                  <input id="e-ajuste" type="number" step="1" value={form.ajuste} onChange={(e) => setForm({ ...form, ajuste: e.target.value })} className="campo" placeholder="Ej. 24 o -3" />
                </div>
                <div>
                  <label className="etiqueta" htmlFor="e-motivo">Motivo</label>
                  <input id="e-motivo" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} className="campo" maxLength={100} placeholder="Compra, merma, conteo…" />
                </div>
              </div>
              {ajusteNum !== 0 && (
                <p className={`mt-2 text-sm font-medium ${editando.stock + ajusteNum < 0 ? "text-red-600" : "text-marca-700"}`}>
                  Quedará en {editando.stock + ajusteNum} unidades
                  {editando.stock + ajusteNum < 0 && " — no puede ser negativo"}
                </p>
              )}
            </fieldset>
            )}

            {errorEdicion && (
              <div className="alerta alerta-error mt-4" role="alert">
                <IconoAlerta className="mt-0.5 size-4 shrink-0" />
                <span>{errorEdicion}</span>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={(e) => guardarEdicion(e, !editando.activo)}
                disabled={guardando}
                className={`boton boton-texto ${editando.activo ? "text-red-600 hover:!bg-red-50" : ""}`}
              >
                {editando.activo ? "Desactivar producto" : "Reactivar producto"}
              </button>
              <div className="flex gap-2.5">
                <button type="button" onClick={() => setEditando(null)} className="boton boton-secundario">
                  Cancelar
                </button>
                <button type="submit" disabled={guardando || editando.stock + ajusteNum < 0} className="boton boton-primario">
                  {guardando ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
