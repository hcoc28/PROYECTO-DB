// ============================================================
// LAYOUT RAÍZ
// Envuelve TODAS las páginas de la aplicación (una sola vez).
// Aquí se define el <html>, el <body> y el título/descripción
// que aparecen en la pestaña del navegador (metadata).
// ============================================================

import type { Metadata } from "next";
import "./globals.css";
import Avisos from "./_components/Avisos";

export const metadata: Metadata = {
  title: "SisEd",
  description: "Facturación electrónica FEL Guatemala — POS, pagos e inventario para pequeño negocio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-GT">
      <body>
        {children}
        <Avisos />
      </body>
    </html>
  );
}
