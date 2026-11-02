// ============================================================
// FEL — selector de certificador
// Decide qué certificador usar (Infile, G4S, Megaprint) según
// la configuración del negocio. Punto único de entrada.
// ============================================================

import type { DocumentoFel, ResultadoAnulacion, ResultadoCertificacion } from "./tipos";
import { CertificadorInfile } from "./infile";

// ============================================================
// Abstracción de certificadores FEL (patrón Strategy).
// Cada certificador (Infile, G4S, Megaprint) implementa la misma
// interfaz; el negocio elige el suyo en la tabla Negocio y el
// resto del sistema no cambia.
// ============================================================

export interface CredencialesCertificador {
  usuarioApi: string;
  llaveApi: string;   // ya descifrada (solo vive en memoria)
  llaveFirma: string; // ya descifrada
  urlBase?: string;
  ambiente: "CERTIFICACION" | "PRODUCCION";
}

export interface CertificadorFel {
  readonly nombre: string;

  /** Firma y certifica un DTE. Devuelve UUID + XML certificado. */
  certificar(doc: DocumentoFel, cred: CredencialesCertificador): Promise<ResultadoCertificacion>;

  /** Anula un DTE ya certificado ante SAT. */
  anular(
    uuid: string,
    nitEmisor: string,
    idReceptor: string,
    fechaEmision: string,
    motivo: string,
    cred: CredencialesCertificador
  ): Promise<ResultadoAnulacion>;
}

export function obtenerCertificador(nombre: string): CertificadorFel {
  switch (nombre) {
    case "INFILE":
      return new CertificadorInfile();
    // Alternativas: implementar con la misma interfaz cuando se contraten.
    // case "G4S":       return new CertificadorG4S();
    // case "MEGAPRINT": return new CertificadorMegaprint();
    default:
      throw new Error(`Certificador no soportado: ${nombre}`);
  }
}
