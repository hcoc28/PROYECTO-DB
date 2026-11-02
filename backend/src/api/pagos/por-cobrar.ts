// ============================================================
// API — GET /api/v1/pagos/por-cobrar
// Facturas certificadas con saldo pendiente (cuentas por cobrar),
// de la más vieja a la más nueva. El saldo lo mantiene la base de datos.
// ============================================================

import { NextRequest } from "next/server";
import { prisma } from "../../base-de-datos/prisma";
import { aFacturaLista, incluirFacturaLista } from "../../base-de-datos/adaptadores";
import { sesionDesdeRequest } from "../../seguridad/auth";
import { manejarErrores, respuestaOk } from "../../comun/respuestas";

export const GET = manejarErrores(async (req: NextRequest) => {
  await sesionDesdeRequest(req);

  const [facturas, suma] = await Promise.all([
    prisma.factura.findMany({
      where: { estado: "CERTIFICADA", saldo_pendiente: { gt: 0 } },
      include: incluirFacturaLista,
      orderBy: { fecha_emision: "asc" }, // las más viejas primero: son las más urgentes
      take: 1000,
    }),
    prisma.factura.aggregate({ where: { estado: "CERTIFICADA", saldo_pendiente: { gt: 0 } }, _sum: { saldo_pendiente: true } }),
  ]);

  return respuestaOk({
    facturas: facturas.map(aFacturaLista),
    totalPorCobrar: Number(suma._sum.saldo_pendiente ?? 0).toFixed(2),
  });
});
