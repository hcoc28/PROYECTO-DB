"use client";

// ============================================================
// PÁGINA DEL PUNTO DE VENTA — ruta: /pos
// Pantalla de venta rápida: escanear productos, cobrar y
// generar la factura FEL. Es la pantalla que más se usa a diario.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, puedeOperar } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { quetzales } from "@/lib/client/formato";
import { STOCK_MINIMO } from "@/lib/client/constantes";
import NavBar from "../_components/NavBar";
import {
  IconoAlerta,
  IconoBasura,
  IconoBuscar,
  IconoFactura,
  IconoCarrito,
  IconoCheck,
  IconoDinero,
  IconoEdificio,
  IconoEscaner,
  IconoImpresora,
  IconoMas,
  IconoMenos,
  IconoQr,
  IconoReloj,
  IconoTarjeta,
  IconoTransferencia,
} from "../_components/iconos";

// ============================================================
// Pantalla POS (venta rápida)
// - El input de escáner mantiene el foco: los lectores de código
//   de barras emulan teclado y terminan con Enter.
// - Los precios ya incluyen IVA (práctica guatemalteca).
// - No hay control de caja por turno en este esquema (no existe
//   tabla sesion_caja en la base de datos real).
// ============================================================

interface LineaCarrito {
  id_producto: number;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  stock: number; // existencia al momento de agregarlo (tope de la cantidad)
}

interface ProductoApi {
  id_producto: number;
  nombre_producto: string;
  codigo_barras: string | null;
  precio: string;
  stock: number;
  controla_stock?: boolean; // false = servicio: no se agota
}

// Existencia utilizable en el POS: un servicio no tiene tope.
const disponibleDe = (p: ProductoApi): number => (p.controla_stock === false ? Number.POSITIVE_INFINITY : p.stock);

interface TicketFel {
  uuid: string | null;
  serie: string | null;
  numero: string | null;
  total: string;
  estadoFel: string;
  fecha?: string;
  idFactura?: number;
  credito?: boolean;
}

const METODOS = [
  { valor: "EFECTIVO", texto: "Efectivo", Icono: IconoDinero },
  { valor: "TARJETA", texto: "Tarjeta", Icono: IconoTarjeta },
  { valor: "TRANSFERENCIA", texto: "Transferencia", Icono: IconoTransferencia },
  { valor: "QR", texto: "Código QR", Icono: IconoQr },
  { valor: "DEPOSITO", texto: "Depósito", Icono: IconoEdificio },
  { valor: "CHEQUE", texto: "Cheque", Icono: IconoFactura },
] as const;

type Metodo = (typeof METODOS)[number]["valor"];

const COLA_OFFLINE = "pos_ventas_pendientes";

export default function PantallaPos() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [idSerieFact, setIdSerieFact] = useState<number | null>(null);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nit, setNit] = useState("CF");
  const [metodo, setMetodo] = useState<Metodo>("EFECTIVO");
  const [procesando, setProcesando] = useState(false);
  const [ticket, setTicket] = useState<TicketFel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendientesOffline, setPendientesOffline] = useState(0);
  // Cliente: se busca por NIT para mostrar su nombre o pedirlo si es nuevo
  const [clienteNit, setClienteNit] = useState<{ estado: "buscando" | "existe" | "nuevo"; nombre?: string } | null>(null);
  const [nombreReceptor, setNombreReceptor] = useState("");
  const [modoPago, setModoPago] = useState<"ahora" | "credito">("ahora");
  const [recibido, setRecibido] = useState("");
  const [referencia, setReferencia] = useState(""); // autorización/boleta del banco: opcional
  const inputRef = useRef<HTMLInputElement>(null);
  const [sugerencias, setSugerencias] = useState<ProductoApi[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [resaltado, setResaltado] = useState(-1);
  const [abierto, setAbierto] = useState(false);
  const busquedaActual = useRef(0);

  const total = carrito.reduce((a, l) => a + l.cantidad * l.precioUnitario, 0);
  const unidades = carrito.reduce((a, l) => a + l.cantidad, 0);
  const nitLimpio = nit.trim().toUpperCase();
  const esCf = nitLimpio === "CF" || nitLimpio === "";
  const cambio = metodo === "EFECTIVO" && modoPago === "ahora" && Number(recibido) > total ? Number(recibido) - total : 0;

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    if (!puedeOperar()) {
      router.replace("/"); // el gerente consulta, no vende
      return;
    }
    setListo(true);
    apiFetch<{ series: { id_serie: number; tipo_documento: string; serie: string }[] }>("/api/v1/series").then(
      (r) => {
        const fact = r.datos?.series.find((s) => s.tipo_documento === "FACT");
        if (fact) setIdSerieFact(fact.id_serie);
        else setError("No hay una serie FACT activa configurada");
      }
    );
  }, [router]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [carrito, ticket, listo]);

  // Al llegar desde Clientes → "Vender", el NIT ya viene lleno
  useEffect(() => {
    const nitUrl = new URLSearchParams(window.location.search).get("nit");
    if (nitUrl) setNit(nitUrl.toUpperCase());
  }, []);

  // Busca el NIT escrito (con pausa) para mostrar el nombre del cliente
  useEffect(() => {
    if (esCf) {
      setClienteNit(null);
      setModoPago("ahora");
      return;
    }
    setClienteNit({ estado: "buscando" });
    const t = setTimeout(async () => {
      const r = await apiFetch<{ clientes: { nombre_cliente: string }[] }>(
        `/api/v1/clientes?nit=${encodeURIComponent(nitLimpio.replace(/-/g, ""))}`
      );
      const c = r.datos?.clientes?.[0];
      setClienteNit(c ? { estado: "existe", nombre: c.nombre_cliente } : { estado: "nuevo" });
    }, 350);
    return () => clearTimeout(t);
  }, [nitLimpio, esCf]);

  useEffect(() => {
    try {
      const cola = JSON.parse(localStorage.getItem(COLA_OFFLINE) ?? "[]");
      setPendientesOffline(cola.length);
    } catch {
      /* almacenamiento no disponible */
    }
  }, []);

  // Agrega un producto al carrito (o suma una unidad si ya estaba),
  // sin pasar de la existencia disponible.
  const agregarProducto = useCallback((p: ProductoApi) => {
    setError(null);
    const disponible = disponibleDe(p);
    if (disponible <= 0) {
      setError(`"${p.nombre_producto}" está agotado`);
      return;
    }
    setCarrito((prev) => {
      const idx = prev.findIndex((l) => l.id_producto === p.id_producto);
      if (idx >= 0) {
        if (prev[idx].cantidad >= disponible) {
          setError(`Solo hay ${p.stock} de "${p.nombre_producto}" en existencia`);
          return prev;
        }
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1, stock: disponible };
        return copia;
      }
      return [
        ...prev,
        {
          id_producto: p.id_producto,
          descripcion: p.nombre_producto,
          cantidad: 1,
          precioUnitario: Number(p.precio),
          stock: disponible,
        },
      ];
    });
  }, []);

  // Enter / escáner: primero código de barras exacto; si no coincide,
  // se usa la sugerencia resaltada o la única coincidencia por nombre.
  const agregarPorCodigo = useCallback(
    async (texto: string, elegido?: ProductoApi) => {
      if (elegido) {
        agregarProducto(elegido);
        return;
      }
      const valor = texto.trim();
      if (!valor) return;
      setError(null);
      const exacto = await apiFetch<{ productos: ProductoApi[] }>(
        `/api/v1/productos?codigoBarras=${encodeURIComponent(valor)}`
      );
      if (exacto.datos?.productos?.[0]) {
        agregarProducto(exacto.datos.productos[0]);
        return;
      }
      const porNombre = await apiFetch<{ productos: ProductoApi[] }>(
        `/api/v1/productos?q=${encodeURIComponent(valor)}&porPagina=2`
      );
      const lista = porNombre.datos?.productos ?? [];
      if (lista.length === 1) agregarProducto(lista[0]);
      else if (lista.length > 1) setError("Hay varias coincidencias: elige una de la lista");
      else setError(`No hay productos que coincidan con "${valor}"`);
    },
    [agregarProducto]
  );

  // Sugerencias mientras se escribe (con una pequeña pausa para no
  // consultar en cada tecla).
  useEffect(() => {
    const texto = codigo.trim();
    if (texto.length < 2) {
      setSugerencias([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const numero = ++busquedaActual.current;
    const temporizador = setTimeout(async () => {
      const r = await apiFetch<{ productos: ProductoApi[] }>(
        `/api/v1/productos?q=${encodeURIComponent(texto)}&porPagina=8`
      );
      if (numero !== busquedaActual.current) return; // llegó tarde: ya hay otra búsqueda
      setSugerencias(r.datos?.productos ?? []);
      setResaltado(-1);
      setBuscando(false);
    }, 220);
    return () => clearTimeout(temporizador);
  }, [codigo]);

  function elegirSugerencia(p: ProductoApi) {
    agregarProducto(p);
    setCodigo("");
    setSugerencias([]);
    setAbierto(false);
    inputRef.current?.focus();
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && sugerencias.length) {
      e.preventDefault();
      setAbierto(true);
      setResaltado((i) => (i + 1) % sugerencias.length);
    } else if (e.key === "ArrowUp" && sugerencias.length) {
      e.preventDefault();
      setResaltado((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setAbierto(false);
      setResaltado(-1);
    }
  }

  function cambiarCantidad(indice: number, valor: number) {
    const linea = carrito[indice];
    if (!linea) return;
    let cantidad = Math.max(1, Math.trunc(valor) || 1);
    if (cantidad > linea.stock) {
      cantidad = linea.stock;
      setError(`Solo hay ${linea.stock} de "${linea.descripcion}" en existencia`);
    } else {
      setError(null);
    }
    setCarrito((prev) => prev.map((x, j) => (j === indice ? { ...x, cantidad } : x)));
  }

  // Atajo F12 = Cobrar (el botón lo anuncia). Se guarda la versión más
  // reciente de cobrar() en una referencia para que el listener, que se
  // registra una sola vez, nunca use un carrito viejo.
  const cobrarRef = useRef<() => void>(() => {});
  useEffect(() => {
    cobrarRef.current = cobrar;
  });
  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      if (e.key === "F12") {
        e.preventDefault();
        cobrarRef.current();
      }
    }
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, []);

  async function cobrar() {
    if (carrito.length === 0 || procesando || !idSerieFact) return;
    setProcesando(true);
    setError(null);

    const venta = {
      id_serie: idSerieFact,
      nitReceptor: nit || "CF",
      ...(clienteNit?.estado === "nuevo" && nombreReceptor.trim() && { nombreReceptor: nombreReceptor.trim() }),
      items: carrito.map((l) => ({
        id_producto: l.id_producto,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
      })),
      // Sin pagos = venta a crédito: queda como saldo por cobrar
      pagos:
        modoPago === "credito"
          ? []
          : [{ metodo, monto: Number(total.toFixed(2)), ...(metodo !== "EFECTIVO" && { referencia: referencia.trim() }) }],
    };

    const r = await apiFetch<{ ticket: TicketFel; factura: { id_factura: number } }>("/api/v1/pos/ventas", {
      method: "POST",
      body: JSON.stringify(venta),
    });

    if (r.ok && r.datos) {
      setTicket({
        ...r.datos.ticket,
        fecha: new Date().toLocaleString("es-GT"),
        idFactura: r.datos.factura?.id_factura,
        credito: modoPago === "credito",
      });
      setCarrito([]);
      setNit("CF");
      setNombreReceptor("");
      setRecibido("");
      setReferencia("");
      setModoPago("ahora");
      if (modoPago === "credito") notificar.ok("Quedó como saldo por cobrar.", { titulo: "Venta a crédito registrada" });
      else notificar.ok(`Total ${quetzales(total)}`, { titulo: "Venta registrada" });
      if (r.datos.ticket.estadoFel !== "CERTIFICADA") {
        notificar.aviso("Se reenviará sola a SAT cuando el certificador responda.", { titulo: "Factura pendiente de certificar" });
      }
    } else if (r.status === 0 || r.status >= 500) {
      // Sin conexión: encolar y sincronizar después
      try {
        const cola = JSON.parse(localStorage.getItem(COLA_OFFLINE) ?? "[]");
        cola.push(venta);
        localStorage.setItem(COLA_OFFLINE, JSON.stringify(cola));
        setPendientesOffline(cola.length);
        setCarrito([]);
        setError("Sin conexión: venta guardada, reenvíela al reconectar");
        notificar.aviso(`Hay ${cola.length} venta(s) esperando para reenviarse.`, { titulo: "Sin conexión" });
      } catch {
        setError("Sin conexión y sin almacenamiento local disponible");
      }
    } else {
      setError(r.error?.mensaje ?? "Error al procesar la venta");
    }
    setProcesando(false);
  }

  if (!listo) return null;

  const certificada = ticket?.estadoFel === "CERTIFICADA";

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <NavBar titulo="Punto de venta" />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <h1 className="sr-only">Punto de venta</h1>
        {/* ---------- Izquierda: escáner y carrito ---------- */}
        <section className="flex min-h-[26rem] min-w-0 flex-1 flex-col">
          <div className="border-b border-slate-200/80 bg-white p-4 sm:p-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const elegido = resaltado >= 0 ? sugerencias[resaltado] : undefined;
                agregarPorCodigo(codigo, elegido);
                setCodigo("");
                setSugerencias([]);
                setAbierto(false);
              }}
            >
              <label htmlFor="codigo" className="sr-only">
                Buscar producto por nombre o código de barras
              </label>
              <div className="relative">
                <IconoEscaner className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-marca-600" />
                <input
                  id="codigo"
                  ref={inputRef}
                  value={codigo}
                  onChange={(e) => {
                    setCodigo(e.target.value);
                    setAbierto(true);
                  }}
                  onFocus={() => setAbierto(true)}
                  onBlur={() => setTimeout(() => setAbierto(false), 150)}
                  onKeyDown={alTeclear}
                  placeholder="Busca por nombre o escanea el código de barras…"
                  className="campo !rounded-2xl !py-4 !pl-14 !text-base"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={abierto && codigo.trim().length >= 2}
                  aria-controls="lista-sugerencias"
                  aria-autocomplete="list"
                />

                {abierto && codigo.trim().length >= 2 && (
                  <ul
                    id="lista-sugerencias"
                    role="listbox"
                    className="aparecer absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"
                  >
                    {buscando && sugerencias.length === 0 && (
                      <li className="px-3.5 py-3 text-sm text-slate-500">Buscando…</li>
                    )}
                    {!buscando && sugerencias.length === 0 && (
                      <li className="flex items-center gap-2 px-3.5 py-3 text-sm text-slate-500">
                        <IconoBuscar className="size-4" />
                        No hay productos que coincidan con “{codigo.trim()}”
                      </li>
                    )}
                    {sugerencias.map((p, i) => {
                      const agotado = disponibleDe(p) <= 0;
                      const esServicio = p.controla_stock === false;
                      return (
                        <li key={p.id_producto} role="option" aria-selected={i === resaltado} aria-disabled={agotado}>
                          <button
                            type="button"
                            // onMouseDown evita que el input pierda el foco antes del clic
                            onMouseDown={(e) => {
                              e.preventDefault();
                              if (!agotado) elegirSugerencia(p);
                            }}
                            onMouseEnter={() => setResaltado(i)}
                            className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition ${
                              i === resaltado ? "bg-marca-50" : "hover:bg-slate-50"
                            } ${agotado ? "cursor-not-allowed opacity-50" : ""}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-semibold text-slate-900">{p.nombre_producto}</p>
                              <p className="truncate font-mono text-xs text-slate-500">{p.codigo_barras ?? "sin código"}</p>
                            </div>
                            <span
                              className={`chip ${agotado ? "chip-error" : esServicio ? "chip-info" : p.stock <= STOCK_MINIMO ? "chip-aviso" : "chip-neutro"}`}
                            >
                              {agotado ? "Agotado" : esServicio ? "Servicio" : `${p.stock} disp.`}
                            </span>
                            <span className="w-20 text-right font-bold tabular-nums text-slate-900">{quetzales(p.precio)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </form>
            <p className="ayuda">Escribe al menos 2 letras para ver sugerencias, o escanea el código y presiona Enter.</p>
            {pendientesOffline > 0 && (
              <div className="alerta alerta-aviso mt-3">
                <IconoAlerta className="mt-0.5 size-4 shrink-0" />
                <span>{pendientesOffline} venta(s) sin conexión pendientes de sincronizar</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {carrito.length === 0 ? (
              <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 text-center">
                <span className="grid size-20 place-items-center rounded-full bg-marca-50 text-marca-600">
                  <IconoCarrito className="size-9" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-slate-800">El carrito está vacío</p>
                  <p className="mt-1 text-sm text-slate-500">Busca un producto por nombre o escanéalo para comenzar</p>
                </div>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {carrito.map((l, i) => (
                  <li
                    key={l.id_producto}
                    className="tarjeta aparecer flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3.5 sm:flex-nowrap sm:gap-4"
                  >
                    <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                      <p className="truncate font-semibold text-slate-900">{l.descripcion}</p>
                      <p className="text-sm tabular-nums text-slate-500">{quetzales(l.precioUnitario)} c/u</p>
                    </div>

                    <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => cambiarCantidad(i, l.cantidad - 1)}
                        className="grid size-9 place-items-center rounded-l-xl text-slate-600 transition hover:bg-slate-200/70"
                        aria-label={`Quitar una unidad de ${l.descripcion}`}
                      >
                        <IconoMenos className="size-4" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={l.cantidad}
                        onChange={(e) => cambiarCantidad(i, Number(e.target.value))}
                        className="w-12 bg-transparent text-center text-sm font-bold tabular-nums text-slate-900 [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        aria-label={`Cantidad de ${l.descripcion}`}
                      />
                      <button
                        type="button"
                        onClick={() => cambiarCantidad(i, l.cantidad + 1)}
                        className="grid size-9 place-items-center rounded-r-xl text-slate-600 transition hover:bg-slate-200/70"
                        aria-label={`Agregar una unidad de ${l.descripcion}`}
                      >
                        <IconoMas className="size-4" />
                      </button>
                    </div>

                    <p className="ml-auto w-24 text-right text-base font-bold tabular-nums text-slate-900 sm:ml-0 sm:w-28">
                      {quetzales(l.cantidad * l.precioUnitario)}
                    </p>

                    <button
                      type="button"
                      onClick={() => setCarrito((prev) => prev.filter((_, j) => j !== i))}
                      className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                      aria-label={`Quitar ${l.descripcion} del carrito`}
                    >
                      <IconoBasura className="size-[18px]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ---------- Derecha: cobro ---------- */}
        <aside aria-label="Resumen de la venta" className="flex w-full shrink-0 flex-col gap-5 border-t border-slate-200 bg-white p-5 lg:w-[26rem] lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Resumen de venta</h2>
            <div className="flex items-center gap-2">
              <span className="chip chip-neutro">
                {unidades} {unidades === 1 ? "artículo" : "artículos"}
              </span>
              {carrito.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("¿Vaciar el carrito?")) {
                      setCarrito([]);
                      setError(null);
                    }
                  }}
                  className="boton boton-texto boton-chico text-red-600 hover:!bg-red-50"
                  title="Quitar todos los productos"
                >
                  <IconoBasura className="size-4" />
                  Vaciar
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="nit" className="etiqueta">
              NIT del cliente
            </label>
            <input
              id="nit"
              value={nit}
              onChange={(e) => setNit(e.target.value.toUpperCase())}
              className="campo uppercase"
              autoComplete="off"
            />
            {clienteNit?.estado === "existe" && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <IconoCheck className="size-4" />
                {clienteNit.nombre}
              </p>
            )}
            {clienteNit?.estado === "nuevo" && (
              <div className="mt-2">
                <p className="text-xs font-medium text-amber-700">NIT nuevo: se registrará como cliente.</p>
                <input
                  value={nombreReceptor}
                  onChange={(e) => setNombreReceptor(e.target.value)}
                  placeholder="Nombre del cliente"
                  aria-label="Nombre del cliente nuevo"
                  maxLength={100}
                  className="campo mt-1.5"
                />
              </div>
            )}
            {!clienteNit && <p className="ayuda">Escribe CF para consumidor final.</p>}
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Forma de pago">
            <button
              type="button"
              onClick={() => setModoPago("ahora")}
              aria-pressed={modoPago === "ahora"}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${modoPago === "ahora" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Pagar ahora
            </button>
            <button
              type="button"
              onClick={() => setModoPago("credito")}
              disabled={esCf}
              aria-pressed={modoPago === "credito"}
              title={esCf ? "Para vender a crédito necesitas el NIT del cliente" : "Dejar el saldo por cobrar"}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${modoPago === "credito" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              A crédito
            </button>
          </div>

          {modoPago === "credito" ? (
            <div className="alerta alerta-aviso">
              <IconoReloj className="mt-0.5 size-4 shrink-0" />
              <span>La venta quedará como saldo por cobrar. Podrás cobrarla después en Pagos → Por cobrar.</span>
            </div>
          ) : (
          <div>
            <p className="etiqueta">Método de pago</p>
            <div className="grid grid-cols-2 gap-2.5">
              {METODOS.map(({ valor, texto, Icono }) => {
                const activo = metodo === valor;
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setMetodo(valor)}
                    aria-pressed={activo}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-sm font-semibold transition ${
                      activo
                        ? "border-marca-600 bg-marca-50 text-marca-800 ring-2 ring-marca-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <Icono className={`size-5 ${activo ? "text-marca-600" : "text-slate-500"}`} />
                    {texto}
                  </button>
                );
              })}
            </div>

            {metodo !== "EFECTIVO" && (
              <div className="mt-3">
                <label htmlFor="referencia" className="etiqueta">
                  Número de referencia / autorización
                </label>
                <input
                  id="referencia"
                  type="text"
                  maxLength={100}
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Opcional — boleta, voucher o autorización"
                  className="campo"
                />
              </div>
            )}

            {metodo === "EFECTIVO" && (
              <div className="mt-3">
                <label htmlFor="recibido" className="etiqueta">
                  Efectivo recibido
                </label>
                <input
                  id="recibido"
                  type="number"
                  min="0"
                  step="0.01"
                  value={recibido}
                  onChange={(e) => setRecibido(e.target.value)}
                  placeholder="Opcional — para calcular el cambio"
                  className="campo tabular-nums"
                />
                {recibido !== "" && Number(recibido) < total && total > 0 && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">Falta {quetzales(total - Number(recibido))}</p>
                )}
                {cambio > 0 && (
                  <div className="alerta alerta-ok mt-2">
                    <span>
                      Cambio a entregar: <strong className="text-lg">{quetzales(cambio)}</strong>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          <div className="mt-auto space-y-4 pt-2">
            <div className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
              <p className="text-sm text-slate-300">Total a pagar</p>
              <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">{quetzales(total)}</p>
              <p className="mt-1 text-xs text-slate-400">IVA incluido</p>
            </div>

            {error && (
              <div className="alerta alerta-error" role="alert">
                <IconoAlerta className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={cobrar}
              disabled={carrito.length === 0 || procesando || !idSerieFact}
              className="boton boton-primario boton-grande w-full text-lg"
            >
              {procesando ? (
                <>
                  <span className="girar size-5 rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                  Procesando…
                </>
              ) : (
                <>
                  {modoPago === "credito" ? "Registrar a crédito" : "Cobrar"}
                  <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-sans text-xs font-semibold">F12</kbd>
                </>
              )}
            </button>
          </div>
        </aside>
      </main>

      {/* ---------- Ticket de la venta ---------- */}
      {ticket && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="ticket-imprimible tarjeta aparecer w-full max-w-sm p-6 text-center shadow-2xl">
            <span
              className={`mx-auto grid size-16 place-items-center rounded-full ${
                certificada ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
              }`}
            >
              {certificada ? <IconoCheck className="size-8" /> : <IconoReloj className="size-8" />}
            </span>
            <h3 className="mt-4 text-xl font-bold text-slate-900">
              {ticket.credito ? "Venta a crédito registrada" : certificada ? "Factura certificada" : "Venta registrada"}
            </h3>
            {ticket.fecha && <p className="mt-0.5 text-sm text-slate-500">{ticket.fecha}</p>}

            <p className="mt-5 text-4xl font-bold tabular-nums tracking-tight text-slate-900">{quetzales(ticket.total)}</p>
            <p className="text-xs text-slate-500">IVA incluido</p>

            <dl className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4 text-left text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Serie y número</dt>
                <dd className="font-semibold tabular-nums text-slate-800">
                  {ticket.serie ?? "—"} · {ticket.numero ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Estado</dt>
                <dd>
                  <span className={`chip ${certificada ? "chip-ok" : "chip-aviso"}`}>
                    {certificada ? "Certificada" : "Pendiente"}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">UUID</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-slate-700">{ticket.uuid ?? "pendiente"}</dd>
              </div>
            </dl>

            <div className="no-imprimir mt-6 grid grid-cols-2 gap-3">
              {ticket.idFactura && (
                <Link href={`/facturas/${ticket.idFactura}`} className="boton boton-secundario col-span-2">
                  <IconoFactura className="size-4" />
                  Ver factura completa
                </Link>
              )}
              <button onClick={() => window.print()} className="boton boton-secundario">
                <IconoImpresora className="size-4" />
                Imprimir
              </button>
              <button onClick={() => setTicket(null)} className="boton boton-primario">
                Nueva venta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
