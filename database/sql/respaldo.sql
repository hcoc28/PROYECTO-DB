/*
    RESPALDO (copia de seguridad) de la base de datos proyecto_final.

    Una copia de seguridad es lo que te salva si se daña el disco, borran datos por error
    o hay un ataque. Las copias guardan datos reales de clientes y facturas:
      - guardalas FUERA del servidor (otro disco, otra computadora o la nube),
      - nunca las subas a git (los archivos .bak ya estan en .gitignore).

    Como usarlo: cambia la carpeta de abajo (debe existir y SQL Server debe poder escribir en ella)
    y ejecuta el script. Para hacerlo automatico, programalo con el Agente de SQL Server
    o con el Programador de tareas de Windows.
*/

-- 1) Crear la copia (con compresion y verificacion de integridad)
BACKUP DATABASE proyecto_final
TO DISK = N'C:\respaldos\proyecto_final.bak'      -- <-- cambia esta ruta
WITH INIT, COMPRESSION, CHECKSUM, STATS = 10;
GO

-- 2) Comprobar que la copia se puede leer (no restaura nada, solo la revisa)
RESTORE VERIFYONLY
FROM DISK = N'C:\respaldos\proyecto_final.bak'    -- <-- misma ruta
WITH CHECKSUM;
GO

/*
    Para RESTAURAR (solo si hace falta; reemplaza la base actual):

    USE master;
    ALTER DATABASE proyecto_final SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    RESTORE DATABASE proyecto_final FROM DISK = N'C:\respaldos\proyecto_final.bak' WITH REPLACE;
    ALTER DATABASE proyecto_final SET MULTI_USER;
*/
