/*
    SEGURIDAD EN LA BASE DE DATOS
    Requiere haber ejecutado: 01 (tablas), 05 (triggers) y 07 (permisos).
    Se puede ejecutar mas de una vez.

    Que contiene:
      1. La contrasena solo puede guardarse como hash (CHECK)
      2. La bitacora acepta intentos de login de usuarios que NO existen
      3. Procedimientos de login: registrar intentos y saber si una cuenta esta bloqueada
      4. Alertas automaticas (trigger): fuerza bruta y exceso de anulaciones
      5. Enmascarado de datos del cliente (Dynamic Data Masking)
      6. Seguridad por fila (Row-Level Security): un cajero solo ve lo que el creo
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================================================
   1. La contrasena solo se guarda como hash
   ============================================================
   Aunque la aplicacion falle o alguien inserte a mano, el texto de una contrasena
   (por ejemplo "Eduardo00") no entra: tiene que empezar como un hash argon2id. */

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_usuario_hash')
    ALTER TABLE dbo.usuario
        ADD CONSTRAINT ck_usuario_hash CHECK (contrasena LIKE '$argon2id$%');
GO


/* ============================================================
   2. La bitacora acepta intentos de usuarios que no existen
   ============================================================
   Antes id_usuario era obligatorio, asi que un login fallido con un nombre inexistente
   no quedaba registrado (justo lo que hace un atacante). Ahora se guarda el nombre
   que se intento en usuario_intentado. */

IF COL_LENGTH('dbo.bitacora', 'usuario_intentado') IS NULL
BEGIN
    ALTER TABLE dbo.bitacora ALTER COLUMN id_usuario INT NULL;
    ALTER TABLE dbo.bitacora ADD usuario_intentado NVARCHAR(50) NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_bitacora_quien')
    ALTER TABLE dbo.bitacora
        ADD CONSTRAINT ck_bitacora_quien CHECK (id_usuario IS NOT NULL OR usuario_intentado IS NOT NULL);
GO


/* ============================================================
   3. Procedimientos de login
   ============================================================ */

-- Dice si una cuenta esta bloqueada: 5 intentos fallidos en los ultimos 15 minutos
-- (un login correcto reinicia la cuenta). Funciona tambien con nombres que no existen.
CREATE OR ALTER PROCEDURE dbo.usp_login_bloqueado
    @nombre_usuario NVARCHAR(50),
    @bloqueado BIT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id_usuario INT;
    DECLARE @hace_15_min DATETIMEOFFSET = DATEADD(MINUTE, -15, dbo.fn_ahora_utc());
    DECLARE @desde DATETIMEOFFSET;
    DECLARE @fallidos INT;

    SELECT @id_usuario = id_usuario FROM dbo.usuario WHERE nombre_usuario = @nombre_usuario;

    -- Contar solo desde el ultimo login correcto (si fue hace menos de 15 minutos)
    SELECT @desde = MAX(fecha)
    FROM dbo.bitacora
    WHERE accion = 'LOGIN'
      AND (id_usuario = @id_usuario OR usuario_intentado = @nombre_usuario);

    IF @desde IS NULL OR @desde < @hace_15_min
        SET @desde = @hace_15_min;

    SELECT @fallidos = COUNT(*)
    FROM dbo.bitacora
    WHERE accion = 'LOGIN_FALLIDO'
      AND fecha > @desde
      AND (id_usuario = @id_usuario OR usuario_intentado = @nombre_usuario);

    SET @bloqueado = CASE WHEN @fallidos >= 5 THEN 1 ELSE 0 END;
END;
GO

-- Registra el resultado de un intento de login en la bitacora
CREATE OR ALTER PROCEDURE dbo.usp_registrar_login
    @nombre_usuario NVARCHAR(50),
    @resultado NVARCHAR(20),          -- LOGIN, LOGIN_FALLIDO o LOGIN_BLOQUEADO
    @ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @resultado NOT IN ('LOGIN', 'LOGIN_FALLIDO', 'LOGIN_BLOQUEADO')
        THROW 51200, 'Resultado de login invalido.', 1;

    INSERT INTO dbo.bitacora (id_usuario, usuario_intentado, accion, ip)
    SELECT (SELECT id_usuario FROM dbo.usuario WHERE nombre_usuario = @nombre_usuario),
           @nombre_usuario, @resultado, NULLIF(@ip, '');
END;
GO

-- Cierra TODAS las sesiones abiertas de un usuario (cerrar sesion, cambio o restablecimiento de contrasena).
-- Cada token lleva el numero de version con el que se emitio; al subirlo, los anteriores dejan de valer.
CREATE OR ALTER PROCEDURE dbo.usp_cerrar_sesiones
    @id_usuario INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.usuario SET version_sesion = version_sesion + 1 WHERE id_usuario = @id_usuario;
END;
GO

-- Elimina un cliente creado por error. La aplicacion no tiene permiso DELETE sobre dbo.cliente; esta es la unica
-- forma, y la base decide: no se borra el consumidor final ni un cliente con facturas o cobros. Queda en la auditoria.
CREATE OR ALTER PROCEDURE dbo.usp_eliminar_cliente
    @id_cliente INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.cliente WHERE id_cliente = @id_cliente)
        THROW 51150, 'El cliente no existe.', 1;
    IF EXISTS (SELECT 1 FROM dbo.cliente WHERE id_cliente = @id_cliente AND documento = 'CF')
        THROW 51151, 'El consumidor final (CF) no se puede eliminar.', 1;
    IF EXISTS (SELECT 1 FROM dbo.factura WHERE id_cliente = @id_cliente)
       OR EXISTS (SELECT 1 FROM dbo.cobro WHERE id_cliente = @id_cliente)
        THROW 51152, 'No se puede eliminar: el cliente tiene facturas o cobros registrados.', 1;

    BEGIN TRAN;
    INSERT INTO dbo.auditoria_evento (tabla, id_registro, accion, id_usuario, valores_anteriores)
    SELECT 'cliente', CAST(c.id_cliente AS NVARCHAR(80)), 'DELETE', dbo.fn_usuario_actual(),
           (SELECT c.nombre_cliente, c.tipo_documento, c.documento, c.correo, c.telefono, c.direccion, c.activo
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM dbo.cliente c
    WHERE c.id_cliente = @id_cliente;

    DELETE FROM dbo.cliente WHERE id_cliente = @id_cliente;
    COMMIT;
END;
GO


/* ============================================================
   4. Alertas automaticas
   ============================================================
   Cuando se inserta en la bitacora, este trigger revisa si hay algo sospechoso y,
   si lo hay, agrega otra fila ALERTA_... (como maximo una por hora por usuario).
   Se consultan con la vista vw_alertas_seguridad. */

CREATE OR ALTER TRIGGER dbo.tr_bitacora_alertas
ON dbo.bitacora
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Alerta 1: 5 o mas logins fallidos en 15 minutos para el mismo usuario
    INSERT INTO dbo.bitacora (id_usuario, usuario_intentado, accion, detalle)
    SELECT DISTINCT i.id_usuario, i.usuario_intentado, 'ALERTA_FUERZA_BRUTA',
           '5 o mas intentos fallidos en 15 minutos'
    FROM inserted i
    WHERE i.accion = 'LOGIN_FALLIDO'
      AND (SELECT COUNT(*) FROM dbo.bitacora b
           WHERE b.accion = 'LOGIN_FALLIDO'
             AND b.fecha > DATEADD(MINUTE, -15, dbo.fn_ahora_utc())
             AND (b.id_usuario = i.id_usuario OR b.usuario_intentado = i.usuario_intentado)) >= 5
      AND NOT EXISTS (SELECT 1 FROM dbo.bitacora a
                      WHERE a.accion = 'ALERTA_FUERZA_BRUTA'
                        AND a.fecha > DATEADD(HOUR, -1, dbo.fn_ahora_utc())
                        AND (a.id_usuario = i.id_usuario OR a.usuario_intentado = i.usuario_intentado));

    -- Alerta 2: un mismo usuario anula 5 o mas facturas en una hora
    INSERT INTO dbo.bitacora (id_usuario, accion, detalle)
    SELECT DISTINCT i.id_usuario, 'ALERTA_ANULACIONES', '5 o mas anulaciones en una hora'
    FROM inserted i
    WHERE i.accion = 'ANULAR'
      AND i.id_usuario IS NOT NULL
      AND (SELECT COUNT(*) FROM dbo.bitacora b
           WHERE b.accion = 'ANULAR'
             AND b.id_usuario = i.id_usuario
             AND b.fecha > DATEADD(HOUR, -1, dbo.fn_ahora_utc())) >= 5
      AND NOT EXISTS (SELECT 1 FROM dbo.bitacora a
                      WHERE a.accion = 'ALERTA_ANULACIONES'
                        AND a.id_usuario = i.id_usuario
                        AND a.fecha > DATEADD(HOUR, -1, dbo.fn_ahora_utc()));
END;
GO

CREATE OR ALTER VIEW dbo.vw_alertas_seguridad
AS
SELECT b.id_bitacora, b.fecha, b.accion AS alerta,
       COALESCE(u.nombre_usuario, b.usuario_intentado) AS usuario,
       b.detalle
FROM dbo.bitacora b
LEFT JOIN dbo.usuario u ON u.id_usuario = b.id_usuario
WHERE b.accion LIKE 'ALERTA[_]%';
GO

GRANT SELECT ON dbo.vw_alertas_seguridad TO rol_auditor;
GO


/* ============================================================
   5. Enmascarado de datos (Dynamic Data Masking)
   ============================================================
   Quien no tenga el permiso UNMASK ve los datos del cliente tapados:
       correo: aXXX@XXXX.com      telefono: XXXX-5678
   (El documento no se puede enmascarar porque de el depende la columna calculada documento_norm.)
   La aplicacion, el cajero y el administrador SI ven los datos completos (UNMASK);
   el auditor ve todo tapado. */

IF NOT EXISTS (SELECT 1 FROM sys.masked_columns WHERE object_id = OBJECT_ID('dbo.cliente') AND name = 'correo')
    ALTER TABLE dbo.cliente ALTER COLUMN correo ADD MASKED WITH (FUNCTION = 'email()');
IF NOT EXISTS (SELECT 1 FROM sys.masked_columns WHERE object_id = OBJECT_ID('dbo.cliente') AND name = 'telefono')
    ALTER TABLE dbo.cliente ALTER COLUMN telefono ADD MASKED WITH (FUNCTION = 'partial(0, "XXXX-", 4)');
GO

GRANT UNMASK TO rol_app_facturacion;
GRANT UNMASK TO rol_cajero;
GRANT UNMASK TO rol_admin;
GRANT SELECT ON dbo.cliente TO rol_auditor;   -- para que pueda revisar clientes, pero con los datos tapados
GO


/* ============================================================
   6. Seguridad por fila (Row-Level Security)
   ============================================================
   Una persona del rol_cajero que entre directo a SQL Server solo ve las facturas y los
   cobros que ella misma creo, y lo que cuelga de ellos (lineas, historial, cobros aplicados, kardex y cuenta corriente) (se compara su usuario de SQL con usuario.nombre_usuario).
   La aplicacion, el administrador y el auditor ven todo. */

IF EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'pol_filtro_por_creador')
    DROP SECURITY POLICY dbo.pol_filtro_por_creador;
GO

CREATE OR ALTER FUNCTION dbo.fn_filtro_por_creador (@id_usuario INT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
    WHERE IS_MEMBER('db_owner') = 1
       OR IS_MEMBER('rol_app_facturacion') = 1
       OR IS_MEMBER('rol_admin') = 1
       OR IS_MEMBER('rol_auditor') = 1
       OR @id_usuario = (SELECT u.id_usuario FROM dbo.usuario u WHERE u.nombre_usuario = USER_NAME());
GO

-- Las tablas que cuelgan de una factura (lineas, historial, aplicaciones...) siguen a su factura: se ven solo si la
-- factura es suya (se repite la misma condicion que en fn_filtro_por_creador; SQL Server no la hereda).
CREATE OR ALTER FUNCTION dbo.fn_filtro_por_factura (@id_factura BIGINT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
    WHERE IS_MEMBER('db_owner') = 1
       OR IS_MEMBER('rol_app_facturacion') = 1
       OR IS_MEMBER('rol_admin') = 1
       OR IS_MEMBER('rol_auditor') = 1
       OR EXISTS (SELECT 1 FROM dbo.factura f JOIN dbo.usuario u ON u.id_usuario = f.id_usuario
                  WHERE f.id_factura = @id_factura AND u.nombre_usuario = USER_NAME());
GO

-- La cuenta corriente apunta a una factura o a un cobro
CREATE OR ALTER FUNCTION dbo.fn_filtro_movimiento_cliente (@id_factura BIGINT, @id_cobro BIGINT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
    WHERE IS_MEMBER('db_owner') = 1
       OR IS_MEMBER('rol_app_facturacion') = 1
       OR IS_MEMBER('rol_admin') = 1
       OR IS_MEMBER('rol_auditor') = 1
       OR EXISTS (SELECT 1 FROM dbo.factura f JOIN dbo.usuario u ON u.id_usuario = f.id_usuario
                  WHERE f.id_factura = @id_factura AND u.nombre_usuario = USER_NAME())
       OR EXISTS (SELECT 1 FROM dbo.cobro c JOIN dbo.usuario u ON u.id_usuario = c.id_usuario
                  WHERE c.id_cobro = @id_cobro AND u.nombre_usuario = USER_NAME());
GO

CREATE SECURITY POLICY dbo.pol_filtro_por_creador
    ADD FILTER PREDICATE dbo.fn_filtro_por_creador(id_usuario) ON dbo.factura,
    ADD FILTER PREDICATE dbo.fn_filtro_por_creador(id_usuario) ON dbo.cobro,
    ADD FILTER PREDICATE dbo.fn_filtro_por_factura(id_factura) ON dbo.detalle_factura,
    ADD FILTER PREDICATE dbo.fn_filtro_por_factura(id_factura) ON dbo.cobro_aplicacion,
    ADD FILTER PREDICATE dbo.fn_filtro_por_factura(id_factura) ON dbo.historial_estado_factura,
    ADD FILTER PREDICATE dbo.fn_filtro_por_factura(id_factura) ON dbo.factura_fel,
    ADD FILTER PREDICATE dbo.fn_filtro_por_factura(id_factura) ON dbo.movimiento_inventario,
    ADD FILTER PREDICATE dbo.fn_filtro_movimiento_cliente(id_factura, id_cobro) ON dbo.movimiento_cliente
    WITH (STATE = ON);
GO


/* ============================================================
   Procedimientos del login: solo la aplicacion los ejecuta
   ============================================================
   Si un administrador pudiera ejecutarlos a mano, podria falsear la bitacora o limpiar un bloqueo de cuenta. */
DENY EXECUTE ON dbo.usp_registrar_login TO rol_admin;
DENY EXECUTE ON dbo.usp_login_bloqueado TO rol_admin;
DENY EXECUTE ON dbo.usp_cerrar_sesiones TO rol_admin;
GO


/* ============================================================
   Vista como mecanismo de seguridad: vw_clientes_publico
   ============================================================
   Muestra solo los clientes activos y SIN datos de contacto (ni documento, ni correo, ni telefono,
   ni direccion). rol_consulta puede leer esta vista pero NO la tabla cliente: asi una persona ve el
   directorio sin ver nada sensible.
   Funciona porque la vista y la tabla pertenecen al mismo dueno (dbo) y SQL Server no vuelve a pedir
   permiso sobre la tabla (cadena de propiedad).
   WITH CHECK OPTION: si alguien modifica un cliente a traves de la vista, el resultado debe seguir
   cumpliendo el WHERE (activo = 1). Por ejemplo, desactivar un cliente por la vista se rechaza. */
CREATE OR ALTER VIEW dbo.vw_clientes_publico
AS
SELECT id_cliente, nombre_cliente, tipo_documento, municipio, departamento, activo
FROM dbo.cliente
WHERE activo = 1
WITH CHECK OPTION;
GO

IF DATABASE_PRINCIPAL_ID('rol_consulta') IS NULL CREATE ROLE rol_consulta;
GO
GRANT SELECT ON dbo.vw_clientes_publico TO rol_consulta;
DENY  SELECT ON dbo.cliente             TO rol_consulta;   -- la tabla completa nunca
GO
