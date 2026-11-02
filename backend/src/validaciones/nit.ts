// ============================================================
// Validación de NIT y CUI (Guatemala)
// ============================================================

/**
 * Valida un NIT guatemalteco con su dígito verificador (módulo 11).
 * Acepta formatos "1234567-8", "12345678" y el especial "CF".
 */
export function validarNit(nitRaw: string): boolean {
  const nit = nitRaw.trim().toUpperCase().replace(/-/g, "");
  if (nit === "CF") return true; // consumidor final

  if (!/^\d+[0-9K]$/.test(nit) || nit.length < 2 || nit.length > 12) return false;

  const cuerpo = nit.slice(0, -1);
  const verificador = nit.slice(-1);

  // Módulo 11: cada dígito se multiplica por su posición (desde 2, de derecha a izquierda)
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * factor;
    factor++;
  }
  const resto = suma % 11;
  const esperado = (11 - resto) % 11;
  const digitoEsperado = esperado === 10 ? "K" : String(esperado);

  return verificador === digitoEsperado;
}

/**
 * Normaliza un NIT para almacenar/enviar a FEL: sin guiones, mayúsculas.
 */
export function normalizarNit(nitRaw: string): string {
  return nitRaw.trim().toUpperCase().replace(/-/g, "");
}

/**
 * Valida un CUI guatemalteco (13 dígitos):
 * 8 del correlativo + 1 verificador + 2 depto + 2 municipio,
 * con verificación módulo 11 y rangos de departamento/municipio.
 */
const MUNICIPIOS_POR_DEPTO = [
  17, 8, 16, 16, 13, 14, 19, 8, 24, 21, 9, 30, 32, 21, 8, 17, 14, 5, 11, 11, 7, 17,
];

export function validarCui(cuiRaw: string): boolean {
  const cui = cuiRaw.trim().replace(/\s|-/g, "");
  if (!/^\d{13}$/.test(cui)) return false;

  const numero = cui.substring(0, 8);
  const verificador = parseInt(cui.substring(8, 9), 10);
  const depto = parseInt(cui.substring(9, 11), 10);
  const municipio = parseInt(cui.substring(11, 13), 10);

  if (depto < 1 || depto > MUNICIPIOS_POR_DEPTO.length) return false;
  if (municipio < 1 || municipio > MUNICIPIOS_POR_DEPTO[depto - 1]) return false;

  let suma = 0;
  for (let i = 0; i < numero.length; i++) {
    suma += parseInt(numero[i], 10) * (i + 2);
  }
  return suma % 11 === verificador;
}

export type DocumentoCliente = { tipo: "CF" | "NIT" | "CUI"; documento: string };

/**
 * Decide si lo escrito es CF, un NIT o un CUI (DPI) y lo valida. Un número de 13 dígitos es un CUI
 * (un NIT tiene como máximo 12 caracteres). Devuelve null si no es válido.
 */
export function clasificarDocumento(raw: string): DocumentoCliente | null {
  const documento = normalizarNit(raw).replace(/\s/g, "");
  if (documento === "CF") return { tipo: "CF", documento };
  if (/^\d{13}$/.test(documento)) return validarCui(documento) ? { tipo: "CUI", documento } : null;
  return validarNit(documento) ? { tipo: "NIT", documento } : null;
}
