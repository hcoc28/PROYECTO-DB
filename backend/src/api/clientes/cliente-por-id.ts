// ============================================================
// API — /api/v1/clientes/{id}
// GET:    ficha del cliente con su historial de compras.
// PUT:    edita sus datos (el consumidor final CF no se edita).
// DELETE: elimina un cliente que nunca ha comprado (solo ADMIN).
// ============================================================

import { NextRequest } from "next/server";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { aCliente, aFacturaLista, DOCUMENTOS_VENTA, dinero, incluirFacturaLista } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";
import { clasificarDocumento } from "../../validaciones/nit";
import { esquemaCliente } from "./clientes";

type Params = { params: Promise<{ id: string }> };

async function obtener(idTexto: string) {
  const id = Number(idTexto);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErrorApi(400, "ID_INVALIDO", "Identificador de cliente inválido");
  const cliente = await prisma.cliente.findUnique({ where: { id_cliente: id } });
  if (!cliente) throw new ErrorApi(404, "CLIENTE_NO_ENCONTRADO", "El cliente no existe");
  return cliente;
}

export const GET = manejarErrores(async (req: NextRequest, { params }: Params) => {
  await sesionDesdeRequest(req);
  const cliente = await obtener((await params).id);

  const [facturas, resumen] = await Promise.all([
    prisma.factura.findMany({
      where: { id_cliente: cliente.id_cliente },
      include: incluirFacturaLista,
      orderBy: { fecha_emision: "desc" },
      take: 15,
    }),
    prisma.factura.aggregate({
      where: {
        id_cliente: cliente.id_cliente,
        estado: "CERTIFICADA",
        serie_documento: { codigo_dte: { in: DOCUMENTOS_VENTA } },
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  return respuestaOk({
    cliente: aCliente(cliente),
    resumen: { cantidad: resumen._count._all, total: dinero(resumen._sum.total) },
    facturas: facturas.map(aFacturaLista),
  });
});

export const PUT = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN", "CAJERO");
  const actual = await obtener((await params).id);
  if (actual.documento === "CF") throw new ErrorApi(409, "CLIENTE_PROTEGIDO", "El consumidor final (CF) no se puede modificar");

  const input = esquemaCliente.parse(await req.json());
  const doc = clasificarDocumento(input.nit);
  if (doc?.tipo === "CF") throw new ErrorApi(409, "NIT_RESERVADO", "CF está reservado para el consumidor final");
  if (!doc) throw new ErrorApi(422, "NIT_INVALIDO", `El NIT o DPI ${input.nit} no es válido`);
  const nit = doc.documento;

  const otro = await prisma.cliente.findFirst({ where: { documento: nit } });
  if (otro && otro.id_cliente !== actual.id_cliente) {
    throw new ErrorApi(409, "NIT_DUPLICADO", `Ese NIT ya pertenece a ${otro.nombre_cliente}`);
  }

  const cliente = await conUsuario(sesion.usuarioId, (tx) =>
    tx.cliente.update({
      where: { id_cliente: actual.id_cliente },
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
    { usuarioId: sesion.usuarioId, accion: "ACTUALIZAR_CLIENTE", detalle: `${cliente.nombre_cliente} (${cliente.tipo_documento} ${cliente.documento})` },
    contextoRequest(req)
  );
  return respuestaOk({ cliente: aCliente(cliente) });
});

export const DELETE = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN");
  const cliente = await obtener((await params).id);
  if (cliente.documento === "CF") throw new ErrorApi(409, "CLIENTE_PROTEGIDO", "El consumidor final (CF) no se puede eliminar");

  // La base de datos decide (usp_eliminar_cliente): no borra al CF ni a un cliente con facturas o cobros.
  await conUsuario(sesion.usuarioId, (tx) => tx.$executeRaw`EXEC dbo.usp_eliminar_cliente @id_cliente = ${cliente.id_cliente}`);
  await registrarAuditoria(
    { usuarioId: sesion.usuarioId, accion: "ACTUALIZAR_CLIENTE", detalle: `Eliminó al cliente ${cliente.nombre_cliente} (${cliente.tipo_documento} ${cliente.documento})` },
    contextoRequest(req)
  );
  return respuestaOk({ eliminado: true });
});
