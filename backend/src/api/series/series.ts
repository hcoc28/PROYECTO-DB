// ============================================================
// API — /api/v1/series
// GET:  lista las series de facturación activas.
// POST: crea una serie nueva (solo ADMIN).
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { negocioActivo } from "../../servicios/negocio-activo";
import { prisma } from "../../base-de-datos/prisma";
import { aSerie } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";

// GET  /api/v1/series → listado de series (para POS y facturación)
// POST /api/v1/series → crear serie (solo ADMIN)

export const GET = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  // El ADMIN puede pedir también las desactivadas (?todas=1) para administrarlas
  const todas = sesion.rol === "ADMIN" && req.nextUrl.searchParams.get("todas") === "1";
  const negocio = await negocioActivo();
  const series = await prisma.serie_documento.findMany({
    where: { id_negocio: negocio?.id_negocio ?? -1, ...(todas ? {} : { activa: true }) },
    orderBy: [{ codigo_dte: "asc" }, { serie_interna: "asc" }],
  });
  return respuestaOk({ series: series.map(aSerie) });
});

const esquemaCrear = z.object({
  tipo_documento: z.enum(["FACT", "NCRE"]),
  serie: z.string().min(1).max(10),
});

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const input = esquemaCrear.parse(await req.json());

  const negocio = await negocioActivo();
  if (!negocio) throw new ErrorApi(409, "NEGOCIO_NO_CONFIGURADO", "Configure primero los datos del negocio");

  const existente = await prisma.serie_documento.findFirst({
    where: { id_negocio: negocio.id_negocio, codigo_dte: input.tipo_documento, serie_interna: input.serie },
  });
  if (existente) throw new ErrorApi(409, "SERIE_EXISTE", "Esa serie ya existe para ese tipo de documento");

  const serie = await prisma.serie_documento.create({
    data: { id_negocio: negocio.id_negocio, codigo_dte: input.tipo_documento, serie_interna: input.serie, activa: true },
  });
  return respuestaOk({ serie: aSerie(serie) }, 201);
});
