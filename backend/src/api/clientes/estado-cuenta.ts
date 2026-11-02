// ============================================================
// API — GET /api/v1/clientes/{id}/estado-cuenta
// El estado de cuenta de un cliente: cada cargo (factura, nota de
// débito) y cada abono (cobro, nota de crédito) con el saldo después
// de cada movimiento. Lo calcula la base de datos (vista
// vw_estado_cuenta_cliente y vw_saldo_cliente).
// Saldo positivo = el cliente debe; negativo = tiene saldo a favor.
// ============================================================

import { NextRequest } from "next/server";
import { prisma } from "../../base-de-datos/prisma";
import { dinero } from "../../base-de-datos/adaptadores";
import { ErrorApi, sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";
import { contextoRequest, registrarAuditoria } from "../../seguridad/audit";

type Params = { params: Promise<{ id: string }> };

const MAX_MOVIMIENTOS = 200;

interface FilaMovimiento {
  id_movimiento: bigint;
  fecha_movimiento: Date;
  tipo_movimiento: string;
  id_factura: bigint | null;
  id_cobro: bigint | null;
  descripcion: string | null;
  cargo: unknown;
  abono: unknown;
  saldo_acumulado: unknown;
}

export const GET = manejarErrores(async (req: NextRequest, { params }: Params) => {
  const sesion = await sesionDesdeRequest(req);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErrorApi(400, "ID_INVALIDO", "Identificador de cliente inválido");

  const cliente = await prisma.cliente.findUnique({ where: { id_cliente: id }, select: { id_cliente: true } });
  if (!cliente) throw new ErrorApi(404, "CLIENTE_NO_ENCONTRADO", "El cliente no existe");

  const [movimientos, resumen] = await Promise.all([
    // El saldo acumulado se calcula sobre TODO el historial; el TOP solo recorta lo que se devuelve.
    prisma.$queryRaw<FilaMovimiento[]>`
      SELECT TOP (${MAX_MOVIMIENTOS}) id_movimiento, fecha_movimiento, tipo_movimiento, id_factura, id_cobro,
             descripcion, cargo, abono, saldo_acumulado
      FROM dbo.vw_estado_cuenta_cliente
      WHERE id_cliente = ${id}
      ORDER BY id_movimiento DESC`,
    prisma.$queryRaw<{ saldo: unknown; cargos: unknown; abonos: unknown }[]>`
      SELECT saldo, cargos, abonos FROM dbo.vw_saldo_cliente WHERE id_cliente = ${id}`,
  ]);

  await registrarAuditoria({ usuarioId: sesion.usuarioId, accion: "LEER_ESTADO_CUENTA", detalle: `cliente ${id}` }, contextoRequest(req));

  const r = resumen[0];
  return respuestaOk({
    saldo: dinero(r?.saldo as number),
    cargos: dinero(r?.cargos as number),
    abonos: dinero(r?.abonos as number),
    movimientos: movimientos.map((m) => ({
      id_movimiento: Number(m.id_movimiento),
      fecha: m.fecha_movimiento,
      tipo: m.tipo_movimiento,
      id_factura: m.id_factura == null ? null : Number(m.id_factura),
      id_cobro: m.id_cobro == null ? null : Number(m.id_cobro),
      descripcion: m.descripcion,
      cargo: dinero(m.cargo as number),
      abono: dinero(m.abono as number),
      saldo: dinero(m.saldo_acumulado as number),
    })),
    hayMas: movimientos.length === MAX_MOVIMIENTOS,
  });
});
