import path from "node:path";
import type { NextConfig } from "next";

// El backend vive en la carpeta hermana "backend/" y el frontend lo importa
// con el alias @backend. Para que Next.js pueda compilar archivos fuera de
// "frontend/", su raíz de trabajo es la carpeta que contiene a las dos.
const raizDelProyecto = path.resolve(__dirname, "..");

const esProduccion = process.env.NODE_ENV === "production";

// Content-Security-Policy: le dice al navegador de dónde puede cargar cada cosa.
// Lo que no esté en la lista se bloquea (si alguien lograra inyectar un script de otro sitio, no correría).
// 'unsafe-inline' hace falta porque Next.js incluye pequeños scripts dentro de la página;
// 'unsafe-eval' y ws: solo se permiten en desarrollo (recarga en caliente).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${esProduccion ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${esProduccion ? "" : " ws: wss:"}`,
  "object-src 'none'",         // sin plugins
  "base-uri 'self'",           // nadie puede cambiar la base de las URL
  "form-action 'self'",        // los formularios solo se envian a este sitio
  "frame-ancestors 'none'",    // nadie puede incrustar esta pagina en otra (clickjacking)
].join("; ");

const nextConfig: NextConfig = {
  turbopack: { root: raizDelProyecto },
  outputFileTracingRoot: raizDelProyecto,
  // Imagen Docker mínima (ver Dockerfile)
  output: "standalone",
  // No decir con que tecnologia esta hecho el sitio (cabecera X-Powered-By)
  poweredByHeader: false,
  // Permite abrir la app en desarrollo desde otro equipo de la red local
  // (celular, tablet, otra PC) usando la IP de esta computadora.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.ngrok-free.dev"],
  // Cabeceras de seguridad globales (ver docs/seguridad.md)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
