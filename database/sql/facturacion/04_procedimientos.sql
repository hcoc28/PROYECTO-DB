/*
    PROCEDIMIENTOS ALMACENADOS del sistema de facturacion y cobros.
    Requiere haber ejecutado: 01, 02, 03
    Un procedimiento es un "programa" guardado en la base de datos que hace una tarea completa
    (por ejemplo: registrar un cobro). La aplicacion solo llama al procedimiento y la base se
    encarga de las reglas.

    Lista:
      usp_mover_inventario        entrada o salida de mercaderia (kardex + existencia)
      usp_aplicar_efectos_factura inventario y cuenta del cliente al certificar o anular (lo llama un trigger)
      usp_crear_factura_borrador  crea una factura y le asigna su numero
      usp_agregar_linea           agrega un producto a una factura
      usp_cambiar_estado_factura  cambia el estado de una factura
      usp_registrar_certificacion guarda lo que responde SAT al certificar
      usp_registrar_rechazo       guarda un rechazo del certificador
      usp_anular_factura          anula una factura
      usp_registrar_cobro         registra un pago
      usp_anular_cobro            anula un pago
      usp_ajustar_inventario      entrada o ajuste manual de existencia
      usp_reporte_ventas, usp_corte_caja, usp_historial_factura   consultas con parametros
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Limpieza de procedimientos de versiones anteriores (si no existen, no pasa nada)
DROP PROCEDURE IF EXISTS dbo.usp_crear_documento;
GO


-- Antes existia usp_recalcular_saldo; sobraba (el trigger tr_factura_estado y los de cobros ya recalculan el saldo).
DROP PROCEDURE IF EXISTS dbo.usp_recalcular_saldo;
GO


/* ============================================================
   2. Mover inventario (la unica forma de cambiar la existencia)
   ============================================================
   @cantidad es positiva si ENTRA mercaderia y negativa si SALE.
   Hace tres cosas: revisa que alcance, guarda el movimiento en el kardex
   y actualiza la existencia del producto. */

CREATE OR ALTER PROCEDURE dbo.usp_mover_inventario
    @id_producto INT,
    @cantidad DECIMAL(18,4),
    @tipo NVARCHAR(20),
    @id_usuario INT = NULL,
    @id_factura BIGINT = NULL,
    @id_detalle BIGINT = NULL,
    @observacion NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;   -- si algo falla, se deshace todo lo que se hizo

    DECLARE @nombre NVARCHAR(160);
    DECLARE @controla_stock BIT;
    DECLARE @stock_actual DECIMAL(18,4);
    DECLARE @stock_nuevo DECIMAL(18,4);
    DECLARE @mensaje NVARCHAR(400);

    -- Paso 1: buscar el producto. UPDLOCK bloquea su fila para que otra
    -- persona no mueva el mismo producto al mismo tiempo.
    SELECT @nombre = nombre_producto,
           @controla_stock = controla_stock,
           @stock_actual = stock_actual
    FROM dbo.producto WITH (UPDLOCK)
    WHERE id_producto = @id_producto;

    IF @nombre IS NULL
        THROW 51101, 'Producto inexistente.', 1;

    IF @controla_stock = 0
        THROW 51020, 'No se puede mover inventario de un producto que no controla stock.', 1;

    -- Paso 2: calcular cuanto quedaria y rechazar si seria negativo
    SET @stock_nuevo = @stock_actual + @cantidad;

    IF @stock_nuevo < 0
    BEGIN
        SET @mensaje = CONCAT('Stock insuficiente: ', @nombre, ' (disponible ', CONVERT(NVARCHAR(30), @stock_actual),
                              ', requerido ', CONVERT(NVARCHAR(30), -@cantidad), ')');
        THROW 51021, @mensaje, 1;
    END;

    -- Paso 3: guardar el movimiento en el kardex
    INSERT INTO dbo.movimiento_inventario
        (id_producto, id_factura, id_detalle, id_usuario, tipo_movimiento, cantidad, stock_resultante, observacion)
    VALUES
        (@id_producto, @id_factura, @id_detalle, ISNULL(@id_usuario, dbo.fn_usuario_actual()),
         @tipo, @cantidad, @stock_nuevo, @observacion);

    -- Paso 4: actualizar la existencia del producto
    UPDATE dbo.producto
    SET stock_actual = @stock_nuevo
    WHERE id_producto = @id_producto;
END;
GO


/* ============================================================
   Efectos de certificar o anular una factura
   ============================================================
   Lo llama el trigger tr_factura_estado cuando una factura pasa a CERTIFICADA
   o cuando se anula una factura que estaba certificada. Hace dos cosas:
     1. mueve el inventario (usp_mover_inventario) de cada producto que lleva stock
     2. anota el cargo o abono en la cuenta corriente del cliente */

CREATE OR ALTER PROCEDURE dbo.usp_aplicar_efectos_factura
    @id_factura BIGINT,
    @estado_nuevo NVARCHAR(25)          -- CERTIFICADA o ANULADA
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @codigo_dte NVARCHAR(10);
    DECLARE @etiqueta NVARCHAR(100);
    DECLARE @signo_inventario SMALLINT;
    DECLARE @signo_saldo SMALLINT;
    DECLARE @id_cliente INT;
    DECLARE @total DECIMAL(18,2);

    -- Datos de la factura y de su tipo de documento (FACT, NCRE, NDEB...)
    SELECT @codigo_dte = s.codigo_dte,
           @etiqueta = CONCAT(s.codigo_dte, '-', s.serie_interna, ' #', f.numero_interno),
           @signo_inventario = t.signo_inventario,
           @signo_saldo = t.signo_saldo,
           @id_cliente = f.id_cliente,
           @total = f.total
    FROM dbo.factura f
    JOIN dbo.serie_documento s ON s.id_serie_documento = f.id_serie_documento
    JOIN dbo.tipo_dte t ON t.codigo_dte = s.codigo_dte
    WHERE f.id_factura = @id_factura;

    /* ---- 1. Inventario ----
       Al certificar una factura sale mercaderia (VENTA); una nota de credito la devuelve (DEVOLUCION).
       Al anular se hace lo contrario de lo que se hizo al certificar. */
    IF @signo_inventario <> 0
    BEGIN
        DECLARE @tipo NVARCHAR(20);
        DECLARE @multiplo SMALLINT;          -- -1 = sale mercaderia, 1 = entra
        DECLARE @id_detalle BIGINT;
        DECLARE @id_producto INT;
        DECLARE @cantidad DECIMAL(18,4);

        IF @estado_nuevo = 'CERTIFICADA' AND @signo_inventario = -1 SET @tipo = 'VENTA';
        ELSE IF @estado_nuevo = 'CERTIFICADA'                       SET @tipo = 'DEVOLUCION';
        ELSE IF @signo_inventario = -1                              SET @tipo = 'REVERSA_VENTA';
        ELSE                                                        SET @tipo = 'REVERSA_DEVOLUCION';

        SET @multiplo = CASE WHEN @tipo IN ('VENTA', 'REVERSA_DEVOLUCION') THEN -1 ELSE 1 END;

        -- Recorrer las lineas una por una (los servicios no llevan stock)
        SELECT @id_detalle = MIN(d.id_detalle)
        FROM dbo.detalle_factura d
        JOIN dbo.producto p ON p.id_producto = d.id_producto
        WHERE d.id_factura = @id_factura AND p.controla_stock = 1;

        WHILE @id_detalle IS NOT NULL
        BEGIN
            SELECT @id_producto = id_producto, @cantidad = cantidad
            FROM dbo.detalle_factura
            WHERE id_detalle = @id_detalle;

            SET @cantidad = @cantidad * @multiplo;

            EXEC dbo.usp_mover_inventario
                @id_producto = @id_producto,
                @cantidad = @cantidad,
                @tipo = @tipo,
                @id_factura = @id_factura,
                @id_detalle = @id_detalle,
                @observacion = @etiqueta;

            SELECT @id_detalle = MIN(d.id_detalle)
            FROM dbo.detalle_factura d
            JOIN dbo.producto p ON p.id_producto = d.id_producto
            WHERE d.id_factura = @id_factura AND p.controla_stock = 1
              AND d.id_detalle > @id_detalle;
        END;
    END;

    /* ---- 2. Cuenta corriente del cliente ----
       Factura o nota de debito = el cliente DEBE mas (cargo).
       Nota de credito = debe menos (abono). Anular = el movimiento contrario. */
    DECLARE @tipo_movimiento NVARCHAR(25);
    DECLARE @cargo DECIMAL(18,2) = 0;
    DECLARE @abono DECIMAL(18,2) = 0;

    IF @estado_nuevo = 'ANULADA'    SET @tipo_movimiento = 'ANULACION_DOCUMENTO';
    ELSE IF @codigo_dte = 'NCRE'    SET @tipo_movimiento = 'NOTA_CREDITO';
    ELSE IF @codigo_dte = 'NDEB'    SET @tipo_movimiento = 'NOTA_DEBITO';
    ELSE                            SET @tipo_movimiento = 'FACTURA';

    IF (@estado_nuevo = 'CERTIFICADA' AND @signo_saldo = 1)
       OR (@estado_nuevo = 'ANULADA' AND @signo_saldo = -1)
        SET @cargo = @total;
    ELSE
        SET @abono = @total;

    INSERT INTO dbo.movimiento_cliente
        (id_cliente, tipo_movimiento, id_factura, cargo, abono, descripcion, id_usuario)
    VALUES
        (@id_cliente, @tipo_movimiento, @id_factura, @cargo, @abono,
         CONCAT(CASE WHEN @estado_nuevo = 'ANULADA' THEN 'Anulacion ' ELSE '' END, @etiqueta),
         dbo.fn_usuario_actual());
END;
GO


/* ============================================================
   3. Crear una factura (queda en BORRADOR)
   ============================================================
   Toma el siguiente numero de la serie y crea la factura vacia.
   Despues se le agregan productos con usp_agregar_linea. */

CREATE OR ALTER PROCEDURE dbo.usp_crear_factura_borrador
    @id_negocio INT,
    @id_serie_documento INT,
    @id_cliente INT,
    @id_usuario INT,
    @condicion_pago NVARCHAR(10) = 'CONTADO',
    @fecha_vencimiento DATE = NULL,
    @id_factura_referencia BIGINT = NULL,      -- solo para notas de credito y debito
    @motivo_referencia NVARCHAR(500) = NULL,
    @id_factura BIGINT OUTPUT,                 -- aqui devuelve el id de la factura creada
    @numero_interno BIGINT OUTPUT              -- y aqui su numero
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @id_factura = NULL;
    SET @numero_interno = NULL;

    -- Guardar quien esta haciendo la operacion (lo usan los triggers para el historial)
    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    BEGIN TRANSACTION;

    -- Paso 1: sumar 1 al contador de la serie (si la serie no sirve, no actualiza nada)
    UPDATE dbo.serie_documento
    SET ultimo_numero = ultimo_numero + 1
    WHERE id_serie_documento = @id_serie_documento
      AND id_negocio = @id_negocio
      AND activa = 1;

    IF @@ROWCOUNT = 0
        THROW 51100, 'La serie no existe, esta inactiva o no pertenece al negocio.', 1;

    -- Paso 2: leer el numero que acaba de quedar (la fila sigue bloqueada, nadie mas la cambia)
    SELECT @numero_interno = ultimo_numero
    FROM dbo.serie_documento
    WHERE id_serie_documento = @id_serie_documento;

    -- Paso 3: crear la factura
    INSERT INTO dbo.factura
        (id_negocio, id_serie_documento, numero_interno, id_cliente, id_usuario,
         condicion_pago, fecha_vencimiento, id_factura_referencia, motivo_referencia)
    VALUES
        (@id_negocio, @id_serie_documento, @numero_interno, @id_cliente, @id_usuario,
         @condicion_pago, @fecha_vencimiento, @id_factura_referencia, @motivo_referencia);

    SET @id_factura = SCOPE_IDENTITY();

    COMMIT TRANSACTION;
END;
GO


/* ============================================================
   4. Agregar un producto a una factura
   ============================================================
   Copia el nombre, la unidad, el precio y el IVA del producto a la linea.
   Si cambias el producto despues, la factura ya emitida no cambia.
   Los totales de la factura los recalcula un trigger. */

CREATE OR ALTER PROCEDURE dbo.usp_agregar_linea
    @id_factura BIGINT,
    @id_producto INT,
    @cantidad DECIMAL(18,4),
    @id_usuario INT,
    @descuento_linea DECIMAL(18,2) = 0,
    @precio_unitario DECIMAL(18,2) = NULL,     -- si no se indica, se usa el precio del producto
    @id_detalle BIGINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    INSERT INTO dbo.detalle_factura
        (id_factura, id_producto, descripcion, codigo_unidad, tipo_item,
         cantidad, precio_unitario, descuento_linea, tasa_iva)
    SELECT @id_factura, p.id_producto, p.nombre_producto, p.codigo_unidad, p.tipo_item,
           @cantidad, ISNULL(@precio_unitario, p.precio_venta), @descuento_linea, p.tasa_iva
    FROM dbo.producto p
    WHERE p.id_producto = @id_producto
      AND p.activo = 1;

    IF @@ROWCOUNT = 0
        THROW 51101, 'Producto inexistente o inactivo.', 1;

    SET @id_detalle = SCOPE_IDENTITY();
END;
GO


/* ============================================================
   5. Cambiar el estado de una factura
   ============================================================
   Ejemplo: de BORRADOR a PENDIENTE_CERTIFICACION.
   El trigger de la factura revisa que el cambio este permitido. */

CREATE OR ALTER PROCEDURE dbo.usp_cambiar_estado_factura
    @id_factura BIGINT,
    @estado_nuevo NVARCHAR(25),
    @id_usuario INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    UPDATE dbo.factura
    SET estado = @estado_nuevo
    WHERE id_factura = @id_factura;

    IF @@ROWCOUNT = 0
        THROW 51102, 'Factura inexistente.', 1;
END;
GO


/* ============================================================
   6. SAT / FEL: guardar la certificacion
   ============================================================
   Se llama cuando el certificador (Infile, etc.) responde que SI certifico.
   Guarda el UUID, la serie y el numero que asigna SAT, y deja el intento
   anotado en factura_fel. Al pasar a CERTIFICADA, un trigger mueve el
   inventario y carga la deuda al cliente. */

CREATE OR ALTER PROCEDURE dbo.usp_registrar_certificacion
    @id_factura BIGINT,
    @id_usuario INT,
    @uuid_fel NVARCHAR(80),
    @serie_fel NVARCHAR(40),
    @numero_fel NVARCHAR(40),
    @fecha_certificacion DATETIMEOFFSET(0),
    @xml_fel_hash VARBINARY(32) = NULL,
    @xml_enviado XML = NULL,
    @xml_respuesta XML = NULL,
    @url_xml NVARCHAR(500) = NULL,       -- donde se guardo el XML certificado
    @url_pdf NVARCHAR(500) = NULL        -- donde se guardo el PDF
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @intento INT;

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    BEGIN TRANSACTION;

    -- Numero de intento = cuantos intentos de certificacion hubo antes + 1
    SELECT @intento = ISNULL(MAX(intento), 0) + 1
    FROM dbo.factura_fel
    WHERE id_factura = @id_factura
      AND tipo_evento = 'CERTIFICACION';

    UPDATE dbo.factura
    SET estado = 'CERTIFICADA',
        uuid_fel = @uuid_fel,
        serie_fel = @serie_fel,
        numero_fel = @numero_fel,
        fecha_certificacion = @fecha_certificacion,
        xml_fel_hash = @xml_fel_hash,
        url_xml = @url_xml,
        url_pdf = @url_pdf
    WHERE id_factura = @id_factura;

    IF @@ROWCOUNT = 0
        THROW 51103, 'Factura inexistente.', 1;

    INSERT INTO dbo.factura_fel
        (id_factura, tipo_evento, intento, exito, xml_enviado, xml_respuesta, codigo_respuesta)
    VALUES
        (@id_factura, 'CERTIFICACION', @intento, 1, @xml_enviado, @xml_respuesta, 'OK');

    COMMIT TRANSACTION;
END;
GO


/* ============================================================
   7. SAT / FEL: guardar un rechazo
   ============================================================
   Se llama cuando el certificador responde que NO certifico.
   La factura queda RECHAZADA y se puede corregir y volver a enviar. */

CREATE OR ALTER PROCEDURE dbo.usp_registrar_rechazo
    @id_factura BIGINT,
    @id_usuario INT,
    @codigo_respuesta NVARCHAR(40) = NULL,
    @mensaje NVARCHAR(2000) = NULL,
    @xml_enviado XML = NULL,
    @xml_respuesta XML = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @intento INT;

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    BEGIN TRANSACTION;

    SELECT @intento = ISNULL(MAX(intento), 0) + 1
    FROM dbo.factura_fel
    WHERE id_factura = @id_factura
      AND tipo_evento = 'CERTIFICACION';

    UPDATE dbo.factura
    SET estado = 'RECHAZADA'
    WHERE id_factura = @id_factura;

    IF @@ROWCOUNT = 0
        THROW 51103, 'Factura inexistente.', 1;

    INSERT INTO dbo.factura_fel
        (id_factura, tipo_evento, intento, exito, xml_enviado, xml_respuesta, codigo_respuesta, mensaje)
    VALUES
        (@id_factura, 'CERTIFICACION', @intento, 0, @xml_enviado, @xml_respuesta, @codigo_respuesta, @mensaje);

    COMMIT TRANSACTION;
END;
GO


/* ============================================================
   8. SAT / FEL: anular una factura
   ============================================================
   Si la factura ya estaba certificada, SAT debe confirmar la anulacion y
   hay que guardar su UUID de anulacion (@uuid_anulacion).
   Al anular, un trigger devuelve la mercaderia al inventario. */

CREATE OR ALTER PROCEDURE dbo.usp_anular_factura
    @id_factura BIGINT,
    @id_usuario INT,
    @motivo NVARCHAR(500),
    @uuid_anulacion NVARCHAR(80) = NULL,
    @fecha_anulacion_fel DATETIMEOFFSET(0) = NULL,
    @xml_enviado XML = NULL,
    @xml_respuesta XML = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @intento INT;

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    BEGIN TRANSACTION;

    SELECT @intento = ISNULL(MAX(intento), 0) + 1
    FROM dbo.factura_fel
    WHERE id_factura = @id_factura
      AND tipo_evento = 'ANULACION';

    UPDATE dbo.factura
    SET estado = 'ANULADA',
        motivo_anulacion = @motivo,
        anulada_en = dbo.fn_ahora_utc(),
        id_usuario_anula = @id_usuario,
        uuid_anulacion = @uuid_anulacion,
        fecha_anulacion_fel = @fecha_anulacion_fel
    WHERE id_factura = @id_factura;

    IF @@ROWCOUNT = 0
        THROW 51103, 'Factura inexistente.', 1;

    -- Solo se anota en factura_fel si SAT confirmo la anulacion
    IF @uuid_anulacion IS NOT NULL
        INSERT INTO dbo.factura_fel
            (id_factura, tipo_evento, intento, exito, xml_enviado, xml_respuesta, codigo_respuesta)
        VALUES
            (@id_factura, 'ANULACION', @intento, 1, @xml_enviado, @xml_respuesta, 'OK');

    COMMIT TRANSACTION;
END;
GO


/* ============================================================
   9. Registrar un cobro (pago)
   ============================================================
   Dos formas de usarlo:
     - Con @id_factura: el pago se aplica a esa factura.
     - Sin @id_factura (pero con @id_cliente): el pago se reparte entre las facturas
       pendientes del cliente, empezando por la mas antigua.
   Si sobra dinero, el cobro queda con saldo a favor. */

CREATE OR ALTER PROCEDURE dbo.usp_registrar_cobro
    @id_usuario INT,
    @codigo_metodo NVARCHAR(20),
    @monto DECIMAL(18,2),
    @id_cliente INT = NULL,
    @id_factura BIGINT = NULL,
    @referencia NVARCHAR(100) = NULL,
    @observaciones NVARCHAR(500) = NULL,
    @id_cobro BIGINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @saldo DECIMAL(18,2);
    DECLARE @cliente_factura INT;
    DECLARE @restante DECIMAL(18,2);
    DECLARE @factura_pendiente BIGINT;
    DECLARE @saldo_pendiente DECIMAL(18,2);
    DECLARE @a_aplicar DECIMAL(18,2);

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    BEGIN TRANSACTION;

    -- Paso 1: si el pago es para una factura concreta, revisar que se pueda cobrar
    IF @id_factura IS NOT NULL
    BEGIN
        SELECT @saldo = saldo_pendiente,
               @cliente_factura = id_cliente
        FROM dbo.factura WITH (UPDLOCK)       -- bloquea la fila: dos cajeros no cobran lo mismo a la vez
        WHERE id_factura = @id_factura
          AND estado = 'CERTIFICADA'
          AND estado_pago <> 'NO_APLICA';

        IF @cliente_factura IS NULL
            THROW 51110, 'La factura no existe o no admite cobros.', 1;

        IF @id_cliente IS NOT NULL AND @id_cliente <> @cliente_factura
            THROW 51111, 'La factura es de otro cliente.', 1;

        IF @monto > @saldo
            THROW 51112, 'El monto excede el saldo pendiente de la factura.', 1;

        SET @id_cliente = @cliente_factura;
    END;

    IF @id_cliente IS NULL
        THROW 51113, 'Indique el cliente o la factura.', 1;

    -- Paso 2: guardar el cobro (el recibo)
    INSERT INTO dbo.cobro (id_cliente, id_usuario, monto, codigo_metodo, referencia, observaciones)
    VALUES (@id_cliente, @id_usuario, @monto, @codigo_metodo, @referencia, @observaciones);

    SET @id_cobro = SCOPE_IDENTITY();

    -- Paso 3: aplicar el cobro a la(s) factura(s)
    IF @id_factura IS NOT NULL
    BEGIN
        -- Un solo destino: toda la cantidad va a esa factura
        INSERT INTO dbo.cobro_aplicacion (id_cobro, id_factura, id_cliente, monto)
        VALUES (@id_cobro, @id_factura, @id_cliente, @monto);
    END
    ELSE
    BEGIN
        -- Varios destinos: repartir entre las facturas pendientes, la mas antigua primero
        SET @restante = @monto;

        WHILE @restante > 0
        BEGIN
            SET @factura_pendiente = NULL;

            -- Buscar la factura pendiente mas antigua que todavia no recibio parte de este cobro
            SELECT TOP 1
                   @factura_pendiente = f.id_factura,
                   @saldo_pendiente = f.saldo_pendiente
            FROM dbo.factura f WITH (UPDLOCK)
            WHERE f.id_cliente = @id_cliente
              AND f.estado = 'CERTIFICADA'
              AND f.saldo_pendiente > 0
              AND NOT EXISTS (SELECT 1 FROM dbo.cobro_aplicacion a
                              WHERE a.id_cobro = @id_cobro AND a.id_factura = f.id_factura)
            ORDER BY ISNULL(f.fecha_vencimiento, dbo.fn_dia_gt(f.fecha_emision)), f.id_factura;

            -- Si ya no hay facturas pendientes, lo que sobra queda como saldo a favor
            IF @factura_pendiente IS NULL
                BREAK;

            -- Aplicar lo que alcance: el saldo de la factura o lo que quede del cobro (lo menor)
            IF @saldo_pendiente < @restante
                SET @a_aplicar = @saldo_pendiente;
            ELSE
                SET @a_aplicar = @restante;

            INSERT INTO dbo.cobro_aplicacion (id_cobro, id_factura, id_cliente, monto)
            VALUES (@id_cobro, @factura_pendiente, @id_cliente, @a_aplicar);

            SET @restante = @restante - @a_aplicar;
        END;
    END;

    COMMIT TRANSACTION;
END;
GO


/* ============================================================
   10. Anular un cobro
   ============================================================
   El cobro no se borra: queda marcado como ANULADO. Un trigger devuelve
   el importe a la deuda de la factura. */

CREATE OR ALTER PROCEDURE dbo.usp_anular_cobro
    @id_cobro BIGINT,
    @id_usuario INT,
    @motivo NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    UPDATE dbo.cobro
    SET estado = 'ANULADO',
        anulado_en = dbo.fn_ahora_utc(),
        id_usuario_anula = @id_usuario,
        motivo_anulacion = @motivo
    WHERE id_cobro = @id_cobro
      AND estado = 'APLICADO';

    IF @@ROWCOUNT = 0
        THROW 51114, 'El cobro no existe o ya esta anulado.', 1;
END;
GO


/* ============================================================
   11. Ajustar inventario a mano
   ============================================================
   ENTRADA: compras o existencia inicial (cantidad positiva).
   AJUSTE: correcciones (positiva suma, negativa resta: mermas, conteos). */

CREATE OR ALTER PROCEDURE dbo.usp_ajustar_inventario
    @id_producto INT,
    @cantidad DECIMAL(18,4),
    @tipo NVARCHAR(10),
    @id_usuario INT,
    @observacion NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    EXEC sys.sp_set_session_context @key = N'id_usuario', @value = @id_usuario;

    IF @tipo NOT IN ('ENTRADA', 'AJUSTE')
        THROW 51120, 'Tipo invalido: use ENTRADA o AJUSTE.', 1;

    IF @tipo = 'ENTRADA' AND @cantidad <= 0
        THROW 51121, 'Una ENTRADA requiere cantidad positiva.', 1;

    EXEC dbo.usp_mover_inventario
        @id_producto = @id_producto,
        @cantidad = @cantidad,
        @tipo = @tipo,
        @id_usuario = @id_usuario,
        @observacion = @observacion;
END;
GO


/* ============================================================
   REPORTES (consultas con parametros)
   ============================================================ */

-- Ventas por dia entre dos fechas (las notas de credito ya vienen restando)
CREATE OR ALTER PROCEDURE dbo.usp_reporte_ventas
    @desde DATE,
    @hasta DATE
AS
BEGIN
    SET NOCOUNT ON;

    SELECT fecha,
           COUNT(*) AS documentos,
           SUM(subtotal_gravado) AS subtotal_gravado,
           SUM(subtotal_exento) AS subtotal_exento,
           SUM(iva) AS iva,
           SUM(total) AS total
    FROM dbo.vw_libro_ventas
    WHERE fecha BETWEEN @desde AND @hasta
    GROUP BY fecha
    ORDER BY fecha;
END;
GO

-- Corte de caja: lo cobrado en un dia, por cajero y metodo de pago
CREATE OR ALTER PROCEDURE dbo.usp_corte_caja
    @fecha DATE,
    @id_usuario INT = NULL        -- si no se indica, trae todos los cajeros
AS
BEGIN
    SET NOCOUNT ON;

    SELECT fecha, nombre_usuario, codigo_metodo, cantidad, total
    FROM dbo.vw_corte_caja
    WHERE fecha = @fecha
      AND (@id_usuario IS NULL OR id_usuario = @id_usuario)
    ORDER BY nombre_usuario, codigo_metodo;
END;
GO

-- Todo lo que le paso a una factura: cambios de estado, cobros y movimientos de inventario
CREATE OR ALTER PROCEDURE dbo.usp_historial_factura
    @id_factura BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    -- Cambios de estado
    SELECT 'ESTADO' AS origen,
           h.fecha,
           ISNULL(h.estado_anterior, '(nuevo)') + ' -> ' + h.estado_nuevo AS descripcion,
           u.nombre_usuario,
           h.motivo AS detalle
    FROM dbo.historial_estado_factura h
    LEFT JOIN dbo.usuario u ON u.id_usuario = h.id_usuario
    WHERE h.id_factura = @id_factura

    UNION ALL

    -- Cobros aplicados a la factura
    SELECT 'COBRO',
           co.fecha_cobro,
           CONCAT('Cobro #', co.id_cobro, ' ', co.codigo_metodo, ' Q', ca.monto, ' (', co.estado, ')'),
           u.nombre_usuario,
           co.referencia
    FROM dbo.cobro_aplicacion ca
    JOIN dbo.cobro co ON co.id_cobro = ca.id_cobro
    JOIN dbo.usuario u ON u.id_usuario = co.id_usuario
    WHERE ca.id_factura = @id_factura

    UNION ALL

    -- Movimientos de inventario de la factura
    SELECT 'INVENTARIO',
           k.fecha_movimiento,
           CONCAT(k.tipo_movimiento, ' ', p.nombre_producto, ' ', k.cantidad),
           u.nombre_usuario,
           NULL
    FROM dbo.movimiento_inventario k
    JOIN dbo.producto p ON p.id_producto = k.id_producto
    LEFT JOIN dbo.usuario u ON u.id_usuario = k.id_usuario
    WHERE k.id_factura = @id_factura

    ORDER BY fecha;
END;
GO
