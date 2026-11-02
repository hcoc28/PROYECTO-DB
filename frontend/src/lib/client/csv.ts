// Descarga de archivos CSV (se abren bien en Excel: UTF-8 con BOM).
// Un texto que empieza con = + - @ se tomaria como formula al abrirlo en Excel
// (un cliente llamado "=HYPERLINK(...)" ejecutaria algo); se le antepone un apostrofo.
// Los numeros se dejan tal cual para que conserven el signo negativo.

import { notificar } from "./avisos";

function celda(valor: string | number | null | undefined): string {
  if (typeof valor === "number") return String(valor);
  let texto = String(valor ?? "");
  if (/^[=+\-@\t\r]/.test(texto) && !/^-?\d+(\.\d+)?$/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

export function descargarCsv(nombreArchivo: string, filas: (string | number | null | undefined)[][]) {
  const csv = filas.map((fila) => fila.map(celda).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
  const registros = Math.max(0, filas.length - 1); // la primera fila son los encabezados
  notificar.ok(nombreArchivo, { titulo: `Archivo descargado · ${registros} registro(s)` });
}
