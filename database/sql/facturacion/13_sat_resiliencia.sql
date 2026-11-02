/*
    REQUISITOS SAT Y RESILIENCIA DEL CERTIFICADOR
    Requiere haber ejecutado: 01 (tablas). Debe ir ANTES de 04 (procedimientos). Se puede ejecutar mas de una vez.

    Que agrega:
      1. id_transaccion_fel: un identificador UNICO por factura que se manda al certificador.
         Si un intento falla por timeout y se reintenta, el certificador ve el MISMO identificador y no
         crea una segunda factura (idempotencia).
      2. url_xml y url_pdf: donde se guardan los archivos del DTE (el XML legal y el PDF).
      3. Validaciones: el UUID de la SAT tiene 36 caracteres; el NIT, el CUI y el pasaporte tienen formato valido.
      4. vw_facturas_por_certificar: las facturas que quedaron esperando al certificador (para reintentarlas).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================================================
   1 y 2. Columnas nuevas de factura
   ============================================================ */

IF COL_LENGTH('dbo.factura', 'id_transaccion_fel') IS NULL
    ALTER TABLE dbo.factura
        ADD id_transaccion_fel UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT df_factura_transaccion_fel DEFAULT (NEWID());
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_factura_transaccion_fel')
    CREATE UNIQUE INDEX ux_factura_transaccion_fel ON dbo.factura(id_transaccion_fel);
GO

IF COL_LENGTH('dbo.factura', 'url_xml') IS NULL
    ALTER TABLE dbo.factura ADD url_xml NVARCHAR(500) NULL;   -- ruta o URL del XML certificado (el documento legal)
IF COL_LENGTH('dbo.factura', 'url_pdf') IS NULL
    ALTER TABLE dbo.factura ADD url_pdf NVARCHAR(500) NULL;   -- ruta o URL del PDF (representacion grafica)
GO


/* ============================================================
   3. Validaciones de formato
   ============================================================ */

-- El UUID (numero de autorizacion) de la SAT tiene 36 caracteres.
-- Los documentos del certificador simulado (serie 'SIM') se exceptuan para poder reconocerlos.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_factura_uuid_largo')
    ALTER TABLE dbo.factura WITH CHECK
        ADD CONSTRAINT ck_factura_uuid_largo CHECK (
            serie_fel = 'SIM'
            OR ((uuid_fel IS NULL OR LEN(uuid_fel) = 36)
                AND (uuid_anulacion IS NULL OR LEN(uuid_anulacion) = 36)));
GO

-- Formato del documento del cliente (se guarda como texto, ya que el NIT puede llevar guion o la letra K):
--   CUI:       exactamente 13 digitos
--   NIT:       digitos y, al final, un digito o la letra K (por ejemplo 4587123-6 o 9988776-K)
--   PASAPORTE: de 5 a 20 letras o numeros
--   CF y OTRO: sin formato especial
-- Se revisa documento_norm (el documento sin guiones ni espacios y en mayuscula).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_cliente_formato_documento')
    ALTER TABLE dbo.cliente WITH CHECK
        ADD CONSTRAINT ck_cliente_formato_documento CHECK (
            tipo_documento IN ('CF', 'OTRO')
            OR (tipo_documento = 'CUI'
                AND LEN(documento_norm) = 13
                AND documento_norm NOT LIKE '%[^0-9]%')
            OR (tipo_documento = 'NIT'
                AND LEN(documento_norm) BETWEEN 2 AND 13
                AND LEFT(documento_norm, LEN(documento_norm) - 1) NOT LIKE '%[^0-9]%'
                AND RIGHT(documento_norm, 1) LIKE '[0-9K]')
            OR (tipo_documento = 'PASAPORTE'
                AND LEN(documento_norm) BETWEEN 5 AND 20
                AND documento_norm NOT LIKE '%[^A-Z0-9]%'));
GO


/* ============================================================
   4. Facturas esperando al certificador
   ============================================================
   Una factura queda en PENDIENTE_CERTIFICACION si el certificador no respondio (caida de internet,
   mantenimiento de la SAT, timeout). El proceso de reintento automatico de la aplicacion lee esta vista
   y las vuelve a enviar con el MISMO id_transaccion_fel. */

CREATE OR ALTER VIEW dbo.vw_facturas_por_certificar
AS
SELECT f.id_factura,
       f.id_negocio,
       f.id_usuario,
       f.id_transaccion_fel,
       e.enviada_en,
       DATEDIFF(MINUTE, e.enviada_en, SYSDATETIMEOFFSET()) AS minutos_esperando,
       (SELECT COUNT(*)
        FROM dbo.factura_fel x
        WHERE x.id_factura = f.id_factura AND x.tipo_evento = 'CERTIFICACION') AS intentos_registrados
FROM dbo.factura f
CROSS APPLY (SELECT MAX(h.fecha) AS enviada_en
             FROM dbo.historial_estado_factura h
             WHERE h.id_factura = f.id_factura
               AND h.estado_nuevo = 'PENDIENTE_CERTIFICACION') e
WHERE f.estado = 'PENDIENTE_CERTIFICACION';
GO
