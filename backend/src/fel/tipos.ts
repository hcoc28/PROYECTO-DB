// ============================================================
// Tipos compartidos del módulo FEL
// Restringido a lo que la tabla `serie` realmente soporta:
// tipo_documento IN ('FACT','NCRE').
// ============================================================

export type TipoDte = "FACT" | "NCRE";

export type EstadoFel = "PENDIENTE" | "CERTIFICADA" | "RECHAZADA" | "ANULADA";

export interface EmisorFel {
  nit: string;
  nombreComercial: string;
  razonSocial: string;
  direccion: string;
  municipio: string;
  departamento: string;
  regimen: string; // GEN | PEQ
}

export interface ReceptorFel {
  /** NIT sin guiones, o "CF" para consumidor final */
  idReceptor: string;
  nombre: string;
  direccion?: string;
  correo?: string;
}

export interface ItemFel {
  linea: number;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  precio: string; // cantidad * precioUnitario
  descuento: string;
  montoGravable: string;
  montoImpuesto: string;
  total: string;
}

export interface DocumentoFel {
  /** Identificador unico de la transaccion: siempre el MISMO para la misma factura (idempotencia) */
  identificador: string;
  tipoDte: TipoDte;
  fechaEmision: string; // ISO 8601 con zona -06:00
  moneda: string;
  emisor: EmisorFel;
  receptor: ReceptorFel;
  items: ItemFel[];
  totales: {
    granTotal: string;
    totalImpuestos: string;
  };
}

export interface ResultadoCertificacion {
  exito: boolean;
  uuid?: string;
  serie?: string;
  numero?: string;
  fechaCertificacion?: string;
  xmlCertificado?: string; // XML con sello SAT (resguardo obligatorio)
  urlXml?: string; // donde el certificador (o nosotros) guardo el XML
  urlPdf?: string; // donde esta el PDF
  errores?: string[];
}

export interface ResultadoAnulacion {
  exito: boolean;
  uuid?: string; // identificador del evento de anulación que entrega el certificador
  fechaAnulacion?: string;
  errores?: string[];
}
