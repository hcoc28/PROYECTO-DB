/*
    CERTIFICADOR SIMULADO (solo para desarrollo y pruebas). NO instalar en produccion.
    Requiere haber ejecutado: 04, 05

    Mientras no haya un certificador real (Infile, etc.), estos procedimientos hacen de cuenta
    que SAT certifico o anulo el documento: inventan el UUID y el numero y los guardan igual
    que lo haria el certificador de verdad.
      - Los documentos simulados llevan serie_fel = 'SIM', asi siempre se reconocen.
      - NO tienen validez fiscal.
      - Se niegan a funcionar si el negocio esta en ambiente PRODUCCION.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- "Certifica" una factura de mentira
CREATE OR ALTER PROCEDURE dbo.usp_certificar_simulado
    @id_factura BIGINT,
    @id_usuario INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @numero BIGINT;
    DECLARE @uuid NVARCHAR(80);
    DECLARE @fecha DATETIMEOFFSET(0);
    DECLARE @respuesta XML;

    IF NOT EXISTS (SELECT 1 FROM dbo.factura WHERE id_factura = @id_factura)
        THROW 51130, 'Factura inexistente.', 1;

    -- Seguridad: nunca se simula en produccion
    IF EXISTS (SELECT 1
               FROM dbo.factura f
               JOIN dbo.negocio n ON n.id_negocio = f.id_negocio
               WHERE f.id_factura = @id_factura
                 AND n.ambiente_fel = 'PRODUCCION')
        THROW 51131, 'El certificador simulado esta deshabilitado en PRODUCCION.', 1;

    BEGIN TRANSACTION;

    -- Numero simulado = el mayor numero 'SIM' que ya se uso + 1
    SELECT @numero = ISNULL(MAX(CONVERT(BIGINT, numero_fel)), 0) + 1
    FROM dbo.factura WITH (UPDLOCK)
    WHERE serie_fel = 'SIM';

    SET @uuid = 'SIM-' + CONVERT(NVARCHAR(36), NEWID());
    SET @fecha = dbo.fn_ahora_utc();
    SET @respuesta = CONVERT(XML, N'<respuesta simulada="true"/>');

    EXEC dbo.usp_registrar_certificacion
        @id_factura = @id_factura,
        @id_usuario = @id_usuario,
        @uuid_fel = @uuid,
        @serie_fel = 'SIM',
        @numero_fel = @numero,
        @fecha_certificacion = @fecha,
        @xml_respuesta = @respuesta;

    COMMIT TRANSACTION;
END;
GO

-- "Anula ante SAT" una factura de mentira
CREATE OR ALTER PROCEDURE dbo.usp_anular_simulado
    @id_factura BIGINT,
    @id_usuario INT,
    @motivo NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @uuid NVARCHAR(80);
    DECLARE @fecha DATETIMEOFFSET(0);

    IF EXISTS (SELECT 1
               FROM dbo.factura f
               JOIN dbo.negocio n ON n.id_negocio = f.id_negocio
               WHERE f.id_factura = @id_factura
                 AND n.ambiente_fel = 'PRODUCCION')
        THROW 51131, 'El certificador simulado esta deshabilitado en PRODUCCION.', 1;

    SET @uuid = 'SIM-ANUL-' + CONVERT(NVARCHAR(36), NEWID());
    SET @fecha = dbo.fn_ahora_utc();

    EXEC dbo.usp_anular_factura
        @id_factura = @id_factura,
        @id_usuario = @id_usuario,
        @motivo = @motivo,
        @uuid_anulacion = @uuid,
        @fecha_anulacion_fel = @fecha;
END;
GO
