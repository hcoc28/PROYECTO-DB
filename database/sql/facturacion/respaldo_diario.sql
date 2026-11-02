/*
    RESPALDO DIARIO de proyecto_final
    Pensado para ejecutarse una vez al dia con una tarea programada de Windows (ver database/README.md).
    Guarda un archivo por dia de la semana (Monday, Tuesday...) y lo sobrescribe a la semana siguiente:
    siempre hay 7 respaldos, sin llenar el disco. Los archivos quedan en la carpeta de respaldos de SQL Server.
    Para restaurar:  RESTORE DATABASE proyecto_final FROM DISK = N'proyecto_final_Monday.bak' WITH REPLACE;
*/
SET NOCOUNT ON;
DECLARE @dia NVARCHAR(20) = DATENAME(WEEKDAY, GETDATE());
DECLARE @completo NVARCHAR(260) = N'proyecto_final_' + @dia + N'.bak';
DECLARE @log NVARCHAR(260) = N'proyecto_final_log_' + @dia + N'.trn';

BACKUP DATABASE proyecto_final TO DISK = @completo WITH INIT, CHECKSUM, COMPRESSION, NAME = N'proyecto_final diario';
BACKUP LOG proyecto_final TO DISK = @log WITH INIT, CHECKSUM, COMPRESSION;
RESTORE VERIFYONLY FROM DISK = @completo WITH CHECKSUM;   -- comprueba que el archivo se puede leer
GO
