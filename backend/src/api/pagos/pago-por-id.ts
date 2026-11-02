// ============================================================
// API — DELETE /api/v1/pagos/{id}
// Anula un cobro registrado por error (solo ADMIN). {id} es el id del
// COBRO (el recibo). La base de datos lo marca anulado, devuelve su
// importe a la deuda de la factura y lo registra en la cuenta del cliente.
// Un cobro anulado nunca se borra: queda en el historial.
// ============================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../../base-de-datos/prisma";
import { conUsuario } from "../../base-de-datos/sql";
import { dinero } from "../../base-de-datos/adaptadores";
import { ErrorApi, exigirRol, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";

type Params = { params: Promise<{ id: string }> };

const esquema = z.object({ motivo: z.string().trim().min(5).max(255) });

export const DELETE = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  exigirRol(sesion, "ADMIN"); // un cajero NO anula cobros
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErrorApi(400, "ID_INVALIDO", "Identificador de cobro inválido");
  const { motivo } = esquema.parse(await req.json());

  const cobro = await prisma.cobro.findUnique({
    where: { id_cobro: BigInt(id) },
    include: { cobro_aplicacion: { include: { factura: { include: { serie_documento: true } } } } },
  });
  if (!cobro) throw new ErrorApi(404, "COBRO_NO_ENCONTRADO", "El cobro no existe");
  if (cobro.estado === "ANULADO") throw new ErrorApi(409, "COBRO_NO_ANULABLE", "El cobro ya estaba anulado");

  await conUsuario(sesion.usuarioId, (tx) =>
    tx.$executeRaw`EXEC dbo.usp_anular_cobro @id_cobro = ${cobro.id_cobro}, @id_usuario = ${sesion.usuarioId}, @motivo = ${motivo}`
  );

  const facturas = cobro.cobro_aplicacion.map(
    (a) => `${a.factura.serie_documento.codigo_dte}-${a.factura.serie_documento.serie_interna} #${a.factura.numero_interno}`
  );
  await registrarAuditoria(
    {
      usuarioId: sesion.usuarioId,
      accion: "ANULAR",
      detalle: `Cobro #${id} (${cobro.codigo_metodo} Q${dinero(cobro.monto)}) de ${facturas.join(", ") || "sin factura"}: ${motivo}`,
    },
    contextoRequest(req)
  );

  return respuestaOk({ cobro: { id_cobro: id, estado: "ANULADO" }, facturasAfectadas: facturas });
});
