// ============================================================
// API — /api/v1/negocio
// GET: datos fiscales del negocio (sin exponer las llaves).
// PUT: crea o actualiza esos datos y el certificador FEL.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { negocioActivo } from "../../servicios/negocio-activo";
import { prisma } from "../../base-de-datos/prisma";
import { afiliacionDe, aNegocio } from "../../base-de-datos/adaptadores";
import { exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { cifrar } from "../../seguridad/crypto";
import { registrarAuditoria } from "../../seguridad/audit";

// ============================================================
// GET /api/v1/negocio  → datos fiscales + estado de config. FEL
//                        (las llaves cifradas NUNCA se devuelven)
// PUT /api/v1/negocio  → crear/actualizar (solo ADMIN)
// ============================================================

export const GET = manejarErrores(async (req: NextRequest) => {
  await sesionDesdeRequest(req);
  const negocio = await negocioActivo();
  if (!negocio) return respuestaOk({ negocio: null });

  return respuestaOk({ negocio: aNegocio(negocio) });
});

const esquema = z.object({
  nit: z.string().min(2).max(20),
  razon_social: z.string().min(1).max(255),
  nombre_comercial: z.string().min(1).max(255),
  direccion: z.string().min(1).max(500),
  municipio: z.string().min(1).max(100),
  departamento: z.string().min(1).max(100),
  regimen: z.enum(["GEN", "PEQ"]),
  certificador: z.enum(["INFILE", "G4S", "MEGAPRINT"]).optional(),
  ambiente: z.enum(["CERTIFICACION", "PRODUCCION"]).default("CERTIFICACION"),
  usuario_api: z.string().max(100).optional(),
  llave_api: z.string().max(500).optional(), // texto plano de entrada; se cifra antes de guardar
  llave_firma: z.string().max(500).optional(),
});

export const PUT = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const input = esquema.parse(await req.json());

  // Los datos fiscales se pueden guardar sin las credenciales del
  // certificador: esas llaves son opcionales y se pueden agregar después.
  const existente = await negocioActivo();

  const data = {
    nit: input.nit,
    razon_social: input.razon_social,
    nombre_comercial: input.nombre_comercial,
    direccion: input.direccion,
    municipio: input.municipio,
    departamento: input.departamento,
    afiliacion_iva: afiliacionDe(input.regimen),
    ambiente_fel: input.ambiente,
    ...(input.certificador && { certificador: input.certificador }),
    ...(input.usuario_api && { usuario_api: input.usuario_api }),
    ...(input.llave_api && { llave_api: cifrar(input.llave_api) }),
    ...(input.llave_firma && { llave_firma: cifrar(input.llave_firma) }),
  };

  const negocio = existente
    ? await prisma.negocio.update({ where: { id_negocio: existente.id_negocio }, data })
    : await prisma.negocio.create({
        data: {
          ...data,
          certificador: input.certificador ?? null,
          usuario_api: input.usuario_api || null,
          llave_api: input.llave_api ? cifrar(input.llave_api) : null,
          llave_firma: input.llave_firma ? cifrar(input.llave_firma) : null,
        },
      });

  await registrarAuditoria({ usuarioId: sesion.usuarioId, accion: "ACTUALIZAR_NEGOCIO", detalle: negocio.razon_social });

  return respuestaOk({ negocio: aNegocio(negocio) });
});
