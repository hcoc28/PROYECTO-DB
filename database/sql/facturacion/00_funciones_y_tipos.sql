/*
    FUNCIONES pequenas que usan las tablas (valores por defecto), las vistas y los triggers
    Requiere haber ejecutado: nada (va primero)
    Parte de la base de facturacion y cobros (ver instalar.sql para el orden completo).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================================================
   Utilidades
   ============================================================ */

/* Todas las fechas y horas se guardan en UTC (DATETIMEOFFSET con desfase 0): es un instante sin
   ambiguedad y es lo que leen bien Prisma y el resto de herramientas. La hora de Guatemala
   (UTC-6, sin horario de verano) se calcula solo al AGRUPAR por dia: fn_dia_gt() y fn_hoy_gt(). */
CREATE OR ALTER FUNCTION dbo.fn_ahora_utc() RETURNS DATETIMEOFFSET(0)
AS
BEGIN
    RETURN CONVERT(DATETIMEOFFSET(0), TODATETIMEOFFSET(SYSUTCDATETIME(), 0));
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_dia_gt(@instante DATETIMEOFFSET(0)) RETURNS DATE
AS
BEGIN
    RETURN CONVERT(DATE, @instante AT TIME ZONE 'Central America Standard Time');
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_hoy_gt() RETURNS DATE
AS
BEGIN
    RETURN CONVERT(DATE, SYSDATETIMEOFFSET() AT TIME ZONE 'Central America Standard Time');
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_usuario_actual() RETURNS INT
AS
BEGIN
    RETURN TRY_CONVERT(INT, SESSION_CONTEXT(N'id_usuario'));
END;
GO
