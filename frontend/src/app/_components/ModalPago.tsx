
"use client";

// ============================================================
// COMPONENTE — ventana para registrar un pago o abono
// La usan el detalle de la factura y la lista de "Por cobrar".
// El monto viene prellenado con el saldo; si el cliente paga
// menos, queda registrado como abono y el resto sigue pendiente.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { quetzales } from "@/lib/client/formato";
import { IconoAlerta, IconoDinero, IconoEdificio, IconoFactura, IconoQr, IconoTarjeta, IconoTransferencia } from "./iconos";

export interface FacturaParaPago {
  id_factura: number;
  etiqueta: string; // "FACT-A #12"
  cliente: string;
  saldo: number;
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

export default function ModalPago({
  factura,
  onCerrar,
  onRegistrado,
}: {
  factura: FacturaParaPago;
  onCerrar: () => void;
  onRegistrado: () => void;
}) {
  const [metodo, setMetodo] = useState<Metodo>("EFECTIVO");
  const [monto, setMonto] = useState(factura.saldo.toFixed(2));
  const [referencia, setReferencia] = useState("");
  const [recibido, setRecibido] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const montoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    montoRef.current?.select();
    function alPresionar(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [onCerrar]);

  const valor = Number(monto);
  const montoValido = Number.isFinite(valor) && valor > 0 && valor <= factura.saldo + 0.005;
  const restante = Math.max(0, factura.saldo - (montoValido ? valor : 0));
  const cambio = metodo === "EFECTIVO" && Number(recibido) > valor ? Number(recibido) - valor : 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!montoValido || guardando) return;
    setGuardando(true);
    setError(null);
    const r = await apiFetch("/api/v1/pagos", {
      method: "POST",
      body: JSON.stringify({
        facturaId: factura.id_factura,
        metodo,
        monto: Number(valor.toFixed(2)),
        referencia: referencia.trim() || undefined,
      }),
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo registrar el pago");
      return;
    }
    notificar.ok(`${factura.etiqueta} · ${factura.cliente}`, { titulo: `Pago de ${quetzales(valor)} registrado` });
    if (restante < 0.005) notificar.ok(`${factura.etiqueta} quedó saldada.`);
    onRegistrado();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-pago"
      className="no-imprimir fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <form onSubmit={guardar} className="tarjeta aparecer w-full max-w-md p-6 shadow-2xl">
        <h2 id="titulo-pago" className="text-lg font-bold text-slate-900">
          Registrar pago
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {factura.etiqueta} · {factura.cliente}
        </p>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-500">Saldo pendiente</span>
          <span className="text-xl font-bold tabular-nums text-slate-900">{quetzales(factura.saldo)}</span>
        </div>

        <p className="etiqueta mt-5">Método de pago</p>
        <div className="grid grid-cols-2 gap-2.5">
          {METODOS.map(({ valor: v, texto, Icono }) => {
            const activo = metodo === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setMetodo(v)}
                aria-pressed={activo}
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition ${
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

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pago-monto" className="etiqueta">
              Monto a pagar (Q)
            </label>
            <input
              id="pago-monto"
              ref={montoRef}
              type="number"
              step="0.01"
              min="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="campo tabular-nums"
              required
            />
          </div>
          {metodo === "EFECTIVO" ? (
            <div>
              <label htmlFor="pago-recibido" className="etiqueta">
                Efectivo recibido
              </label>
              <input
                id="pago-recibido"
                type="number"
                step="0.01"
                min="0"
                value={recibido}
                onChange={(e) => setRecibido(e.target.value)}
                className="campo tabular-nums"
                placeholder="Opcional"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="pago-ref" className="etiqueta">
                No. de referencia
              </label>
              <input
                id="pago-ref"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                className="campo"
                maxLength={50}
                placeholder="Opcional — autorización / boleta"
              />
            </div>
          )}
        </div>

        {cambio > 0 && (
          <div className="alerta alerta-ok mt-3">
            <span>
              Cambio a entregar: <strong>{quetzales(cambio)}</strong>
            </span>
          </div>
        )}
        {montoValido && restante > 0.005 && (
          <p className="ayuda">Es un abono: después del pago quedarán {quetzales(restante)} pendientes.</p>
        )}
        {!montoValido && monto !== "" && (
          <p className="mt-1.5 text-xs font-medium text-red-600">El monto debe ser mayor a 0 y no pasar del saldo.</p>
        )}

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
          <button type="submit" disabled={!montoValido || guardando} className="boton boton-primario">
            {guardando ? "Guardando…" : "Registrar pago"}
          </button>
        </div>
      </form>
    </div>
  );
}
