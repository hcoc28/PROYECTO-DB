// ============================================================
// LÓGICA DE NEGOCIO — cobros
// Un cobro es el recibo del dinero que entra; la base de datos lo
// aplica a la factura, actualiza su saldo y la cuenta del cliente.
// ============================================================

import { prisma } from "../base-de-datos/prisma";
import type { Tx } from "../base-de-datos/sql";

export const METODOS_COBRO = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "QR", "DEPOSITO", "CHEQUE"] as const;
export type MetodoCobro = (typeof METODOS_COBRO)[number];

export interface NuevoCobro {
  usuarioId: number;
  idFactura: number | bigint;
  metodo: MetodoCobro;
  monto: number;
  referencia?: string | null;
}

/** Registra un cobro aplicado a UNA factura. Acepta una transacción para agrupar varios pagos. */
export async function registrarCobro(c: NuevoCobro, tx: Tx | typeof prisma = prisma): Promise<number> {
  const [r] = await tx.$queryRaw<{ id_cobro: bigint }[]>`
    DECLARE @cobro BIGINT;
    EXEC dbo.usp_registrar_cobro
      @id_usuario = ${c.usuarioId}, @codigo_metodo = ${c.metodo}, @monto = ${c.monto.toFixed(2)},
      @id_factura = ${BigInt(c.idFactura)}, @referencia = ${c.referencia?.trim() || null},
      @id_cobro = @cobro OUTPUT;
    SELECT @cobro AS id_cobro;`;
  return Number(r.id_cobro);
}
