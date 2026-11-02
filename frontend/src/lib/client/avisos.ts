"use client";

// ============================================================
// LIBRERÍA — notificaciones (avisos emergentes)
// Cualquier pantalla llama a notificar.ok("Guardado"), notificar.error(...),
// notificar.aviso(...) o notificar.info(...). El componente <Avisos />
// (montado una sola vez en el layout) los dibuja arriba de todo.
// ============================================================

export type TipoAviso = "ok" | "error" | "aviso" | "info";

export interface Aviso {
  id: number;
  tipo: TipoAviso;
  texto: string;
  titulo?: string;
  /** Milisegundos que permanece en pantalla */
  duracion: number;
}

interface Opciones {
  titulo?: string;
  duracion?: number;
}

const DURACION: Record<TipoAviso, number> = { ok: 5000, info: 6000, aviso: 8000, error: 10000 };

type Escucha = (a: Aviso) => void;
const escuchas = new Set<Escucha>();
// Si un aviso se emite antes de que el componente se monte, espera aquí
const pendientes: Aviso[] = [];
let contador = 0;

export function suscribirAvisos(fn: Escucha): () => void {
  escuchas.add(fn);
  pendientes.splice(0).forEach(fn);
  return () => {
    escuchas.delete(fn);
  };
}

function emitir(tipo: TipoAviso, texto: string, opciones: Opciones = {}) {
  const aviso: Aviso = { id: ++contador, tipo, texto, titulo: opciones.titulo, duracion: opciones.duracion ?? DURACION[tipo] };
  if (escuchas.size === 0) pendientes.push(aviso);
  else escuchas.forEach((f) => f(aviso));
}

export const notificar = {
  ok: (texto: string, opciones?: Opciones) => emitir("ok", texto, opciones),
  error: (texto: string, opciones?: Opciones) => emitir("error", texto, opciones),
  aviso: (texto: string, opciones?: Opciones) => emitir("aviso", texto, opciones),
  info: (texto: string, opciones?: Opciones) => emitir("info", texto, opciones),
};
