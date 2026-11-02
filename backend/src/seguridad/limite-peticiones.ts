// ============================================================
// SEGURIDAD — protecciones que se aplican ANTES de cualquier ruta /api/*
//   1. Defensa contra CSRF: una página de otro sitio no puede hacer que tu
//      navegador (con tu sesión abierta) cambie datos en este sistema.
//   2. Límite de peticiones (rate limit): bloquea a quien haga demasiadas
//      peticiones seguidas.
//        - Login: 10 por minuto (dificulta adivinar contraseñas)
//        - Resto de la API: 300 por minuto por sesión iniciada
//      Quien no ha iniciado sesión se agrupa por IP. La IP solo se toma de la
//      cabecera X-Forwarded-For si el servidor esta detras de un proxy de
//      confianza (TRUST_PROXY=1), porque cualquiera puede falsificar esa cabecera.
// Los contadores viven en memoria: se reinician cuando se reinicia el servidor.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { ipConfiable, tokenDeLaPeticion } from "./cliente";

const ventanas = new Map<string, { inicio: number; conteo: number }>();
const VENTANA_MS = 60_000;
const LIMITE_LOGIN = 10;
const LIMITE_SESION = 300; // por sesion iniciada
const LIMITE_ANONIMO = 60; // sin sesion (por IP)
const MAX_CONTADORES = 5_000; // para que la memoria no crezca sin fin

const METODOS_SEGUROS = ["GET", "HEAD", "OPTIONS"];

function rechazo(status: number, codigo: string, mensaje: string, cabeceras?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: { codigo, mensaje } }, { status, headers: cabeceras });
}

/**
 * CSRF: las peticiones que cambian datos (POST, PUT, DELETE...) deben venir de ESTE mismo sitio.
 * El navegador siempre indica el origen de la peticion en la cabecera Origin.
 * Los clientes de API que usan "Authorization: Bearer" (sin cookie) no son afectados.
 */
function origenValido(req: NextRequest): boolean {
  if (METODOS_SEGUROS.includes(req.method)) return true;
  if (req.headers.get("authorization")?.startsWith("Bearer ")) return true;

  // X-Forwarded-Host solo se cree si hay un proxy de confianza que la escribe; si no, cualquiera la puede falsificar
  const host = (process.env.TRUST_PROXY === "1" ? req.headers.get("x-forwarded-host") : null) ?? req.headers.get("host");
  const origen = req.headers.get("origin");

  if (origen) {
    try {
      return new URL(origen).host === host;
    } catch {
      return false;
    }
  }
  // Sin Origin: se acepta solo si el navegador asegura que viene del mismo sitio (o de una barra de direcciones)
  const sitio = req.headers.get("sec-fetch-site");
  return sitio === null || sitio === "same-origin" || sitio === "none";
}

function limpiarVencidos(ahora: number) {
  if (ventanas.size < MAX_CONTADORES) return;
  for (const [clave, v] of ventanas) {
    if (ahora - v.inicio > VENTANA_MS) ventanas.delete(clave);
  }
}

export function limitarPeticiones(req: NextRequest): NextResponse {
  if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();

  // Las respuestas de la API llevan datos personales y de dinero: ningun navegador ni proxy debe guardarlas
  const respuestaPermitida = () => {
    const r = NextResponse.next();
    r.headers.set("Cache-Control", "no-store");
    return r;
  };

  if (!origenValido(req)) {
    return rechazo(403, "ORIGEN_NO_PERMITIDO", "La petición no viene de este sitio");
  }

  const esLogin = req.nextUrl.pathname.includes("/auth/login");
  const token = tokenDeLaPeticion(req);

  // Quien identifica a quien: el login se cuenta por IP; el resto, por sesion si la hay
  let clave: string;
  let limite: number;
  if (esLogin) {
    clave = `login:${ipConfiable(req) ?? "directo"}`;
    limite = LIMITE_LOGIN;
  } else if (token) {
    clave = `sesion:${token.slice(-24)}`;
    limite = LIMITE_SESION;
  } else {
    clave = `anonimo:${ipConfiable(req) ?? "directo"}`;
    limite = LIMITE_ANONIMO;
  }

  const ahora = Date.now();
  limpiarVencidos(ahora);
  const v = ventanas.get(clave);
  if (!v || ahora - v.inicio > VENTANA_MS) {
    ventanas.set(clave, { inicio: ahora, conteo: 1 });
  } else {
    v.conteo++;
    if (v.conteo > limite) {
      return rechazo(429, "RATE_LIMIT", "Demasiadas peticiones, intente en un minuto", { "Retry-After": "60" });
    }
  }
  return respuestaPermitida();
}
