"use client";

// ============================================================
// COMPONENTE — ventana para anular una factura (solo ADMIN)
// Pide el motivo (mínimo 5 letras, queda en la bitácora) y avisa
// que la mercadería regresa al inventario.
// ============================================================

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { IconoAlerta } from "./iconos";

export default function ModalAnular({
  idFactura,
  etiqueta,
  onCerrar,
  onAnulada,
}: {
  idFactura: number;
  etiqueta: string; // "FACT-A #12"
  onCerrar: () => void;
  onAnulada: () => void;
}) {
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

  const valido = motivo.trim().length >= 5;

  async function anular(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    setError(null);
    const r = await apiFetch(`/api/v1/facturas/${idFactura}`, {
      method: "DELETE",
      body: JSON.stringify({ motivo: motivo.trim() }),
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo anular la factura");
      return;
    }
    notificar.ok("La mercadería volvió al inventario.", { titulo: `${etiqueta} anulada` });
    onAnulada();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-anular"
      className="no-imprimir fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <form onSubmit={anular} className="tarjeta aparecer w-full max-w-md p-6 shadow-2xl">
        <h2 id="titulo-anular" className="text-lg font-bold text-slate-900">
          Anular {etiqueta}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          La factura quedará anulada, ya no contará en los reportes y la mercadería volverá al inventario. Esta acción no se puede deshacer.
        </p>

        <label htmlFor="motivo" className="etiqueta mt-4">
          Motivo de la anulación
        </label>
        <textarea
          id="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={255}
          className="campo"
          placeholder="Ej. Error en el NIT del cliente"
          autoFocus
        />
        <p className="ayuda">Mínimo 5 caracteres. Queda registrado en la bitácora.</p>

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
          <button type="submit" disabled={!valido || guardando} className="boton boton-peligro">
            {guardando ? "Anulando…" : "Anular factura"}
          </button>
        </div>
      </form>
    </div>
  );
}
