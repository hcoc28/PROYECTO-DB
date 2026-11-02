/*
    AUDITORIA NATIVA DE SQL SERVER (SERVER AUDIT)    -- OPCIONAL, NO esta en instalar.sql
    ------------------------------------------------------------------------------------
    La bitacora de la aplicacion solo registra lo que pasa POR la aplicacion. Esta auditoria la
    hace el propio motor: anota quien lee o cambia las tablas sensibles aunque entre directo
    con SSMS u otra herramienta, y nadie puede apagarla sin quedar registrado.

    Por que no se instalo automaticamente: crea objetos a nivel de SERVIDOR (no solo de proyecto_final),
    escribe archivos en disco y requiere permisos de administrador (sysadmin).

    Antes de ejecutar:
      1. Cambia la carpeta C:\auditoria_sql\ por una que exista y donde SQL Server pueda escribir.
      2. Ejecuta la PRIMERA parte conectado a master y la SEGUNDA conectado a proyecto_final.
*/

------------------------------------------------------------------------------------
-- PARTE 1 (usar master)
------------------------------------------------------------------------------------
USE master;
GO

CREATE SERVER AUDIT auditoria_proyecto_final
TO FILE (FILEPATH = N'C:\auditoria_sql\', MAXSIZE = 50 MB, MAX_ROLLOVER_FILES = 20)
WITH (ON_FAILURE = CONTINUE);
GO

ALTER SERVER AUDIT auditoria_proyecto_final WITH (STATE = ON);
GO

-- Intentos de inicio de sesion fallidos y exitosos en todo el servidor
CREATE SERVER AUDIT SPECIFICATION auditoria_logins
FOR SERVER AUDIT auditoria_proyecto_final
    ADD (FAILED_LOGIN_GROUP),
    ADD (SUCCESSFUL_LOGIN_GROUP)
WITH (STATE = ON);
GO

------------------------------------------------------------------------------------
-- PARTE 2 (usar proyecto_final)
------------------------------------------------------------------------------------
USE proyecto_final;
GO

-- Quien lee o modifica las tablas sensibles, y cualquier cambio de permisos
CREATE DATABASE AUDIT SPECIFICATION auditoria_tablas_sensibles
FOR SERVER AUDIT auditoria_proyecto_final
    ADD (SELECT, INSERT, UPDATE, DELETE ON dbo.usuario  BY public),
    ADD (SELECT, INSERT, UPDATE, DELETE ON dbo.cliente  BY public),
    ADD (SELECT, INSERT, UPDATE, DELETE ON dbo.negocio  BY public),
    ADD (UPDATE, DELETE ON dbo.bitacora BY public),
    ADD (DATABASE_ROLE_MEMBER_CHANGE_GROUP),
    ADD (DATABASE_PERMISSION_CHANGE_GROUP),
    ADD (SCHEMA_OBJECT_PERMISSION_CHANGE_GROUP)
WITH (STATE = ON);
GO

/* Para consultar lo que se audito:

    SELECT event_time, action_id, server_principal_name, database_name, object_name, statement
    FROM sys.fn_get_audit_file(N'C:\auditoria_sql\*.sqlaudit', DEFAULT, DEFAULT)
    ORDER BY event_time DESC;
*/
