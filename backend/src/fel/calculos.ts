// ============================================================
// FEL — cálculo de IVA
// Calcula el IVA de cada línea y los totales de la factura,
// siempre con Decimal (nunca con float) para no perder centavos.
// ============================================================

import Decimal from "decimal.js";

// ============================================================
// Cálculos tributarios FEL Guatemala
// - IVA 12% (régimen general): el precio de venta YA incluye IVA.
//   base = total / 1.12 ; iva = total - base
// - Pequeño contribuyente (FPEQ): 5% sobre ingresos, sin IVA
//   desglosado en el DTE.
// - Todo con Decimal: NUNCA aritmética float para dinero.
// ============================================================

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const TASA_IVA = new Decimal("0.12");

export interface LineaCalculada {
  cantidad: string;
  precioUnitario: string;
  descuento: string;
  tipoIva: "GRAVADO" | "EXENTO";
  montoGravable: string; // base sin IVA (0 si exento)
  montoIva: string;
  montoExento: string;
  total: string; // lo que paga el cliente por la línea
}

export interface EntradaLinea {
  cantidad: number | string;
  precioUnitario: number | string; // precio CON IVA incluido (práctica GT)
  descuento?: number | string;
  tipoIva?: "GRAVADO" | "EXENTO";
}

export function calcularLinea(linea: EntradaLinea): LineaCalculada {
  const cantidad = new Decimal(linea.cantidad);
  const precio = new Decimal(linea.precioUnitario);
  const descuento = new Decimal(linea.descuento ?? 0);
  const tipoIva = linea.tipoIva ?? "GRAVADO";

  if (cantidad.lte(0)) throw new Error("La cantidad debe ser mayor que cero");
  if (precio.lt(0) || descuento.lt(0)) throw new Error("Montos negativos no permitidos");

  const total = cantidad.mul(precio).minus(descuento);
  if (total.lt(0)) throw new Error("El descuento no puede exceder el total de la línea");

  if (tipoIva === "EXENTO") {
    return {
      cantidad: cantidad.toFixed(4),
      precioUnitario: precio.toFixed(6),
      descuento: descuento.toFixed(2),
      tipoIva,
      montoGravable: "0.00",
      montoIva: "0.00",
      montoExento: total.toFixed(2),
      total: total.toFixed(2),
    };
  }

  // Precio incluye IVA: extraer la base
  const base = total.div(TASA_IVA.plus(1));
  const iva = total.minus(base);

  return {
    cantidad: cantidad.toFixed(4),
    precioUnitario: precio.toFixed(6),
    descuento: descuento.toFixed(2),
    tipoIva,
    montoGravable: base.toFixed(2),
    montoIva: iva.toFixed(2),
    montoExento: "0.00",
    total: total.toFixed(2),
  };
}
