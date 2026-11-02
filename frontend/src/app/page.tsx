"use client";

// ============================================================
// PÁGINA PRINCIPAL — ruta: /
// Tablero de inicio. Saluda al usuario y ofrece accesos rápidos
// a lo que más se hace (vender, cobrar, registrar un cliente o un
// producto). El ADMIN además ve el resumen del negocio: ventas y
// cobros de hoy, lo que falta por cobrar, alertas de inventario,
// ventas de los últimos 7 días, productos más vendidos y las
// facturas más recientes.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario } from "@/lib/client/apiCliente";
import { quetzales } from "@/lib/client/formato";
import { notificar } from "@/lib/client/avisos";
import { saludoDelDia } from "@/lib/client/bienvenida";
import NavBar from "./_components/NavBar";
import {
  IconoActualizar,
  IconoAlerta,
  IconoCaja,
  IconoCarrito,
  IconoCheck,
  IconoClientes,
  IconoDinero,
  IconoFactura,
  IconoFlecha,
  IconoReloj,
  IconoTarjeta,
  IconoTendencia,
} from "./_components/iconos";

interface Resumen {
  hoy: { total: string; cantidad: number; cobrado: string };
  semana: { fecha: string; total: string; cantidad: number }[];
  totalSemana: string;
  porCobrar: string;
  inventario: { bajos: number; agotados: number; stockMinimo: number };
  topProductos: { id_producto: number; nombre: string; unidades: number; total: string }[];
  recientes: {
    id_factura: number;
    numero: string;
    fecha_factura: string;
    total: string;
    estado: string;
    cliente: { nombre_cliente: string };
    serie: { tipo_documento: string; serie: string };
  }[];
}

type IconoTipo = ComponentType<SVGProps<SVGSVGElement>>;

const accesos: { href: string; texto: string; desc: string; Icono: IconoTipo; color: string }[] = [
  { href: "/pos", texto: "Nueva venta", desc: "Abrir el punto de venta", Icono: IconoCarrito, color: "bg-marca-50 text-marca-700" },
  { href: "/pagos", texto: "Cobrar pendientes", desc: "Facturas con saldo", Icono: IconoTarjeta, color: "bg-violet-50 text-violet-700" },
  { href: "/clientes", texto: "Clientes", desc: "Directorio y compras", Icono: IconoClientes, color: "bg-sky-50 text-sky-700" },
  { href: "/inventario", texto: "Inventario", desc: "Productos y existencias", Icono: IconoCaja, color: "bg-amber-50 text-amber-700" },
];

const CHIP: Record<string, string> = {
  BORRADOR: "chip-neutro",
  PENDIENTE_CERTIFICACION: "chip-aviso",
  CERTIFICADA: "chip-ok",
  PENDIENTE: "chip-aviso",
  RECHAZADA: "chip-error",
  ANULADA: "chip-neutro",
};

/** Al entrar (una vez por sesión) avisa de lo que necesita atención: existencias y saldos por cobrar. */
function avisarPendientes(r: Resumen) {
  try {
    if (sessionStorage.getItem("avisosInicio")) return;
    sessionStorage.setItem("avisosInicio", "1");
  } catch {
    return;
  }
  const { agotados, bajos } = r.inventario;
  if (agotados > 0) notificar.aviso(`${agotados} producto(s) agotado(s). Conviene reponerlos.`, { titulo: "Inventario" });
  if (bajos > 0) notificar.aviso(`${bajos} producto(s) con pocas existencias.`, { titulo: "Inventario" });
  if (Number(r.porCobrar) > 0) notificar.aviso(`Hay ${quetzales(r.porCobrar)} por cobrar en facturas con saldo.`, { titulo: "Cobros pendientes" });
}

export default function Inicio() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<{ nombreUsuario: string; rol: string } | null>(null);
  const [listo, setListo] = useState(false);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    setUsuario(obtenerUsuario());
    setListo(true);
  }, [router]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await apiFetch<Resumen>("/api/v1/reportes/resumen");
    if (r.ok && r.datos) {
      setResumen(r.datos);
      avisarPendientes(r.datos);
    }
    setCargando(false);
  }, []);

  // El resumen solo existe para ADMIN y GERENTE (maneja cifras de todo el negocio).
  useEffect(() => {
    if (listo && (usuario?.rol === "ADMIN" || usuario?.rol === "GERENTE")) cargar();
  }, [listo, usuario, cargar]);

  if (!listo) return null;

  const fechaTexto = new Date().toLocaleDateString("es-GT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fechaHoy = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);
  const esAdmin = usuario?.rol === "ADMIN" || usuario?.rol === "GERENTE"; // ve el resumen del negocio
  const maxDia = Math.max(1, ...(resumen?.semana.map((d) => Math.max(0, Number(d.total))) ?? [1]));
  const alertas = (resumen?.inventario.bajos ?? 0) + (resumen?.inventario.agotados ?? 0);

  return (
    <>
      <NavBar titulo="Inicio" />
      <main className="pagina">
        {/* ---------- Bienvenida ---------- */}
        <section className="aparecer relative overflow-hidden rounded-3xl bg-gradient-to-br from-marca-700 via-marca-600 to-teal-500 p-6 text-white shadow-lg sm:p-8">
          <div className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-24 right-32 size-56 rounded-full bg-teal-300/20 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-sm font-medium text-marca-100">{fechaHoy}</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                {saludoDelDia()}, {usuario?.nombreUsuario}
              </h1>
              <p className="mt-2 max-w-xl text-marca-50/90">
                {esAdmin ? "Así va tu negocio hoy." : "Listo para atender. ¿Qué quieres hacer?"}
              </p>
            </div>
            <Link href="/pos" className="boton boton-grande bg-white text-marca-800 shadow-md hover:bg-marca-50">
              <IconoCarrito className="size-5" />
              Iniciar una venta
              <IconoFlecha className="size-5" />
            </Link>
          </div>
        </section>

        {/* ---------- Indicadores (solo ADMIN) ---------- */}
        {esAdmin && (
          <section className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumen del día">
            <Link href="/reportes" className="tarjeta-enlace aparecer p-5">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-slate-500">Ventas de hoy</p>
                <span className="icono-caja bg-marca-50 text-marca-700">
                  <IconoTendencia className="size-5" />
                </span>
              </div>
              <p className="indicador-valor">{resumen ? quetzales(resumen.hoy.total) : "—"}</p>
              <p className="mt-1 text-xs text-slate-500">{resumen ? `${resumen.hoy.cantidad} documento(s)` : "Cargando…"}</p>
            </Link>

            <Link href="/pagos" className="tarjeta-enlace aparecer p-5">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-slate-500">Cobrado hoy</p>
                <span className="icono-caja bg-emerald-50 text-emerald-700">
                  <IconoDinero className="size-5" />
                </span>
              </div>
              <p className="indicador-valor">{resumen ? quetzales(resumen.hoy.cobrado) : "—"}</p>
              <p className="mt-1 text-xs text-slate-500">Ver corte de caja</p>
            </Link>

            <Link
              href="/pagos"
              className={`tarjeta-enlace aparecer p-5 ${Number(resumen?.porCobrar) > 0 ? "!border-amber-300 !bg-amber-50/60" : ""}`}
            >
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-slate-500">Por cobrar</p>
                <span className="icono-caja bg-amber-100 text-amber-700">
                  <IconoReloj className="size-5" />
                </span>
              </div>
              <p className="indicador-valor">{resumen ? quetzales(resumen.porCobrar) : "—"}</p>
              <p className="mt-1 text-xs text-slate-500">Saldo de facturas</p>
            </Link>

            <Link href="/inventario" className={`tarjeta-enlace aparecer p-5 ${alertas > 0 ? "!border-red-200 !bg-red-50/50" : ""}`}>
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-slate-500">Alertas de inventario</p>
                <span className={`icono-caja ${alertas > 0 ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                  {alertas > 0 ? <IconoAlerta className="size-5" /> : <IconoCheck className="size-5" />}
                </span>
              </div>
              <p className="indicador-valor">{resumen ? alertas : "—"}</p>
              <p className="mt-1 text-xs text-slate-500">
                {!resumen
                  ? "Cargando…"
                  : alertas === 0
                    ? "Todo en orden"
                    : `${resumen.inventario.agotados} agotado(s) · ${resumen.inventario.bajos} con poco`}
              </p>
            </Link>
          </section>
        )}

        {/* ---------- Accesos rápidos ---------- */}
        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Accesos rápidos</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {accesos.map(({ href, texto, desc, Icono, color }) => (
            <Link key={href} href={href} className="tarjeta-enlace group aparecer flex items-center gap-4 p-4">
              <span className={`icono-caja size-12 ${color}`}>
                <Icono className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{texto}</span>
                <span className="mt-0.5 block text-sm text-slate-500">{desc}</span>
              </span>
              <IconoFlecha className="size-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-marca-600" />
            </Link>
          ))}
        </div>

        {/* ---------- Gráfica y productos (solo ADMIN) ---------- */}
        {esAdmin && resumen && (
          <>
            <div className="mt-8 grid gap-4 lg:grid-cols-5">
              <section className="tarjeta aparecer p-5 lg:col-span-3" aria-label="Ventas de los últimos 7 días">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">Ventas de los últimos 7 días</h2>
                    <p className="text-sm text-slate-500">
                      Total <strong className="text-slate-900">{quetzales(resumen.totalSemana)}</strong>
                    </p>
                  </div>
                  <button onClick={cargar} disabled={cargando} className="boton boton-texto boton-chico" title="Actualizar cifras">
                    <IconoActualizar className={`size-4 ${cargando ? "girar" : ""}`} />
                    Actualizar
                  </button>
                </div>
                <div className="mt-5 flex h-48 items-end gap-2 sm:gap-3">
                  {resumen.semana.map((d, i) => {
                    const valor = Math.max(0, Number(d.total));
                    const alto = valor === 0 ? 2 : Math.max(6, (valor / maxDia) * 100);
                    const esHoy = i === resumen.semana.length - 1;
                    const dia = new Date(`${d.fecha}T12:00:00`).toLocaleDateString("es-GT", { weekday: "short" });
                    return (
                      <div key={d.fecha} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                        <span className="text-[11px] font-semibold tabular-nums text-slate-500 opacity-0 transition group-hover:opacity-100">
                          {quetzales(d.total)}
                        </span>
                        <div
                          className={`w-full rounded-t-lg transition ${esHoy ? "bg-marca-600" : "bg-marca-200 group-hover:bg-marca-400"}`}
                          style={{ height: `${alto}%` }}
                          title={`${d.fecha}: ${quetzales(d.total)} · ${d.cantidad} documento(s)`}
                        />
                        <span className={`text-xs capitalize ${esHoy ? "font-bold text-marca-700" : "text-slate-500"}`}>{dia.replace(".", "")}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="tarjeta aparecer p-5 lg:col-span-2" aria-label="Productos más vendidos del mes">
                <h2 className="font-semibold text-slate-900">Más vendidos del mes</h2>
                <p className="text-sm text-slate-500">Por unidades</p>
                {resumen.topProductos.length === 0 ? (
                  <p className="mt-6 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
                    Aún no hay ventas este mes.
                  </p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {resumen.topProductos.map((p, i) => {
                      const max = resumen.topProductos[0].unidades || 1;
                      return (
                        <li key={p.id_producto}>
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="truncate font-medium text-slate-800">
                              <span className="mr-2 text-slate-500">{i + 1}.</span>
                              {p.nombre}
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums text-slate-900">{p.unidades} u.</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-marca-500" style={{ width: `${(p.unidades / max) * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </div>

            <section className="tarjeta aparecer mt-4 overflow-hidden" aria-label="Facturas recientes">
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <h2 className="font-semibold text-slate-900">Facturas recientes</h2>
                <Link href="/facturas" className="boton boton-texto boton-chico">
                  Ver todas
                  <IconoFlecha className="size-4" />
                </Link>
              </div>
              {resumen.recientes.length === 0 ? (
                <div className="vacio border-t border-slate-100">
                  <IconoFactura className="size-10 text-slate-300" />
                  <p>Aún no se ha emitido ninguna factura.</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {resumen.recientes.map((f) => (
                    <li key={f.id_factura}>
                      <Link href={`/facturas/${f.id_factura}`} className="flex items-center gap-4 px-5 py-3 transition hover:bg-slate-50">
                        <span className="icono-caja bg-sky-50 text-sky-700">
                          <IconoFactura className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-900">
                            {f.serie.tipo_documento}-{f.serie.serie} #{f.numero} · {f.cliente.nombre_cliente}
                          </span>
                          <span className="block text-xs text-slate-500">{new Date(f.fecha_factura).toLocaleString("es-GT")}</span>
                        </span>
                        <span className={`chip ${CHIP[f.estado] ?? "chip-neutro"} hidden sm:inline-flex`}>{f.estado}</span>
                        <span className="w-24 text-right font-bold tabular-nums text-slate-900">{quetzales(f.total)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
