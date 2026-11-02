// ============================================================
// API — GET /api/v1/unidades
// Catálogo de unidades de medida (unidad, kilogramo, litro, servicio…).
// FEL exige una unidad en cada línea; el formulario de productos la elige de aquí.
// ============================================================

import { NextRequest } from "next/server";
import { prisma } from "../../base-de-datos/prisma";
import { sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";

export const GET = manejarErrores(async (req: NextRequest) => {
  await sesionDesdeRequest(req);
  const unidades = await prisma.unidad_medida.findMany({ orderBy: { nombre: "asc" } });
  return respuestaOk({ unidades });
});
