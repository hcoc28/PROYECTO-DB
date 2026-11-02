// ============================================================
// API — PUT /api/v1/series/{id}
// Activa o desactiva una serie de facturación (solo ADMIN).
// Una serie desactivada deja de aparecer en el POS, pero su
// historial y su correlativo se conservan. Debe quedar al menos
// una serie FACT activa para poder vender.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../../base-de-datos/prisma";
import { aSerie } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";

type Params = { params: Promise<{ id: string }> };

const esquema = z.object({ activa: z.boolean() });

export const PUT = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErrorApi(400, "ID_INVALIDO", "Identificador de serie inválido");
  const { activa } = esquema.parse(await req.json());

  const serie = await prisma.serie_documento.findUnique({ where: { id_serie_documento: id } });
  if (!serie) throw new ErrorApi(404, "SERIE_NO_ENCONTRADA", "La serie no existe");

  if (!activa && serie.codigo_dte === "FACT") {
    const otras = await prisma.serie_documento.count({ where: { codigo_dte: "FACT", activa: true, id_serie_documento: { not: id } } });
    if (otras === 0) throw new ErrorApi(409, "ULTIMA_SERIE", "Debe quedar al menos una serie de facturas (FACT) activa");
  }

  const actualizada = await prisma.serie_documento.update({ where: { id_serie_documento: id }, data: { activa } });
  await registrarAuditoria(
    {
      usuarioId: sesion.usuarioId,
      accion: "ACTUALIZAR_SERIE",
      detalle: `${serie.codigo_dte}-${serie.serie_interna} ${activa ? "activada" : "desactivada"}`,
    },
    contextoRequest(req)
  );
  return respuestaOk({ serie: aSerie(actualizada) });
});
