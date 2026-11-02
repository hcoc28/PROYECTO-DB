/*
    TRIGGERS (disparadores) del sistema de facturacion y cobros.
    Requiere haber ejecutado: 01, 03, 04
    Un trigger es codigo que SQL Server ejecuta SOLO cuando alguien inserta, modifica o borra
    en una tabla. Sirve para hacer cumplir reglas aunque el programa tenga un error.
    Dentro de un trigger existen dos tablas temporales:
        inserted = las filas nuevas (o como quedaron despues del cambio)
        deleted  = las filas viejas (o como estaban antes del cambio)

    Lista:
      Facturas:   tr_detalle_factura_totales, tr_factura_insert, tr_factura_proteger, tr_factura_estado, tr_factura_no_borrar
      Cobros:     tr_cobro_insert, tr_cobro_update, tr_cobro_no_borrar, tr_cobro_aplicacion_insert
      Inventario: tr_producto_proteger_stock
      Historiales (solo se pueden agregar filas): tr_inmutable_* (7 triggers)
      Auditoria:  tr_producto_auditoria, tr_cliente_auditoria, tr_usuario_auditoria
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Limpieza de triggers de versiones anteriores (si no existen, no pasa nada)
DROP TRIGGER IF EXISTS dbo.tr_factura_cambios;               -- se dividio en tr_factura_proteger y tr_factura_estado
DROP TRIGGER IF EXISTS dbo.tr_movimiento_inventario_insert;  -- ya lo revisa usp_mover_inventario
GO


/* ============================================================
   FACTURAS
   ============================================================ */

/* ------------------------------------------------------------
   Cada vez que cambia una linea de la factura, recalcula los totales.
   Solo se pueden cambiar lineas mientras la factura es editable
   (BORRADOR o RECHAZADA). */
CREATE OR ALTER TRIGGER dbo.tr_detalle_factura_totales
ON dbo.detalle_factura
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Regla: la factura debe estar en un estado editable
    IF EXISTS (
        SELECT 1
        FROM dbo.factura f
        JOIN dbo.estado_factura e ON e.codigo = f.estado
        WHERE e.editable = 0
          AND (f.id_factura IN (SELECT id_factura FROM inserted)
               OR f.id_factura IN (SELECT id_factura FROM deleted))
    )
        THROW 51030, 'Solo se pueden modificar lineas de facturas en BORRADOR o RECHAZADA.', 1;

    -- Recalcular los totales de las facturas que cambiaron
    UPDATE f
    SET subtotal_gravado = ISNULL((SELECT SUM(d.subtotal_sin_iva) FROM dbo.detalle_factura d
                                   WHERE d.id_factura = f.id_factura AND d.tasa_iva > 0), 0),
        subtotal_exento  = ISNULL((SELECT SUM(d.total_linea) FROM dbo.detalle_factura d
                                   WHERE d.id_factura = f.id_factura AND d.tasa_iva = 0), 0),
        descuento_total  = ISNULL((SELECT SUM(d.descuento_linea) FROM dbo.detalle_factura d
                                   WHERE d.id_factura = f.id_factura), 0),
        iva_total        = ISNULL((SELECT SUM(d.iva_linea) FROM dbo.detalle_factura d
                                   WHERE d.id_factura = f.id_factura), 0),
        total            = ISNULL((SELECT SUM(d.total_linea) FROM dbo.detalle_factura d
                                   WHERE d.id_factura = f.id_factura), 0)
    FROM dbo.factura f
    WHERE f.id_factura IN (SELECT id_factura FROM inserted)
       OR f.id_factura IN (SELECT id_factura FROM deleted);
END;
GO


/* ------------------------------------------------------------
   Toda factura nace en BORRADOR y se anota en el historial. */
CREATE OR ALTER TRIGGER dbo.tr_factura_insert
ON dbo.factura
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM inserted WHERE estado <> 'BORRADOR')
        THROW 51040, 'Toda factura debe crearse en estado BORRADOR.', 1;

    INSERT INTO dbo.historial_estado_factura (id_factura, estado_anterior, estado_nuevo, id_usuario)
    SELECT id_factura, NULL, estado, ISNULL(dbo.fn_usuario_actual(), id_usuario)
    FROM inserted;
END;
GO


/* ------------------------------------------------------------
   Proteger los datos de una factura cuando se MODIFICA.
   Una factura certificada es un documento fiscal: no se puede alterar. */
CREATE OR ALTER TRIGGER dbo.tr_factura_proteger
ON dbo.factura
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Estos datos nunca cambian
    IF UPDATE(id_negocio) OR UPDATE(id_serie_documento) OR UPDATE(numero_interno) OR UPDATE(id_usuario)
       OR UPDATE(id_transaccion_fel)
        THROW 51041, 'No se puede cambiar el negocio, la serie, el numero, el usuario que creo la factura ni su identificador de transaccion.', 1;

    -- Si la factura ya no es editable (certificada, anulada...), no se cambian cliente, fecha ni total
    IF EXISTS (SELECT 1
               FROM inserted i
               JOIN deleted d ON d.id_factura = i.id_factura
               JOIN dbo.estado_factura e ON e.codigo = d.estado
               WHERE e.editable = 0
                 AND (i.id_cliente <> d.id_cliente
                      OR i.fecha_emision <> d.fecha_emision
                      OR i.condicion_pago <> d.condicion_pago
                      OR i.total <> d.total))
        THROW 51041, 'La factura ya no es editable: no se pueden cambiar su cliente, fecha, condicion ni total.', 1;

    -- Lo que asigno SAT (UUID, serie y numero) no se puede cambiar una vez guardado
    IF EXISTS (SELECT 1
               FROM inserted i
               JOIN deleted d ON d.id_factura = i.id_factura
               WHERE (d.uuid_fel IS NOT NULL AND ISNULL(i.uuid_fel, '') <> d.uuid_fel)
                  OR (d.serie_fel IS NOT NULL AND ISNULL(i.serie_fel, '') <> d.serie_fel)
                  OR (d.numero_fel IS NOT NULL AND ISNULL(i.numero_fel, '') <> d.numero_fel))
        THROW 51041, 'No se pueden cambiar el UUID, la serie ni el numero que asigno SAT.', 1;
END;
GO


/* ------------------------------------------------------------
   Cuando CAMBIA EL ESTADO de una factura:
     1. revisa que el cambio este permitido
     2. revisa que la factura este completa (y las notas, que corrijan algo valido)
     3. anota el cambio en el historial
     4. si se certifico o se anulo, mueve inventario y cuenta del cliente
   Se cambia el estado de UNA factura a la vez (asi es como trabajan los procedimientos). */
CREATE OR ALTER TRIGGER dbo.tr_factura_estado
ON dbo.factura
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT UPDATE(estado) RETURN;

    DECLARE @cambiadas INT;
    SELECT @cambiadas = COUNT(*)
    FROM inserted i JOIN deleted d ON d.id_factura = i.id_factura
    WHERE i.estado <> d.estado;

    IF @cambiadas = 0 RETURN;
    IF @cambiadas > 1
        THROW 51048, 'El estado se cambia de una factura a la vez.', 1;

    -- Datos de la factura que cambio de estado
    DECLARE @id_factura BIGINT, @antes NVARCHAR(25), @nuevo NVARCHAR(25);
    DECLARE @total DECIMAL(18,2), @id_referencia BIGINT, @motivo_referencia NVARCHAR(500), @motivo_anulacion NVARCHAR(500);
    DECLARE @requiere_referencia BIT, @signo_saldo SMALLINT;
    DECLARE @lineas INT, @suma_lineas DECIMAL(18,2);

    SELECT @id_factura = i.id_factura, @antes = d.estado, @nuevo = i.estado, @total = i.total,
           @id_referencia = i.id_factura_referencia, @motivo_referencia = i.motivo_referencia,
           @motivo_anulacion = i.motivo_anulacion,
           @requiere_referencia = t.requiere_referencia, @signo_saldo = t.signo_saldo
    FROM inserted i
    JOIN deleted d ON d.id_factura = i.id_factura
    JOIN dbo.serie_documento s ON s.id_serie_documento = i.id_serie_documento
    JOIN dbo.tipo_dte t ON t.codigo_dte = s.codigo_dte
    WHERE i.estado <> d.estado;

    -- 1. El cambio debe estar en la tabla de transiciones permitidas
    IF NOT EXISTS (SELECT 1 FROM dbo.transicion_estado_factura
                   WHERE estado_origen = @antes AND estado_destino = @nuevo)
        THROW 51042, 'Transicion de estado no permitida (ver transicion_estado_factura).', 1;

    -- 2. Para enviar o certificar, la factura debe estar completa
    IF @nuevo IN ('PENDIENTE_CERTIFICACION', 'CERTIFICADA')
    BEGIN
        SELECT @lineas = COUNT(*), @suma_lineas = ISNULL(SUM(total_linea), 0)
        FROM dbo.detalle_factura
        WHERE id_factura = @id_factura;

        IF @lineas = 0 OR @total <= 0 OR @total <> @suma_lineas
            THROW 51043, 'La factura no tiene lineas, o su total no coincide con el detalle.', 1;

        IF @requiere_referencia = 1
        BEGIN
            -- Nota de credito o debito: debe corregir una factura certificada (no otra nota)
            IF @id_referencia IS NULL OR @motivo_referencia IS NULL
                THROW 51044, 'Las notas de credito y debito necesitan la factura que corrigen y el motivo.', 1;

            IF NOT EXISTS (SELECT 1
                           FROM dbo.factura r
                           JOIN dbo.serie_documento sr ON sr.id_serie_documento = r.id_serie_documento
                           JOIN dbo.tipo_dte tr ON tr.codigo_dte = sr.codigo_dte
                           WHERE r.id_factura = @id_referencia
                             AND r.estado = 'CERTIFICADA'
                             AND tr.requiere_referencia = 0
                             AND tr.signo_saldo = 1)
                THROW 51044, 'La nota debe referirse a una factura certificada (no a otra nota).', 1;
        END
        ELSE IF @id_referencia IS NOT NULL
            THROW 51044, 'Una factura normal no lleva documento de referencia.', 1;
    END;

    -- Las notas de credito juntas no pueden superar el total de la factura original
    IF @nuevo = 'CERTIFICADA' AND @signo_saldo = -1 AND @id_referencia IS NOT NULL
    BEGIN
        IF @total + (SELECT ISNULL(SUM(g.total), 0)
                     FROM dbo.factura g
                     JOIN dbo.serie_documento sg ON sg.id_serie_documento = g.id_serie_documento
                     JOIN dbo.tipo_dte tg ON tg.codigo_dte = sg.codigo_dte
                     WHERE g.id_factura_referencia = @id_referencia
                       AND g.estado = 'CERTIFICADA'
                       AND tg.signo_saldo = -1
                       AND g.id_factura <> @id_factura)
           > (SELECT total FROM dbo.factura WHERE id_factura = @id_referencia)
            THROW 51045, 'Las notas de credito acumuladas superan el total de la factura original.', 1;
    END;

    -- No se anula una factura con cobros aplicados o con notas certificadas
    IF @antes = 'CERTIFICADA' AND @nuevo = 'ANULADA'
    BEGIN
        IF EXISTS (SELECT 1
                   FROM dbo.cobro_aplicacion ca
                   JOIN dbo.cobro co ON co.id_cobro = ca.id_cobro
                   WHERE ca.id_factura = @id_factura AND co.estado = 'APLICADO')
           OR EXISTS (SELECT 1 FROM dbo.factura g
                      WHERE g.id_factura_referencia = @id_factura AND g.estado = 'CERTIFICADA')
            THROW 51046, 'No se puede anular: tiene cobros aplicados o notas certificadas. Anule primero los cobros/notas.', 1;
    END;

    -- 3. Anotar el cambio en el historial
    INSERT INTO dbo.historial_estado_factura (id_factura, estado_anterior, estado_nuevo, id_usuario, motivo)
    SELECT @id_factura, @antes, @nuevo,
           ISNULL(dbo.fn_usuario_actual(), ISNULL(f.id_usuario_anula, f.id_usuario)),
           CASE WHEN @nuevo = 'ANULADA' THEN @motivo_anulacion END
    FROM dbo.factura f
    WHERE f.id_factura = @id_factura;

    -- 4. Al certificar (o anular una certificada) se mueve el inventario y la cuenta del cliente
    IF @nuevo = 'CERTIFICADA' OR (@antes = 'CERTIFICADA' AND @nuevo = 'ANULADA')
        EXEC dbo.usp_aplicar_efectos_factura @id_factura = @id_factura, @estado_nuevo = @nuevo;

    -- Recalcular lo que debe la factura (y la que corrige, si es una nota)
    UPDATE f
    SET saldo_pendiente = v.saldo, estado_pago = v.estado_pago
    FROM dbo.factura f
    JOIN dbo.vw_saldo_factura v ON v.id_factura = f.id_factura
    WHERE f.id_factura IN (@id_factura, @id_referencia)
      AND (f.saldo_pendiente <> v.saldo OR f.estado_pago <> v.estado_pago);
END;
GO


/* ------------------------------------------------------------
   Las facturas no se borran: se anulan. */
CREATE OR ALTER TRIGGER dbo.tr_factura_no_borrar
ON dbo.factura
INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51047, 'Las facturas no se eliminan: use la anulacion.', 1;
END;
GO


/* ============================================================
   COBROS
   ============================================================ */

/* ------------------------------------------------------------
   Al registrar un cobro: revisa el metodo de pago y lo anota
   en la cuenta corriente del cliente (abono). */
CREATE OR ALTER TRIGGER dbo.tr_cobro_insert
ON dbo.cobro
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM inserted WHERE estado <> 'APLICADO')
        THROW 51050, 'Todo cobro se registra como APLICADO.', 1;

    -- El metodo debe estar activo y, si pide referencia (tarjeta, transferencia...), debe venir
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.metodo_pago m ON m.codigo = i.codigo_metodo
        WHERE m.activo = 0
           OR (m.requiere_referencia = 1 AND NULLIF(LTRIM(RTRIM(i.referencia)), '') IS NULL)
    )
        THROW 51051, 'El metodo de pago requiere una referencia, o esta inactivo.', 1;

    INSERT INTO dbo.movimiento_cliente (id_cliente, tipo_movimiento, id_cobro, abono, descripcion, id_usuario)
    SELECT id_cliente, 'COBRO', id_cobro, monto,
           CONCAT('Cobro ', codigo_metodo, ISNULL(' ref ' + referencia, '')),
           id_usuario
    FROM inserted;
END;
GO


/* ------------------------------------------------------------
   Un cobro no se modifica, solo se puede ANULAR.
   Al anular: se anota en la cuenta del cliente y se recalcula lo que debe cada factura. */
CREATE OR ALTER TRIGGER dbo.tr_cobro_update
ON dbo.cobro
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Estos datos no se cambian nunca
    IF UPDATE(id_cliente) OR UPDATE(monto) OR UPDATE(codigo_metodo)
       OR UPDATE(fecha_cobro) OR UPDATE(id_usuario) OR UPDATE(referencia)
        THROW 51052, 'Un cobro no se modifica; solo puede anularse.', 1;

    -- Un cobro anulado no vuelve a estar activo
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id_cobro = i.id_cobro
        WHERE d.estado = 'ANULADO' AND i.estado <> 'ANULADO'
    )
        THROW 51052, 'Un cobro anulado no se puede reactivar.', 1;

    -- Cuenta corriente: anular un cobro es un cargo (el cliente vuelve a deber ese dinero)
    INSERT INTO dbo.movimiento_cliente (id_cliente, tipo_movimiento, id_cobro, cargo, descripcion, id_usuario)
    SELECT i.id_cliente, 'ANULACION_COBRO', i.id_cobro, i.monto,
           CONCAT('Anulacion cobro #', i.id_cobro), i.id_usuario_anula
    FROM inserted i
    JOIN deleted d ON d.id_cobro = i.id_cobro
    WHERE d.estado = 'APLICADO' AND i.estado = 'ANULADO';

    -- Recalcular lo que debe cada factura que recibia dinero de los cobros anulados
    UPDATE f
    SET saldo_pendiente = v.saldo, estado_pago = v.estado_pago
    FROM dbo.factura f
    JOIN dbo.vw_saldo_factura v ON v.id_factura = f.id_factura
    WHERE f.id_factura IN (SELECT a.id_factura
                           FROM dbo.cobro_aplicacion a
                           JOIN inserted i ON i.id_cobro = a.id_cobro
                           JOIN deleted d ON d.id_cobro = i.id_cobro
                           WHERE d.estado = 'APLICADO' AND i.estado = 'ANULADO')
      AND (f.saldo_pendiente <> v.saldo OR f.estado_pago <> v.estado_pago);
END;
GO


/* ------------------------------------------------------------
   Los cobros no se borran: se anulan. */
CREATE OR ALTER TRIGGER dbo.tr_cobro_no_borrar
ON dbo.cobro
INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51053, 'Los cobros no se eliminan: use la anulacion.', 1;
END;
GO


/* ------------------------------------------------------------
   Al aplicar un cobro a una factura: revisa que se pueda y recalcula el saldo. */
CREATE OR ALTER TRIGGER dbo.tr_cobro_aplicacion_insert
ON dbo.cobro_aplicacion
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Regla 1: el cobro no puede estar anulado
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.cobro c ON c.id_cobro = i.id_cobro
        WHERE c.estado <> 'APLICADO'
    )
        THROW 51060, 'No se puede aplicar un cobro anulado.', 1;

    -- Regla 2: la factura debe poder cobrarse (certificada y no ser nota de credito)
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.vw_saldo_factura v ON v.id_factura = i.id_factura
        WHERE v.estado_pago = 'NO_APLICA'
    )
        THROW 51061, 'Solo se aplican cobros a facturas certificadas (no notas de credito ni anuladas).', 1;

    -- Regla 3: no se puede cobrar mas de lo que la factura debe
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.vw_saldo_factura v ON v.id_factura = i.id_factura
        WHERE v.saldo_calculado < 0
    )
        THROW 51062, 'El cobro excede el saldo pendiente de la factura.', 1;

    -- Regla 4: lo repartido entre facturas no puede superar el monto del cobro
    IF EXISTS (
        SELECT 1
        FROM dbo.cobro c
        WHERE c.id_cobro IN (SELECT id_cobro FROM inserted)
          AND (SELECT SUM(a.monto) FROM dbo.cobro_aplicacion a WHERE a.id_cobro = c.id_cobro) > c.monto
    )
        THROW 51063, 'Lo aplicado excede el monto del cobro.', 1;

    -- Recalcular lo que debe cada factura afectada
    UPDATE f
    SET saldo_pendiente = v.saldo, estado_pago = v.estado_pago
    FROM dbo.factura f
    JOIN dbo.vw_saldo_factura v ON v.id_factura = f.id_factura
    WHERE f.id_factura IN (SELECT id_factura FROM inserted)
      AND (f.saldo_pendiente <> v.saldo OR f.estado_pago <> v.estado_pago);
END;
GO


/* ============================================================
   INVENTARIO: proteger la existencia
   ============================================================
   usp_mover_inventario ya hace todo bien, pero este trigger protege aunque alguien
   intente saltarse el procedimiento. */

-- La existencia (stock_actual) solo puede cambiar a un valor que ya este anotado en el kardex.
--    Si alguien hace UPDATE producto SET stock_actual = 999 a mano, no coincide con el
--    ultimo movimiento y se rechaza.
CREATE OR ALTER TRIGGER dbo.tr_producto_proteger_stock
ON dbo.producto
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT UPDATE(stock_actual) RETURN;

    IF EXISTS (SELECT 1
               FROM inserted i
               JOIN deleted d ON d.id_producto = i.id_producto
               WHERE i.stock_actual <> d.stock_actual
                 AND i.stock_actual <> ISNULL((SELECT TOP 1 m.stock_resultante
                                               FROM dbo.movimiento_inventario m
                                               WHERE m.id_producto = i.id_producto
                                               ORDER BY m.id_movimiento DESC), 0))
        THROW 51022, 'stock_actual solo puede cambiar mediante un movimiento del kardex.', 1;
END;
GO


/* ============================================================
   HISTORIALES: solo se pueden AGREGAR filas, nunca modificar ni borrar.
   Asi nadie puede cambiar lo que paso.
   ============================================================ */

CREATE OR ALTER TRIGGER dbo.tr_inmutable_movimiento_inventario
ON dbo.movimiento_inventario
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51070, 'El kardex es de solo insercion.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_inmutable_movimiento_cliente
ON dbo.movimiento_cliente
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51071, 'La cuenta corriente es de solo insercion.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_inmutable_historial_estado
ON dbo.historial_estado_factura
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51072, 'El historial de estados es de solo insercion.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_inmutable_auditoria
ON dbo.auditoria_evento
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51073, 'La auditoria es de solo insercion.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_inmutable_cobro_aplicacion
ON dbo.cobro_aplicacion
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51074, 'Las aplicaciones de cobro son de solo insercion (anule el cobro).', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_inmutable_factura_fel
ON dbo.factura_fel
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51075, 'El registro FEL es de solo insercion.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_inmutable_bitacora
ON dbo.bitacora
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51076, 'La bitacora es de solo insercion.', 1;
END;
GO


/* ============================================================
   AUDITORIA: guardar el ANTES y el DESPUES de los cambios importantes
   ============================================================
   Cada vez que se crea o cambia un producto, cliente o usuario se guarda una fila
   en auditoria_evento con los valores viejos y nuevos en formato JSON
   (FOR JSON convierte una fila en texto JSON). */

CREATE OR ALTER TRIGGER dbo.tr_producto_auditoria
ON dbo.producto
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM deleted)
    BEGIN
        -- Producto nuevo
        INSERT INTO dbo.auditoria_evento (tabla, id_registro, accion, id_usuario, valores_nuevos)
        SELECT 'producto', CAST(i.id_producto AS NVARCHAR(80)), 'INSERT', dbo.fn_usuario_actual(),
               (SELECT i.nombre_producto, i.sku, i.codigo_barras, i.precio_venta, i.tasa_iva,
                       i.controla_stock, i.stock_minimo, i.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i;
    END
    ELSE
    BEGIN
        -- Producto modificado: solo si cambio algun dato importante
        INSERT INTO dbo.auditoria_evento (tabla, id_registro, accion, id_usuario, valores_anteriores, valores_nuevos)
        SELECT 'producto', CAST(i.id_producto AS NVARCHAR(80)), 'UPDATE', dbo.fn_usuario_actual(),
               (SELECT d.nombre_producto, d.sku, d.codigo_barras, d.precio_venta, d.tasa_iva,
                       d.controla_stock, d.stock_minimo, d.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
               (SELECT i.nombre_producto, i.sku, i.codigo_barras, i.precio_venta, i.tasa_iva,
                       i.controla_stock, i.stock_minimo, i.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i
        JOIN deleted d ON d.id_producto = i.id_producto
        WHERE i.nombre_producto <> d.nombre_producto
           OR ISNULL(i.sku, '') <> ISNULL(d.sku, '')
           OR ISNULL(i.codigo_barras, '') <> ISNULL(d.codigo_barras, '')
           OR i.precio_venta <> d.precio_venta
           OR i.tasa_iva <> d.tasa_iva
           OR i.controla_stock <> d.controla_stock
           OR i.stock_minimo <> d.stock_minimo
           OR i.activo <> d.activo;
    END;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_cliente_auditoria
ON dbo.cliente
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM deleted)
    BEGIN
        -- Cliente nuevo
        INSERT INTO dbo.auditoria_evento (tabla, id_registro, accion, id_usuario, valores_nuevos)
        SELECT 'cliente', CAST(i.id_cliente AS NVARCHAR(80)), 'INSERT', dbo.fn_usuario_actual(),
               (SELECT i.nombre_cliente, i.tipo_documento, i.documento, i.correo, i.telefono, i.direccion, i.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i;
    END
    ELSE
    BEGIN
        -- Cliente modificado
        INSERT INTO dbo.auditoria_evento (tabla, id_registro, accion, id_usuario, valores_anteriores, valores_nuevos)
        SELECT 'cliente', CAST(i.id_cliente AS NVARCHAR(80)), 'UPDATE', dbo.fn_usuario_actual(),
               (SELECT d.nombre_cliente, d.tipo_documento, d.documento, d.correo, d.telefono, d.direccion, d.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
               (SELECT i.nombre_cliente, i.tipo_documento, i.documento, i.correo, i.telefono, i.direccion, i.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i
        JOIN deleted d ON d.id_cliente = i.id_cliente
        WHERE i.nombre_cliente <> d.nombre_cliente
           OR i.tipo_documento <> d.tipo_documento
           OR i.documento <> d.documento
           OR ISNULL(i.correo, '') <> ISNULL(d.correo, '')
           OR ISNULL(i.telefono, '') <> ISNULL(d.telefono, '')
           OR ISNULL(i.direccion, '') <> ISNULL(d.direccion, '')
           OR i.activo <> d.activo;
    END;
END;
GO

-- La contrasena NUNCA se guarda en la auditoria: solo se anota si cambio (contrasena_cambiada)
CREATE OR ALTER TRIGGER dbo.tr_usuario_auditoria
ON dbo.usuario
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM deleted)
    BEGIN
        -- Usuario nuevo
        INSERT INTO dbo.auditoria_evento (tabla, id_registro, accion, id_usuario, valores_nuevos)
        SELECT 'usuario', CAST(i.id_usuario AS NVARCHAR(80)), 'INSERT', dbo.fn_usuario_actual(),
               (SELECT i.nombre_usuario, i.id_rol, i.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i;
    END
    ELSE
    BEGIN
        -- Usuario modificado
        INSERT INTO dbo.auditoria_evento (tabla, id_registro, accion, id_usuario, valores_anteriores, valores_nuevos)
        SELECT 'usuario', CAST(i.id_usuario AS NVARCHAR(80)), 'UPDATE', dbo.fn_usuario_actual(),
               (SELECT d.nombre_usuario, d.id_rol, d.activo
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
               (SELECT i.nombre_usuario, i.id_rol, i.activo,
                       CONVERT(BIT, CASE WHEN i.contrasena <> d.contrasena THEN 1 ELSE 0 END) AS contrasena_cambiada
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM inserted i
        JOIN deleted d ON d.id_usuario = i.id_usuario
        WHERE i.nombre_usuario <> d.nombre_usuario
           OR i.id_rol <> d.id_rol
           OR i.activo <> d.activo
           OR i.contrasena <> d.contrasena;
    END;
END;
GO


/* ============================================================
   LIMPIEZA de piezas de versiones anteriores
   ============================================================
   Se hace al final porque los triggers viejos usaban estas piezas;
   ya fueron reemplazados arriba. Si no existen, no pasa nada. */
DROP PROCEDURE IF EXISTS dbo.usp_recalcular_saldos;
GO
DROP TYPE IF EXISTS dbo.tt_ids;
GO
