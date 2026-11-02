// ============================================================
// API — POST /api/v1/facturas/reintentar   (solo ADMIN)
// Vuelve a enviar al certificador las facturas que quedaron en PENDIENTE_CERTIFICACION.
// Normalmente lo hace solo el proceso automatico (src/instrumentation.ts); esto permite lanzarlo a mano.
// ============================================================

import { NextRequest } from "next/server";
import { exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { reintentarPendientes } from "../../servicios/reintentos";

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  return respuestaOk(await reintentarPendientes());
});
