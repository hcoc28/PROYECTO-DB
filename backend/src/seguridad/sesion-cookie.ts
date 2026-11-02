// ============================================================
// SEGURIDAD — cookie de sesión
// El token de sesión viaja en una cookie con estas protecciones:
//   httpOnly  -> el JavaScript de la página NO puede leerla (si hubiera un
//                ataque XSS, no podría robar la sesión)
//   sameSite  -> el navegador no la envía en peticiones que vienen de otro sitio
//                (frena los ataques CSRF)
//   secure    -> solo viaja por HTTPS (se activa en producción)
// Es una cookie "de sesión": desaparece al cerrar el navegador.
// ============================================================

export const NOMBRE_COOKIE_SESION = "sesion";

export function opcionesCookieSesion() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}
