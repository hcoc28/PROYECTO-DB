// ============================================================
// LIBRERÍA — formato de dinero y fechas para las pantallas
// La API devuelve los montos como texto sin ceros finales ("8.5").
// Este helper los muestra siempre como dinero: "Q8.50", "Q1,250.00".
// ============================================================

export function quetzales(valor: string | number | null | undefined): string {
  const n = Number(valor ?? 0);
  if (Number.isNaN(n)) return "Q0.00";
  const signo = n < 0 ? "-" : "";
  const texto = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${signo}Q${texto}`;
}

/** Fecha local del navegador en formato YYYY-MM-DD (lo que usan los <input type="date">). */
export function fechaLocalISO(fecha: Date = new Date()): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ------------------------------------------------------------
// Monto en letras para los documentos: 110.5 → "CIENTO DIEZ QUETZALES CON 50/100"
// ------------------------------------------------------------

const BASE = [
  "", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ",
  "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE",
  "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function menorDeMil(n: number): string {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const resto = r < 30 ? BASE[r] : DECENAS[Math.floor(r / 10)] + (r % 10 ? ` Y ${BASE[r % 10]}` : "");
  return [CENTENAS[c], resto].filter(Boolean).join(" ");
}

// "uno" delante de un sustantivo se dice "un" (veintiún mil, treinta y un quetzales)
const apocope = (t: string) => t.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");

export function montoEnLetras(valor: string | number): string {
  const total = Math.round(Math.abs(Number(valor)) * 100);
  const entero = Math.floor(total / 100);
  const centavos = String(total % 100).padStart(2, "0");

  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${apocope(menorDeMil(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocope(menorDeMil(miles))} MIL`);
  if (resto) partes.push(apocope(menorDeMil(resto)));

  const letras = partes.length ? partes.join(" ") : "CERO";
  const moneda = entero === 1 ? "QUETZAL" : millones && !miles && !resto ? "DE QUETZALES" : "QUETZALES";
  return `${letras} ${moneda} CON ${centavos}/100`;
}
