/*
    PERMISOS: quien puede hacer que en la base de datos
    Requiere haber ejecutado: 00 a 05 (tablas, vistas, procedimientos y triggers). Se puede ejecutar mas de una vez.

    Hay cuatro roles:
      rol_app_facturacion   el programa (la aplicacion web)
      rol_cajero            una persona que factura y cobra
      rol_admin             una persona que administra
      rol_auditor           una persona que solo revisa (lee)

    Reglas de todo el archivo
      - GRANT da un permiso; DENY lo prohibe y SIEMPRE le gana a un GRANT.
      - Facturas, cobros, kardex e historiales solo se modifican con procedimientos. Los procedimientos
        y triggers si pueden escribir en esas tablas aunque la persona no pueda, porque pertenecen al
        mismo dueno (dbo).
      - Ningun rol puede leer las contrasenas (hash) ni las llaves del certificador.
      - Certificar una factura (guardar el UUID de la SAT) solo lo hace la aplicacion, nunca una persona.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DATABASE_PRINCIPAL_ID('rol_app_facturacion') IS NULL CREATE ROLE rol_app_facturacion;
IF DATABASE_PRINCIPAL_ID('rol_cajero')          IS NULL CREATE ROLE rol_cajero;
IF DATABASE_PRINCIPAL_ID('rol_admin')           IS NULL CREATE ROLE rol_admin;
IF DATABASE_PRINCIPAL_ID('rol_auditor')         IS NULL CREATE ROLE rol_auditor;
GO


/* ============================================================
   1. La aplicacion
   ============================================================
   Lee todo y ejecuta los procedimientos. Para facturar, cobrar o mover inventario no puede
   escribir en las tablas: asi ni un error del programa se salta las reglas. */

GRANT SELECT  ON SCHEMA::dbo TO rol_app_facturacion;
GRANT EXECUTE ON SCHEMA::dbo TO rol_app_facturacion;

-- Datos que las pantallas administran directamente
GRANT INSERT, UPDATE ON dbo.cliente         TO rol_app_facturacion;
GRANT INSERT, UPDATE ON dbo.producto        TO rol_app_facturacion;
GRANT INSERT, UPDATE ON dbo.usuario         TO rol_app_facturacion;
GRANT INSERT, UPDATE ON dbo.serie_documento TO rol_app_facturacion;
GRANT INSERT, UPDATE ON dbo.negocio         TO rol_app_facturacion;
GRANT INSERT         ON dbo.bitacora        TO rol_app_facturacion;
REVOKE DELETE ON dbo.cliente FROM rol_app_facturacion;   -- los clientes no se borran (antes se permitia)

-- La existencia (stock_actual) solo la cambia el kardex, nunca a mano
DENY UPDATE ON dbo.producto(stock_actual) TO rol_app_facturacion;

-- Procedimientos internos: solo los llaman otros procedimientos y triggers. Si la aplicacion pudiera ejecutarlos
-- a mano, se duplicarian movimientos de kardex y cargos al cliente.
DENY EXECUTE ON dbo.usp_mover_inventario        TO rol_app_facturacion;
DENY EXECUTE ON dbo.usp_aplicar_efectos_factura TO rol_app_facturacion;

-- Documentos, cobros e historiales: SOLO por procedimientos
DENY INSERT, UPDATE, DELETE ON dbo.factura                  TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.detalle_factura          TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.factura_fel              TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.cobro                    TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.cobro_aplicacion         TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.movimiento_inventario    TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.movimiento_cliente       TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.historial_estado_factura TO rol_app_facturacion;
DENY INSERT, UPDATE, DELETE ON dbo.auditoria_evento         TO rol_app_facturacion;
GO


/* ============================================================
   2. Cajero: factura y cobra, nada mas
   ============================================================
   Puede crear una factura, agregarle lineas, registrar cobros y ver el historial.
   NO puede certificar ni cambiar el estado de una factura (eso lo hace la aplicacion al hablar con el
   certificador), ni anular, ni ajustar inventario, ni ver reportes o la bitacora. */

GRANT SELECT ON SCHEMA::dbo TO rol_cajero;

-- Solo estos procedimientos (si antes tenia mas, se le quitan)
GRANT  EXECUTE ON dbo.usp_crear_factura_borrador  TO rol_cajero;
GRANT  EXECUTE ON dbo.usp_agregar_linea           TO rol_cajero;
GRANT  EXECUTE ON dbo.usp_registrar_cobro         TO rol_cajero;
GRANT  EXECUTE ON dbo.usp_historial_factura       TO rol_cajero;
REVOKE EXECUTE ON dbo.usp_cambiar_estado_factura  FROM rol_cajero;
REVOKE EXECUTE ON dbo.usp_registrar_certificacion FROM rol_cajero;
REVOKE EXECUTE ON dbo.usp_registrar_rechazo       FROM rol_cajero;

GRANT INSERT, UPDATE ON dbo.cliente  TO rol_cajero;
GRANT INSERT         ON dbo.bitacora TO rol_cajero;

-- Lo que nunca debe leer
DENY SELECT ON dbo.usuario(contrasena)             TO rol_cajero;
DENY SELECT ON dbo.negocio(llave_api, llave_firma) TO rol_cajero;
DENY SELECT ON dbo.bitacora                        TO rol_cajero;
DENY SELECT ON dbo.auditoria_evento                TO rol_cajero;
GO


/* ============================================================
   3. Administrador: todo lo operativo
   ============================================================
   Puede ejecutar los procedimientos de uso diario (anular, ajustar inventario, reportes...) y administrar
   usuarios, series, productos y el negocio. Se le prohiben los procedimientos que solo deben llamar otros
   procedimientos o la aplicacion: ejecutarlos a mano duplicaria movimientos o falsearia la bitacora. */

GRANT SELECT, EXECUTE ON SCHEMA::dbo TO rol_admin;

GRANT INSERT, UPDATE ON dbo.cliente         TO rol_admin;
GRANT INSERT, UPDATE ON dbo.producto        TO rol_admin;
GRANT INSERT, UPDATE ON dbo.usuario         TO rol_admin;
GRANT INSERT, UPDATE ON dbo.serie_documento TO rol_admin;
GRANT INSERT, UPDATE ON dbo.negocio         TO rol_admin;
GRANT INSERT         ON dbo.bitacora        TO rol_admin;

DENY UPDATE ON dbo.producto(stock_actual)          TO rol_admin;
DENY SELECT ON dbo.usuario(contrasena)             TO rol_admin;
DENY SELECT ON dbo.negocio(llave_api, llave_firma) TO rol_admin;

-- Internos: solo los llaman otros procedimientos y triggers
DENY EXECUTE ON dbo.usp_mover_inventario        TO rol_admin;
DENY EXECUTE ON dbo.usp_aplicar_efectos_factura TO rol_admin;
-- Del certificador: solo la aplicacion (y el simulado es solo para pruebas)
DENY EXECUTE ON dbo.usp_registrar_certificacion TO rol_admin;
DENY EXECUTE ON dbo.usp_registrar_rechazo       TO rol_admin;
DENY EXECUTE ON dbo.usp_certificar_simulado     TO rol_admin;
DENY EXECUTE ON dbo.usp_anular_simulado         TO rol_admin;
-- (usp_registrar_login y usp_login_bloqueado se le niegan en 10_seguridad_db.sql, donde se crean)
GO


/* ============================================================
   4. Auditor: solo lee
   ============================================================
   Ve la bitacora, la auditoria, los historiales y los documentos. No modifica nada.
   (En 10_seguridad_db.sql se le da ademas lectura de clientes, con correo y telefono tapados.) */

GRANT SELECT ON dbo.bitacora                 TO rol_auditor;
GRANT SELECT ON dbo.auditoria_evento         TO rol_auditor;
GRANT SELECT ON dbo.historial_estado_factura TO rol_auditor;
GRANT SELECT ON dbo.movimiento_inventario    TO rol_auditor;
GRANT SELECT ON dbo.movimiento_cliente       TO rol_auditor;
GRANT SELECT ON dbo.factura                  TO rol_auditor;
GRANT SELECT ON dbo.detalle_factura          TO rol_auditor;
GRANT SELECT ON dbo.cobro                    TO rol_auditor;
GRANT SELECT ON dbo.usuario(id_usuario, nombre_usuario, id_rol, activo) TO rol_auditor;
GO


/* ============================================================
   Como dar acceso a una persona o a la aplicacion (ejecutar UNA vez por cada una)
   ============================================================
    Una persona:
        CREATE USER maria FOR LOGIN maria;
        ALTER ROLE rol_cajero ADD MEMBER maria;
    El login de la aplicacion:
        CREATE USER app_user FOR LOGIN app_user;
        ALTER ROLE rol_app_facturacion ADD MEMBER app_user;
*/
GO
