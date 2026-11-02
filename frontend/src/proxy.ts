// ============================================================
// PROXY — límite de peticiones
// Next.js exige este archivo aquí (en Next 16 se llama "proxy",
// antes "middleware"). Se ejecuta antes de CUALQUIER ruta /api/*.
// La lógica real está en backend/src/seguridad/limite-peticiones.ts
// ============================================================

import type { NextRequest } from "next/server";
import { limitarPeticiones } from "@backend/seguridad/limite-peticiones";

export function proxy(req: NextRequest) {
  return limitarPeticiones(req);
}

// Next.js necesita leer esto directamente en este archivo.
export const config = { matcher: "/api/:path*" };
