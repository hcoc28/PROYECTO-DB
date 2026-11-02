"use client";

// ============================================================
// COMPONENTE — ventana para emitir una nota de crédito (solo ADMIN)
// Corrige una factura certificada: se eligen las cantidades que se
// devuelven (o se descuentan) de cada línea y el motivo. La nota usa
// el precio de la factura original; la mercadería vuelve al inventario
// y el total baja lo que el cliente debe. La base de datos impide que
// las notas, juntas, superen el total de la factura.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { quetzales } from "@/lib/client/formato";
import { IconoAlerta } from "./iconos";

export interface LineaParaNota {
  id_producto: number;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  descuento: number; // descuento de toda la línea
}

interface Serie {
  id_serie: number;
  tipo_documento: string;
  serie: string;
}

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function ModalNotaCredito({
  idFactura,
  idCliente,
  etiqueta,
  lineas,
  yaAcreditado,
  totalFactura,
  onCerrar,
  onEmitida,
}: {
  idFactura: number;
  idCliente: number;
  etiqueta: string; // "FACT-A #12"
  lineas: LineaParaNota[];
  /** Unidades que ya corrigen otras notas certificadas, por producto */
  yaAcreditado: Record<number, number>;
  totalFactura: number;
  onCerrar: () => void;
  onEmitida: (idNota: number) => void;
}) {
  const [serie, setSerie] = useState<Serie | null | undefined>(undefined); // undefined = cargando
  const [cantidades, setCantidades] = useState<number[]>(() => lineas.map(() => 0));
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [onCerrar]);

  useEffect(() => {
    apiFetch<{ series: Serie[] }>("/api/v1/series").then((r) =>
      setSerie(r.datos?.series.find((s) => s.tipo_documento === "NCRE") ?? null)
    );
  }, []);

  // Lo que todavía se puede acreditar de cada línea (si un producto está en varias líneas, se reparte en orden)
  const disponibles = useMemo(() => {
    const usado = { ...yaAcreditado };
    return lineas.map((l) => {
      const ya = Math.min(l.cantidad, usado[l.id_producto] ?? 0);
      usado[l.id_producto] = (usado[l.id_producto] ?? 0) - ya;
      return l.cantidad - ya;
    });
  }, [lineas, yaAcreditado]);

  const items = lineas
    .map((l, i) => {
      const q = cantidades[i];
      if (!q) return null;
      const descuento = q === l.cantidad ? l.descuento : redondear((l.descuento * q) / l.cantidad);
      return { id_producto: l.id_producto, cantidad: q, precioUnitario: l.precio_unitario, descuento, total: redondear(l.precio_unitario * q - descuento) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const totalNota = redondear(items.reduce((a, x) => a + x.total, 0));
  const motivoValido = motivo.trim().length >= 5;
  const valido = items.length > 0 && totalNota > 0 && motivoValido && !!serie;

  function cambiar(i: number, texto: string) {
    const n = Math.max(0, Math.min(disponibles[i], Math.trunc(Number(texto) || 0)));
    setCantidades((c) => c.map((v, j) => (j === i ? n : v)));
  }

  async function emitir(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || guardando || !serie) return;
    setGuardando(true);
    setError(null);
    const r = await apiFetch<{ factura: { id_factura: number; estado: string } }>("/api/v1/facturas", {
      method: "POST",
      body: JSON.stringify({
        id_serie: serie.id_serie,
        clienteId: idCliente,
        idFacturaReferencia: idFactura,
        motivoReferencia: motivo.trim(),
        items: items.map(({ total: _total, ...resto }) => resto),
      }),
    });
    setGuardando(false);
    if (!r.ok || !r.datos) {
      setError(r.error?.mensaje ?? "No se pudo emitir la nota de crédito");
      return;
    }
    const nota = r.datos.factura;
    if (nota.estado === "CERTIFICADA") {
      notificar.ok(`Corrige ${etiqueta} por ${quetzales(totalNota)}`, { titulo: "Nota de crédito emitida" });
    } else {
      notificar.aviso("Se creó, pero aún no está certificada. Se reenviará sola al certificador.", { titulo: "Nota de crédito pendiente" });
    }
    onEmitida(nota.id_factura);
  }

  const nadaQueAcreditar = disponibles.every((d) => d === 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-nota"
      className="no-imprimir fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <form onSubmit={emitir} className="tarjeta aparecer w-full max-w-2xl p-6 shadow-2xl">
        <h2 id="titulo-nota" className="text-lg font-bold text-slate-900">
          Nota de crédito sobre {etiqueta}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Indique cuántas unidades de cada producto se devuelven o se corrigen. Usa el precio de la factura, la mercadería vuelve al
          inventario y el saldo del cliente baja. Total de la factura: {quetzales(totalFactura)}.
        </p>

        {serie === null && (
          <div className="alerta alerta-aviso mt-4" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span>No hay una serie de nota de crédito activa. Cree una en Configuración → Series.</span>
          </div>
        )}
        {nadaQueAcreditar && (
          <div className="alerta alerta-aviso mt-4" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span>Esta factura ya fue corregida por completo con otras notas de crédito.</span>
          </div>
        )}

        <div className="tabla-contenedor mt-4 max-h-72 overflow-auto">
          <table className="tabla w-full min-w-[30rem]">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Precio</th>
                <th className="num">Disponible</th>
                <th className="num">Acreditar</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const q = cantidades[i];
                const importe = q ? redondear(l.precio_unitario * q - (q === l.cantidad ? l.descuento : (l.descuento * q) / l.cantidad)) : 0;
                return (
                  <tr key={`${l.id_producto}-${i}`}>
                    <td>{l.nombre}</td>
                    <td className="num">{quetzales(l.precio_unitario)}</td>
                    <td className="num">{disponibles[i]}</td>
                    <td className="num">
                      <label className="sr-only" htmlFor={`nc-${i}`}>
                        Unidades a acreditar de {l.nombre}
                      </label>
                      <input
                        id={`nc-${i}`}
                        type="number"
                        min={0}
                        max={disponibles[i]}
                        step={1}
                        inputMode="numeric"
                        disabled={disponibles[i] === 0}
                        value={q || ""}
                        placeholder="0"
                        onChange={(e) => cambiar(i, e.target.value)}
                        className="campo !w-20 !py-1.5 text-right"
                      />
                    </td>
                    <td className="num">{importe ? quetzales(importe) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCantidades(disponibles.slice())}
            disabled={nadaQueAcreditar}
            className="boton boton-texto boton-chico"
          >
            Acreditar todo lo disponible
          </button>
          <p className="text-sm text-slate-600">
            Total de la nota: <strong className="tabular-nums text-slate-900">{quetzales(totalNota)}</strong>
          </p>
        </div>

        <label htmlFor="motivo-nota" className="etiqueta mt-4">
          Motivo
        </label>
        <textarea
          id="motivo-nota"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          maxLength={500}
          className="campo"
          placeholder="Ej. Devolución de mercadería dañada"
        />
        <p className="ayuda">Mínimo 5 caracteres. Aparece en la nota y en la bitácora.</p>

        {error && (
          <div className="alerta alerta-error mt-3" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCerrar} className="boton boton-secundario">
            Cancelar
          </button>
          <button type="submit" disabled={!valido || guardando} className="boton boton-primario">
            {guardando ? "Emitiendo…" : "Emitir nota de crédito"}
          </button>
        </div>
      </form>
    </div>
  );
}
