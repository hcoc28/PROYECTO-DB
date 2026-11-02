// ============================================================
// API — POST /api/v1/auth/logout
// Cierra la sesión: borra la cookie de sesión del navegador y deja
// constancia en la bitácora. Funciona aunque la sesión ya haya caducado.
// ============================================================

import { NextRequest } from "next/server";
import { prisma } from "../../base-de-datos/prisma";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { sesionDesdeRequest } from "../../seguridad/auth";
import { NOMBRE_COOKIE_SESION, opcionesCookieSesion } from "../../seguridad/sesion-cookie";

export const POST = manejarErrores(async (req: NextRequest) => {
  // Si hay sesion valida se anota quien salio; si no, igual se borra la cookie
  const sesion = await sesionDesdeRequest(req).catch(() => null);
  if (sesion) {
    // La base de datos sube el contador de sesiones: el token que acaba de usarse (y cualquier otro) deja de valer
    await prisma.$executeRaw`EXEC dbo.usp_cerrar_sesiones @id_usuario = ${sesion.usuarioId}`;
    await registrarAuditoria({ usuarioId: sesion.usuarioId, accion: "LOGOUT" }, contextoRequest(req));
  }

  const respuesta = respuestaOk({ sesionCerrada: true });
  respuesta.cookies.set({ name: NOMBRE_COOKIE_SESION, value: "", ...opcionesCookieSesion(), maxAge: 0 });
  return respuesta;
});
