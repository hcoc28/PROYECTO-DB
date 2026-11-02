// ============================================================
// API — /api/v1/clientes
// GET:  lista/busca clientes (nombre, NIT, correo o teléfono) con
//       cuántas compras han hecho y cuánto han comprado.
// POST: registra un cliente nuevo.
// Tabla: cliente (en la API `nit` es el campo `documento` de la base de datos).
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { aCliente, DOCUMENTOS_VENTA, dinero } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { clasificarDocumento, normalizarNit } from "../../validaciones/nit";

const esquemaFiltros = z.object({
  q: z.string().max(100).optional(),
  nit: z.string().max(15).optional(), // búsqueda exacta (el POS la usa al escribir un NIT)
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = manejarErrores(async (req: NextRequest) => {
  await sesionDesdeRequest(req);
  const f = esquemaFiltros.parse(Object.fromEntries(req.nextUrl.searchParams));

  const where: Prisma.clienteWhereInput = {
    ...(f.nit && { documento: normalizarNit(f.nit) }),
    ...(f.q && {
      OR: [
        { nombre_cliente: { contains: f.q } },
        { documento: { contains: f.q } },
        { correo: { contains: f.q } },
        { telefono: { contains: f.q } },
      ],
    }),
  };

  const [total, clientes] = await Promise.all([
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where,
      orderBy: { nombre_cliente: "asc" },
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
  ]);

  // Compras de los clientes de esta página (solo ventas válidas)
  const compras = await prisma.factura.groupBy({
    by: ["id_cliente"],
    where: {
      id_cliente: { in: clientes.map((c) => c.id_cliente) },
      estado: "CERTIFICADA",
      serie_documento: { codigo_dte: { in: DOCUMENTOS_VENTA } },
    },
    _sum: { total: true },
    _count: { _all: true },
    _max: { fecha_emision: true },
  });
  const porCliente = new Map(compras.map((c) => [c.id_cliente, c]));

  return respuestaOk({
    clientes: clientes.map((c) => {
      const g = porCliente.get(c.id_cliente);
      return {
        ...aCliente(c),
        compras: {
          cantidad: g?._count._all ?? 0,
          total: dinero(g?._sum.total),
          ultima: g?._max.fecha_emision ?? null,
        },
      };
    }),
    paginacion: { pagina: f.pagina, porPagina: f.porPagina, total, paginas: Math.ceil(total / f.porPagina) },
  });
});

export const esquemaCliente = z.object({
  nombre_cliente: z.string().trim().min(2).max(100),
  nit: z.string().trim().min(1).max(15),
  correo: z.string().trim().email().max(100).nullable().optional().or(z.literal("")),
  telefono: z.string().trim().max(15).nullable().optional(),
  direccion: z.string().trim().max(255).nullable().optional(),
});

export const POST = manejarErrores(async (req: NextRequest) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN", "CAJERO");
  const input = esquemaCliente.parse(await req.json());

  const doc = clasificarDocumento(input.nit);
  if (doc?.tipo === "CF") throw new ErrorApi(409, "NIT_RESERVADO", "CF es el consumidor final y ya existe");
  if (!doc) throw new ErrorApi(422, "NIT_INVALIDO", `El NIT o DPI ${input.nit} no es válido`);
  const nit = doc.documento;

  const existente = await prisma.cliente.findFirst({ where: { documento: nit } });
  if (existente) {
    throw new ErrorApi(409, "NIT_DUPLICADO", `Ya existe un cliente con ese NIT: ${existente.nombre_cliente}`);
  }

  const cliente = await conUsuario(sesion.usuarioId, (tx) =>
    tx.cliente.create({
      data: {
        nombre_cliente: input.nombre_cliente,
        tipo_documento: doc.tipo,
        documento: nit,
        correo: input.correo || null,
        telefono: input.telefono || null,
        direccion: input.direccion || null,
      },
    })
  );

  await registrarAuditoria(
    { usuarioId: sesion.usuarioId, accion: "CREAR_CLIENTE", detalle: `${cliente.nombre_cliente} (${cliente.tipo_documento} ${cliente.documento})` },
    contextoRequest(req)
  );

  return respuestaOk({ cliente: aCliente(cliente) }, 201);
});
