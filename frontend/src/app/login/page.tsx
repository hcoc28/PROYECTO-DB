"use client";

// ============================================================
// PÁGINA DE LOGIN — ruta: /login
// Formulario de inicio de sesión (usuario + contraseña).
// Al entrar correctamente, guarda el token en sessionStorage
// y redirige a la página principal (/).
//
// DISEÑO (para modificarlo, solo cambia las clases de Tailwind):
//   - Fondo:   casi negro + resplandores difuminados azul, celeste y verde.
//   - Avatar:  círculo con el ícono de usuario.
//   - Campos:  sin caja, solo una línea debajo (border-b).
//   - Botón:   degradado azul -> celeste -> verde.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CLAVE_AVISO_LOGIN, guardarSesion } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import { darBienvenida } from "@/lib/client/bienvenida";
import { IconoAlerta, IconoCandado, IconoOjo, IconoOjoTachado, IconoUsuario } from "../_components/iconos";

// Solo se recuerda el nombre de usuario (nunca la contraseña), en este navegador.
const CLAVE_USUARIO_RECORDADO = "ultimoUsuario";

export default function PaginaLogin() {
  const router = useRouter();
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [recordar, setRecordar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    document.title = "Iniciar sesión · SisEd";
    try {
      const motivo = sessionStorage.getItem(CLAVE_AVISO_LOGIN);
      sessionStorage.removeItem(CLAVE_AVISO_LOGIN);
      if (motivo === "caducada") notificar.aviso("Tu sesión terminó o se cerró desde otro lugar. Ingresa de nuevo para continuar.");
      else if (motivo === "cerrada") notificar.ok("Sesión cerrada. ¡Hasta pronto!");
    } catch {
      // sin almacenamiento: no hay aviso
    }
    try {
      const guardado = localStorage.getItem(CLAVE_USUARIO_RECORDADO);
      if (guardado) {
        setNombreUsuario(guardado);
        setRecordar(true);
      }
    } catch {
      // sin almacenamiento local: simplemente no se recuerda
    }
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreUsuario, password }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.mensaje ?? "No se pudo iniciar sesión");
        return;
      }
      try {
        if (recordar) localStorage.setItem(CLAVE_USUARIO_RECORDADO, nombreUsuario);
        else localStorage.removeItem(CLAVE_USUARIO_RECORDADO);
      } catch {
        // ignorar: no es crítico
      }
      guardarSesion(json.datos.usuario.nombre_usuario, json.datos.usuario.rol);
      try {
        sessionStorage.removeItem(CLAVE_AVISO_LOGIN);
        sessionStorage.removeItem("avisosInicio"); // los avisos del inicio se muestran una vez por sesión
      } catch {
        // ignorar
      }
      darBienvenida(json.datos.usuario.nombre_usuario);
      router.replace("/"); // navegacion interna: sin recargar toda la pagina
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setCargando(false);
    }
  }

  return (
    // ---------- Fondo: degradado morado, centrado ----------
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-1000 to-black px-6 py-10">
      {/* Resplandores difuminados (decoración): azul arriba-izquierda, celeste arriba-derecha, verde abajo */}
      <div className="pointer-events-none absolute left-[-62.4vmin] top-[-39.5vmin] size-[66.6vmin] rounded-full bg-blue-700/75 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute left-[-29.1vmin] top-[-97.8vmin] size-[99.9vmin] rounded-full bg-cyan-400/60 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[-29.1vmin] top-[-91.6vmin] size-[93.2vmin] rounded-full bg-amber-300/55 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[-20.8vmin] top-[-29.1vmin] size-[33.3vmin] rounded-full bg-neutral-500/60 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[-95.7vmin] top-[-58.3vmin] size-[99.9vmin] rounded-full bg-gray-400/60 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute left-[-16vmin] bottom-[-10vmin] size-[25vmin] rounded-full bg-rose-400/60 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute left-[-72vmin] bottom-[-78vmin] size-[99.9vmin] rounded-full bg-purple-400/60 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-[-2.9vh] right-[115.6vw] size-[41.6vmin] rounded-full bg-pink-400/60 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-[-39.5vh] left-[85.7vw] size-[41.6vmin] rounded-full bg-green-500/65 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute top-[41.6vh] left-[117vw] size-[41.6vmin] rounded-full bg-emerald-500/60 blur-3xl" aria-hidden="true" />
      <div className="aparecer relative w-full max-w-xs">
        {/* ---------- Avatar ---------- */}
        {/* "isolate" encierra el resplandor celeste en este bloque: siempre queda detras del circulo del usuario */}
        <div className="relative isolate mx-auto size-20">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[10rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/30 blur-3xl" aria-hidden="true" />
          <div className="relative z-10 grid size-20 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-blue-950/60 ring-1 ring-white/25">
            <IconoUsuario className="size-10 text-white/90" />
          </div>
        </div>

        <form onSubmit={enviar} className="mt-12 space-y-7">
          {/* ---------- Usuario ---------- */}
          <div>
            <label htmlFor="usuario" className="sr-only">
              Usuario
            </label>
            <div className="relative">
              <IconoUsuario className="pointer-events-none absolute left-0 top-1/2 size-5 -translate-y-1/2 text-cyan-300/80" />
              <input
                id="usuario"
                value={nombreUsuario}
                onChange={(e) => setNombreUsuario(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="Usuario"
                className="campo-linea w-full border-0 border-b border-white/30 bg-transparent py-3 pl-9 pr-2 text-white placeholder:text-slate-400 transition focus:border-cyan-300 focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          {/* ---------- Contraseña ---------- */}
          <div>
            <label htmlFor="clave" className="sr-only">
              Contraseña
            </label>
            <div className="relative">
              <IconoCandado className="pointer-events-none absolute left-0 top-1/2 size-5 -translate-y-1/2 text-cyan-300/80" />
              <input
                id="clave"
                type={verPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Contraseña"
                className="campo-linea w-full border-0 border-b border-white/30 bg-transparent py-3 pl-9 pr-10 text-white placeholder:text-slate-400 transition focus:border-cyan-300 focus:outline-none focus:ring-0"
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                className="absolute right-0 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:text-cyan-300"
                aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {verPassword ? <IconoOjoTachado className="size-5" /> : <IconoOjo className="size-5" />}
              </button>
            </div>
          </div>

          {/* ---------- Recordarme ---------- */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={recordar}
              onChange={(e) => setRecordar(e.target.checked)}
              className="size-4 rounded border-white/40 bg-transparent accent-cyan-400"
            />
            Recordar mi usuario
          </label>

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg bg-red-500/20 px-3 py-2.5 text-sm text-red-100 ring-1 ring-red-300/30"
              role="alert"
            >
              <IconoAlerta className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ---------- Botón ---------- */}
          <button
            type="submit"
            disabled={cargando || !nombreUsuario || !password}
            className="flex h-12 w-full items-center justify-center gap-2 bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-cyan-950/50 transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cargando ? (
              <>
                <span className="girar size-5 rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                Ingresando…
              </>
            ) : (
              "Ingresar"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
