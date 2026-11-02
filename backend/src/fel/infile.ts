// ============================================================
// FEL — integración con Infile
// Implementación real: arma el XML, lo envía a Infile y
// traduce su respuesta al formato interno del sistema.
// ============================================================

import type { CertificadorFel, CredencialesCertificador } from "./certificador";
import type { DocumentoFel, ResultadoAnulacion, ResultadoCertificacion } from "./tipos";
import { construirXmlDte } from "./xml";

// ============================================================
// Integración con Infile (https://docs.feel.com.gt)
// Flujo v2: se envía el XML del DTE en base64 con las llaves de
// firma y API; Infile firma, certifica ante SAT y devuelve
// UUID + XML certificado.
//
// Nota: los endpoints/campos exactos deben confirmarse contra la
// documentación vigente del contrato con Infile; esta clase
// centraliza el mapeo para que un cambio del proveedor no toque
// el resto del sistema.
// ============================================================

const URL_CERTIFICACION = "https://certificador.feel.com.gt/fel/procesounificado/transaccion/v2/xml";
const URL_ANULACION = "https://certificador.feel.com.gt/fel/procesounificado/transaccion/v2/xml"; // mismo endpoint, XML de anulación

const TIMEOUT_MS = 30_000;

export class CertificadorInfile implements CertificadorFel {
  readonly nombre = "INFILE";

  async certificar(
    doc: DocumentoFel,
    cred: CredencialesCertificador
  ): Promise<ResultadoCertificacion> {
    const xml = construirXmlDte(doc);
    // Idempotencia: el identificador es el de la factura, NO cambia entre reintentos.
    // Si un intento da timeout y se vuelve a enviar, Infile reconoce el documento y no lo duplica.
    const identificador = doc.identificador;

    const respuesta = await this.post(cred.urlBase ?? URL_CERTIFICACION, cred, identificador, xml);

    if (!respuesta.resultado) {
      return {
        exito: false,
        errores: (respuesta.descripcion_errores ?? []).map(
          (e: { mensaje_error: string }) => e.mensaje_error
        ),
      };
    }

    return {
      exito: true,
      uuid: respuesta.uuid,
      serie: respuesta.serie,
      numero: String(respuesta.numero),
      fechaCertificacion: respuesta.fecha,
      xmlCertificado: respuesta.xml_certificado
        ? Buffer.from(respuesta.xml_certificado, "base64").toString("utf8")
        : undefined,
    };
  }

  async anular(
    uuid: string,
    nitEmisor: string,
    idReceptor: string,
    fechaEmision: string,
    motivo: string,
    cred: CredencialesCertificador
  ): Promise<ResultadoAnulacion> {
    const xmlAnulacion = `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTAnulacionDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.1.0" Version="0.1">
  <dte:SAT>
    <dte:AnulacionDTE ID="DatosCertificados">
      <dte:DatosGenerales ID="DatosAnulacion"
        NumeroDocumentoAAnular="${uuid}"
        NITEmisor="${nitEmisor}"
        IDReceptor="${idReceptor}"
        FechaEmisionDocumentoAnular="${fechaEmision}"
        FechaHoraAnulacion="${new Date().toISOString().slice(0, 19)}"
        MotivoAnulacion="${motivo.replace(/"/g, "&quot;")}"/>
    </dte:AnulacionDTE>
  </dte:SAT>
</dte:GTAnulacionDocumento>`;

    // Idempotencia: la anulacion de un UUID siempre usa el mismo identificador
    const identificador = `${nitEmisor}-ANUL-${uuid}`;
    const respuesta = await this.post(cred.urlBase ?? URL_ANULACION, cred, identificador, xmlAnulacion);

    if (!respuesta.resultado) {
      return {
        exito: false,
        errores: (respuesta.descripcion_errores ?? []).map(
          (e: { mensaje_error: string }) => e.mensaje_error
        ),
      };
    }
    return { exito: true, uuid: respuesta.uuid ?? identificador, fechaAnulacion: respuesta.fecha };
  }

  private async post(
    url: string,
    cred: CredencialesCertificador,
    identificador: string,
    xml: string
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/xml",
          usuario: cred.usuarioApi,
          llave: cred.llaveApi,
          identificador,
        },
        body: xml,
      });
      if (!res.ok) {
        throw new Error(`Infile respondió HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
