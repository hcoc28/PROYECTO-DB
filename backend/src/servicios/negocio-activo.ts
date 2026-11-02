// ============================================================
// Negocio con el que trabaja la aplicacion
// ------------------------------------------------------------
// La aplicacion maneja UN negocio: el primero que se creo (el de menor id). Antes se usaba findFirst() sin orden,
// y si en la base habia dos negocios el resultado podia cambiar. Las facturas ya emitidas siempre muestran
// el negocio con el que se emitieron (factura.id_negocio), no este.
// ============================================================

import { prisma } from "../base-de-datos/prisma";

export function negocioActivo() {
  return prisma.negocio.findFirst({ orderBy: { id_negocio: "asc" } });
}
