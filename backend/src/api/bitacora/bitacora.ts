// ============================================================
// API — GET /api/v1/bitacora
// Consulta la bitácora (auditoría): quién hizo qué, cuándo y desde
// qué IP. Solo lectura y solo para el ADMIN.
// Tabla: bitacora (id_usuario, accion, detalle, ip, fecha).
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../../base-de-datos/prisma";
import { exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";

const esquemaFiltros = z.object({
  accion: z.string().max(100).optional(),
  usuarioId: z.coerce.number().int().optional(),
  q: z.string().max(100).optional(), // texto dentro del detalle
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(30),
});

export const GET = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const f = esquemaFiltros.parse(Object.fromEntries(req.nextUrl.searchParams));

  const where = {
    ...(f.accion && { accion: f.accion }),
    ...(f.usuarioId && { id_usuario: f.usuarioId }),
    ...(f.q && { detalle: { contains: f.q } }),
    ...((f.desde || f.hasta) && {
      fecha: { ...(f.desde && { gte: f.desde }), ...(f.hasta && { lte: f.hasta }) },
    }),
  };

  const [total, registros, acciones, usuarios] = await Promise.all([
    prisma.bitacora.count({ where }),
    prisma.bitacora.findMany({
      where,
      include: { usuario: { select: { nombre_usuario: true } } },
      orderBy: { fecha: "desc" },
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
    // Para llenar los filtros de la pantalla
    prisma.bitacora.groupBy({ by: ["accion"], orderBy: { accion: "asc" } }),
    prisma.usuario.findMany({ select: { id_usuario: true, nombre_usuario: true }, orderBy: { nombre_usuario: "asc" } }),
  ]);

  await registrarAuditoria({ usuarioId: sesion.usuarioId, accion: "LEER_BITACORA" }, contextoRequest(req));

  return respuestaOk({
    registros,
    acciones: acciones.map((a) => a.accion),
    usuarios,
    paginacion: { pagina: f.pagina, porPagina: f.porPagina, total, paginas: Math.ceil(total / f.porPagina) },
  });
});
