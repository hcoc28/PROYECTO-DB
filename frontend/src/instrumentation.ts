// ============================================================
// Tarea en segundo plano: reintenta cada pocos minutos las facturas que quedaron
// esperando al certificador (PENDIENTE_CERTIFICACION).
// Next.js ejecuta register() una vez al arrancar el servidor.
// Se controla con la variable FEL_REINTENTO_MINUTOS (por defecto 5; 0 = apagado).
// ============================================================

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const minutos = Number(process.env.FEL_REINTENTO_MINUTOS ?? "5");
  if (!(minutos > 0)) return;

  // En desarrollo el codigo se recarga: esta marca evita crear varios temporizadores
  const global = globalThis as { __felReintento?: boolean };
  if (global.__felReintento) return;
  global.__felReintento = true;

  const { reintentarPendientes } = await import("@backend/servicios/reintentos");
  setInterval(() => {
    reintentarPendientes().catch((err) => console.error("[FEL] Fallo el reintento automatico:", err));
  }, minutos * 60_000);
}
