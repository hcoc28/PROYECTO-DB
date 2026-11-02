// ============================================================
// Reintento automatico de facturas que quedaron esperando al certificador
// ------------------------------------------------------------
// Si el certificador no responde (internet, mantenimiento de la SAT, timeout), la factura queda en
// PENDIENTE_CERTIFICACION y la venta NO se pierde. Este proceso busca esas facturas en la vista
// vw_facturas_por_certificar y las vuelve a enviar.
// Idempotencia: cada factura se manda siempre con el mismo identificador (id_transaccion_fel),
// asi que un reintento despues de un timeout no crea una segunda factura.
// ============================================================

import { prisma } from "../base-de-datos/prisma";
import { certificarFactura } from "./facturacion";

const MINUTOS_ANTES_DE_REINTENTAR = 2; // dar tiempo a la primera respuesta
const HORAS_MAXIMAS = 24; // pasado este tiempo ya requiere revision manual

let enCurso = false; // evita dos reintentos al mismo tiempo en este servidor

export interface ResumenReintento {
  revisadas: number;
  certificadas: number;
  siguenPendientes: number;
}

export async function reintentarPendientes(): Promise<ResumenReintento> {
  const resumen: ResumenReintento = { revisadas: 0, certificadas: 0, siguenPendientes: 0 };
  if (enCurso) return resumen;
  enCurso = true;
  try {
    const pendientes = await prisma.$queryRaw<{ id_factura: bigint; id_usuario: number }[]>`
      SELECT id_factura, id_usuario
      FROM dbo.vw_facturas_por_certificar
      WHERE minutos_esperando >= ${MINUTOS_ANTES_DE_REINTENTAR}
        AND minutos_esperando <= ${HORAS_MAXIMAS * 60}
      ORDER BY enviada_en`;

    for (const f of pendientes) {
      resumen.revisadas++;
      try {
        const r = await certificarFactura(Number(f.id_factura), f.id_usuario);
        if (r.estado === "CERTIFICADA") resumen.certificadas++;
        else resumen.siguenPendientes++;
      } catch (err) {
        resumen.siguenPendientes++;
        console.error(`[FEL] No se pudo reintentar la factura ${f.id_factura}:`, err);
      }
    }
    return resumen;
  } finally {
    enCurso = false;
  }
}
