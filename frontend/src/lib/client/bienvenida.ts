"use client";

// ============================================================
// LIBRERÍA — saludo de bienvenida
// Al iniciar sesión se muestra un aviso con el saludo del momento
// del día y una frase corta. La frase se elige al azar en cada
// inicio de sesión (sin repetir la de la vez anterior).
// ============================================================

import { notificar } from "./avisos";

const FRASES = [
  "Cada venta cuenta una historia de confianza.",
  "Hoy es un buen día para vender bien.",
  "Los números en orden dan tranquilidad.",
  "Un cliente bien atendido siempre vuelve.",
  "Lo pequeño, hecho con cuidado, se vuelve grande.",
  "Paso a paso se llena la caja.",
  "La constancia vende más que la suerte.",
  "Factura clara, cuentas claras.",
  "Que el inventario cuadre y el café también.",
  "Tu negocio avanza con cada detalle que cuidas.",
  "Una sonrisa ya es medio trato cerrado.",
  "Orden hoy, tranquilidad mañana.",
  "Atender bien es la mejor publicidad.",
  "Cada cobro a tiempo es una preocupación menos.",
  "Lo que se mide, mejora.",
  "Se vende con calma y se cierra con ganas.",
  "Un buen servicio nunca pasa de moda.",
  "Los buenos negocios nacen de buenos hábitos.",
  "Un día a la vez, una factura a la vez.",
  "Que no falte stock ni buen humor.",
];

const CLAVE_ULTIMA = "ultimaFraseBienvenida";

export function saludoDelDia(): string {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

/** Elige una frase distinta a la del inicio de sesión anterior (se recuerda en este navegador). */
export function elegirFrase(): string {
  let ultima = -1;
  try {
    ultima = Number(localStorage.getItem(CLAVE_ULTIMA) ?? -1);
  } catch {
    // sin almacenamiento local: puede repetirse, no es grave
  }
  let i = Math.floor(Math.random() * FRASES.length);
  if (i === ultima) i = (i + 1 + Math.floor(Math.random() * (FRASES.length - 1))) % FRASES.length;
  try {
    localStorage.setItem(CLAVE_ULTIMA, String(i));
  } catch {
    // ignorar
  }
  return FRASES[i];
}

export function darBienvenida(nombreUsuario: string) {
  notificar.info(elegirFrase(), { titulo: `${saludoDelDia()}, ${nombreUsuario}`, duracion: 9000 });
}
