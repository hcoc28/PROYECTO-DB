"use client";

// ============================================================
// LIBRERÍA — llamadas a la API desde el navegador
// Helper que usan las páginas para hacer fetch() (la cookie de sesión
// viaja sola) y para recordar/borrar los datos de la sesión.
// ============================================================

// ============================================================
// Helper de cliente: token de sesión + fetch autenticado.
// ============================================================

// El token de sesion YA NO se guarda aqui: viaja en una cookie "httpOnly" que el servidor
// pone al iniciar sesion y que el JavaScript de la pagina no puede leer (si algun dia hubiera
// un ataque XSS, no podria robar la sesion). Aqui solo se recuerda el nombre y el rol para
// mostrarlos en pantalla; sirven tambien de marca de "ya inicie sesion en esta pestana".

export function obtenerUsuario(): { nombreUsuario: string; rol: string } | null {
  if (typeof window === "undefined") return null;
  const nombreUsuario = sessionStorage.getItem("nombreUsuario");
  const rol = sessionStorage.getItem("rol");
  return nombreUsuario && rol ? { nombreUsuario, rol } : null;
}

/** Vende, cobra y edita datos: ADMIN y CAJERO. El GERENTE solo consulta. */
export function puedeOperar(): boolean {
  const rol = obtenerUsuario()?.rol;
  return rol === "ADMIN" || rol === "CAJERO";
}

/** Ve las cifras de todo el negocio (resumen, reportes, valor del inventario): ADMIN y GERENTE. */
export function esDirectivo(): boolean {
  const rol = obtenerUsuario()?.rol;
  return rol === "ADMIN" || rol === "GERENTE";
}

/** ¿Se inicio sesion en esta pestana? (si la cookie ya caduco, la primera llamada a la API devuelve 401 y se vuelve al login) */
export function haySesion(): boolean {
  return obtenerUsuario() !== null;
}

export function guardarSesion(nombreUsuario: string, rol: string) {
  sessionStorage.setItem("nombreUsuario", nombreUsuario);
  sessionStorage.setItem("rol", rol);
}

/** Mensaje que la pantalla de login muestra al volver (sesión cerrada por el usuario o caducada). */
export const CLAVE_AVISO_LOGIN = "avisoLogin";

export async function cerrarSesion(caducada = false) {
  try {
    sessionStorage.setItem(CLAVE_AVISO_LOGIN, caducada ? "caducada" : "cerrada");
  } catch {
    // sin almacenamiento: simplemente no habrá aviso
  }
  try {
    // El servidor borra la cookie y anota la salida en la bitacora
    await fetch("/api/v1/auth/logout", { method: "POST" });
  } catch {
    // sin conexion: igual se limpia lo local
  }
  sessionStorage.removeItem("nombreUsuario");
  sessionStorage.removeItem("rol");
  window.location.href = "/login";
}

interface RespuestaApi<T> {
  ok: boolean;
  status: number;
  datos: T | null;
  error: { codigo: string; mensaje: string; detalles?: Record<string, unknown> } | null;
}

export async function apiFetch<T = unknown>(
  path: string,
  opciones: RequestInit = {}
): Promise<RespuestaApi<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...opciones,
      credentials: "same-origin", // envia la cookie de sesion
      headers: { "Content-Type": "application/json", ...(opciones.headers ?? {}) },
    });
  } catch {
    // Sin red o servidor caído: se devuelve un resultado (status 0) en vez
    // de lanzar, para que las pantallas puedan avisar y no se queden pegadas.
    return {
      ok: false,
      status: 0,
      datos: null,
      error: { codigo: "SIN_CONEXION", mensaje: "No hay conexión con el servidor" },
    };
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== "undefined") {
    cerrarSesion(true);
  }
  return {
    ok: res.ok && !!json?.ok,
    status: res.status,
    datos: json?.datos ?? null,
    error: json?.error ?? null,
  };
}
