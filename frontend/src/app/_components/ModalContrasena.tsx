"use client";

// ============================================================
// COMPONENTE — ventana para que cada persona cambie su contraseña
// Pide la actual y la nueva (dos veces). Cumple la misma política
// que al crear usuarios: mínimo 8, con mayúscula, minúscula y número.
// ============================================================

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { IconoAlerta, IconoCheck } from "./iconos";

export default function ModalContrasena({ onCerrar }: { onCerrar: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [onCerrar]);

  const cumple = {
    largo: nueva.length >= 8,
    minuscula: /[a-z]/.test(nueva),
    mayuscula: /[A-Z]/.test(nueva),
    numero: /[0-9]/.test(nueva),
  };
  const politicaOk = Object.values(cumple).every(Boolean);
  const coincide = nueva !== "" && nueva === repetir;
  const valido = actual !== "" && politicaOk && coincide;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    setError(null);
    const r = await apiFetch("/api/v1/auth/cambiar-password", {
      method: "POST",
      body: JSON.stringify({ actual, nueva }),
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo cambiar la contraseña");
      return;
    }
    notificar.ok("Tus otras sesiones abiertas se cerraron por seguridad.", { titulo: "Contraseña actualizada" });
    setListo(true);
  }

  const regla = (ok: boolean, texto: string) => (
    <li className={ok ? "text-emerald-700" : "text-slate-500"}>
      {ok ? "✓" : "•"} {texto}
    </li>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-contrasena"
      className="no-imprimir fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <form onSubmit={guardar} className="tarjeta aparecer w-full max-w-md p-6 shadow-2xl">
        {listo ? (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <IconoCheck className="size-7" />
            </span>
            <h2 id="titulo-contrasena" className="mt-3 text-lg font-bold text-slate-900">
              Contraseña actualizada
            </h2>
            <p className="mt-1 text-sm text-slate-500">La próxima vez que inicies sesión usa la contraseña nueva.</p>
            <button type="button" onClick={onCerrar} className="boton boton-primario mt-5 w-full">
              Listo
            </button>
          </div>
        ) : (
          <>
            <h2 id="titulo-contrasena" className="text-lg font-bold text-slate-900">
              Cambiar mi contraseña
            </h2>
            <p className="mt-1 text-sm text-slate-500">Por seguridad, escribe primero la contraseña que usas ahora.</p>

            <label htmlFor="pw-actual" className="etiqueta mt-4">
              Contraseña actual
            </label>
            <input id="pw-actual" type="password" value={actual} onChange={(e) => setActual(e.target.value)} className="campo" autoComplete="current-password" autoFocus />

            <label htmlFor="pw-nueva" className="etiqueta mt-3">
              Contraseña nueva
            </label>
            <input id="pw-nueva" type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} className="campo" autoComplete="new-password" maxLength={100} />
            <ul className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
              {regla(cumple.largo, "8 o más caracteres")}
              {regla(cumple.mayuscula, "Una mayúscula")}
              {regla(cumple.minuscula, "Una minúscula")}
              {regla(cumple.numero, "Un número")}
            </ul>

            <label htmlFor="pw-repetir" className="etiqueta mt-3">
              Repite la contraseña nueva
            </label>
            <input id="pw-repetir" type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} className="campo" autoComplete="new-password" maxLength={100} />
            {repetir !== "" && !coincide && <p className="ayuda text-red-600">Las contraseñas no coinciden.</p>}

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
                {guardando ? "Guardando…" : "Cambiar contraseña"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
