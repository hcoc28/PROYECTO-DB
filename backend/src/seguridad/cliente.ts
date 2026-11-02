// ============================================================
// SEGURIDAD — datos del cliente que hace la petición
// Next.js solo escribe la cabecera X-Forwarded-For si NO viene; si el cliente
// manda la suya, la deja tal cual. Por eso esa cabecera se puede falsificar
// y NO se debe usar para decidir cosas de seguridad, salvo que el servidor
// esté detrás de un proxy de confianza (nginx, un balanceador) que la
// sobrescribe. Eso se indica con la variable TRUST_PROXY=1.
// ============================================================

import { NOMBRE_COOKIE_SESION } from "./sesion-cookie";

interface ConCabeceras {
  headers: Headers;
  cookies?: { get(nombre: string): { value: string } | undefined };
}

const detrasDeProxy = () => process.env.TRUST_PROXY === "1";

/** IP del cliente para anotar en la bitácora. Con proxy de confianza se toma la que agregó el proxy (la última). */
export function ipDelCliente(req: ConCabeceras): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const partes = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (partes.length > 0) return detrasDeProxy() ? partes[partes.length - 1] : partes[0];
  }
  return req.headers.get("x-real-ip");
}

/**
 * IP "de confianza" para decisiones de seguridad (límite de peticiones).
 * Sin proxy de confianza devuelve null: no se puede saber la IP real sin que el cliente
 * pueda falsificarla, asi que todos comparten un mismo contador (mejor eso que no limitar).
 */
export function ipConfiable(req: ConCabeceras): string | null {
  if (!detrasDeProxy()) return null;
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;
  const partes = xff.split(",").map((p) => p.trim()).filter(Boolean);
  return partes.length > 0 ? partes[partes.length - 1] : null;
}

/** El token de sesión de la petición (cookie o cabecera Authorization), o null. */
export function tokenDeLaPeticion(req: ConCabeceras): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.cookies?.get(NOMBRE_COOKIE_SESION)?.value ?? null;
}
