/*
    FACTURACION, COBROS E INVENTARIO CON HISTORIAL - SQL Server 2016 SP1+ (probado en 2022)
    Toda la logica vive en la base de datos: constraints, triggers, procedimientos y vistas.

    Reglas de diseno
    ----------------
    1. Una factura nace en BORRADOR; sus lineas se editan solo en BORRADOR/RECHAZADA y los
       totales se recalculan por trigger.
    2. El estado solo cambia segun la tabla transicion_estado_factura.
    3. El INVENTARIO se mueve al CERTIFICAR (y se revierte al ANULAR). stock_actual solo cambia
       insertando en movimiento_inventario (kardex); un UPDATE directo se rechaza.
    4. Los COBROS son recibos (cobro) que se aplican a una o varias facturas (cobro_aplicacion).
       El saldo de cada factura lo mantienen los triggers.
    5. HISTORIAL: historial_estado_factura, movimiento_cliente (cuenta corriente),
       movimiento_inventario (kardex) y auditoria_evento (antes/despues en JSON).
       Todas son de solo insercion.
    6. Quien hizo el cambio se toma de SESSION_CONTEXT('id_usuario'); los procedimientos lo
       establecen. Si la app inserta directo en tablas, debe hacer antes:
           EXEC sys.sp_set_session_context @key=N'id_usuario', @value=<id>;

    Nota fiscal: esto prepara datos y controles internos para FEL; no certifica cumplimiento
    legal. Validar con SAT, el certificador y el contador.
*/

/*
    INSTALADOR - ejecuta todos los archivos en el orden correcto.

    Uso (desde ESTA carpeta, para que las rutas relativas funcionen):
        sqlcmd -S <servidor> -E -C -I -d <base> -i instalar.sql

    -I  activa QUOTED_IDENTIFIER (necesario para los indices filtrados y columnas calculadas)
    La base de datos debe existir y estar vacia. Si un archivo falla, se detiene todo.

    En PRODUCCION: quite la linea de 06_certificador_simulado.sql.
*/
:on error exit
:r 00_funciones_y_tipos.sql
:r 01_tablas.sql
:r 13_sat_resiliencia.sql   -- columnas y validaciones nuevas; va antes de los procedimientos que las usan
:r 02_datos_base.sql
:r 03_vistas.sql
:r 04_procedimientos.sql
:r 05_triggers.sql
:r 06_certificador_simulado.sql
:r 07_permisos.sql
:r 10_seguridad_db.sql
-- Cargar tu negocio, series y usuario: edite y ejecute 08_datos_negocio_ejemplo.sql
