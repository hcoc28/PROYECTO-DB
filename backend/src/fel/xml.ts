// ============================================================
// FEL — generador de XML
// Construye el XML del documento (GTDocumento) que exige la
// SAT, a partir de los datos de la factura.
// ============================================================

import type { DocumentoFel } from "./tipos";

// ============================================================
// Generación del XML GTDocumento (esquema SAT FEL v0.1)
// Referencia: "Reglas y validaciones FEL" de SAT.
// El XML se firma electrónicamente a través del certificador.
// Nota: el negocio se maneja como un solo establecimiento
// (la base de datos no tiene tabla de sucursales), por eso
// CodigoEstablecimiento va fijo en "1".
// ============================================================

const CODIGO_ESTABLECIMIENTO = 1;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function construirXmlDte(doc: DocumentoFel): string {
  const { emisor, receptor, items, totales } = doc;
  const esPequeno = emisor.regimen === "PEQ";

  const itemsXml = items
    .map(
      (it) => `
      <dte:Item BienOServicio="B" NumeroLinea="${it.linea}">
        <dte:Cantidad>${it.cantidad}</dte:Cantidad>
        <dte:UnidadMedida>UND</dte:UnidadMedida>
        <dte:Descripcion>${esc(it.descripcion)}</dte:Descripcion>
        <dte:PrecioUnitario>${it.precioUnitario}</dte:PrecioUnitario>
        <dte:Precio>${it.precio}</dte:Precio>
        <dte:Descuento>${it.descuento}</dte:Descuento>
        <dte:Impuestos>
          <dte:Impuesto>
            <dte:NombreCorto>IVA</dte:NombreCorto>
            <dte:CodigoUnidadGravable>${esPequeno ? 2 : 1}</dte:CodigoUnidadGravable>
            <dte:MontoGravable>${it.montoGravable}</dte:MontoGravable>
            <dte:MontoImpuesto>${it.montoImpuesto}</dte:MontoImpuesto>
          </dte:Impuesto>
        </dte:Impuestos>
        <dte:Total>${it.total}</dte:Total>
      </dte:Item>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" Version="0.1">
  <dte:SAT ClaseDocumento="dte">
    <dte:DTE ID="DatosCertificados">
      <dte:DatosEmision ID="DatosEmision">
        <dte:DatosGenerales Tipo="${doc.tipoDte}" FechaHoraEmision="${doc.fechaEmision}" CodigoMoneda="${doc.moneda}"/>
        <dte:Emisor NITEmisor="${esc(emisor.nit)}"
          NombreEmisor="${esc(emisor.razonSocial)}"
          CodigoEstablecimiento="${CODIGO_ESTABLECIMIENTO}"
          NombreComercial="${esc(emisor.nombreComercial)}"
          AfiliacionIVA="${emisor.regimen}">
          <dte:DireccionEmisor>
            <dte:Direccion>${esc(emisor.direccion)}</dte:Direccion>
            <dte:CodigoPostal>01001</dte:CodigoPostal>
            <dte:Municipio>${esc(emisor.municipio)}</dte:Municipio>
            <dte:Departamento>${esc(emisor.departamento)}</dte:Departamento>
            <dte:Pais>GT</dte:Pais>
          </dte:DireccionEmisor>
        </dte:Emisor>
        <dte:Receptor IDReceptor="${esc(receptor.idReceptor)}" NombreReceptor="${esc(receptor.nombre)}">
          <dte:DireccionReceptor>
            <dte:Direccion>${esc(receptor.direccion ?? "Ciudad")}</dte:Direccion>
            <dte:CodigoPostal>01001</dte:CodigoPostal>
            <dte:Municipio>Guatemala</dte:Municipio>
            <dte:Departamento>Guatemala</dte:Departamento>
            <dte:Pais>GT</dte:Pais>
          </dte:DireccionReceptor>
        </dte:Receptor>
        <dte:Items>${itemsXml}
        </dte:Items>
        <dte:Totales>
          <dte:TotalImpuestos>
            <dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${totales.totalImpuestos}"/>
          </dte:TotalImpuestos>
          <dte:GranTotal>${totales.granTotal}</dte:GranTotal>
        </dte:Totales>
      </dte:DatosEmision>
    </dte:DTE>
  </dte:SAT>
</dte:GTDocumento>`;
}
