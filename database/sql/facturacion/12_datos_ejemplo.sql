/*
    DATOS DE EJEMPLO: un pequeño negocio (tienda de abarrotes "La Esquina")
    Requiere haber ejecutado: 00 a 07 y 10 (incluye el certificador simulado, 06).

    Todo es FICTICIO (NIT, nombres, telefonos). Las facturas se "certifican" con el certificador
    simulado (serie_fel = 'SIM'), no tienen validez fiscal.

    Importante: facturas, cobros y kardex son historiales que no se pueden borrar. Ejecutalo
    UNA sola vez; si ya hay un negocio con ese NIT, no hace nada. Todo se hace en una transaccion:
    si algo falla, no queda nada.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF EXISTS (SELECT 1 FROM dbo.negocio WHERE nit = '1234567-8')
BEGIN
    PRINT 'Los datos de ejemplo ya estan cargados. No se hizo nada.';
    RETURN;
END;

BEGIN TRY
BEGIN TRANSACTION;

DECLARE @u INT = (SELECT id_usuario FROM dbo.usuario WHERE nombre_usuario = 'hcoc');
IF @u IS NULL SET @u = (SELECT TOP 1 id_usuario FROM dbo.usuario ORDER BY id_usuario);
IF @u IS NULL
    THROW 51900, 'Primero crea un usuario en dbo.usuario (con la contrasena como hash argon2id) y vuelve a ejecutar este archivo.', 1;
EXEC sys.sp_set_session_context N'id_usuario', @u;

/* ---------- 1. El negocio y sus series ---------- */
INSERT INTO dbo.negocio (nit, razon_social, nombre_comercial, direccion, municipio, departamento, afiliacion_iva, ambiente_fel)
VALUES ('1234567-8', 'Abarrotes La Esquina, S.A.', 'Abarrotes La Esquina', '4a. Avenida 5-20 Zona 1', 'Guatemala', 'Guatemala', 'GENERAL', 'CERTIFICACION');
DECLARE @neg INT = SCOPE_IDENTITY();

INSERT INTO dbo.serie_documento (id_negocio, codigo_dte, serie_interna) VALUES (@neg, 'FACT', 'A');
DECLARE @sf INT = SCOPE_IDENTITY();
INSERT INTO dbo.serie_documento (id_negocio, codigo_dte, serie_interna) VALUES (@neg, 'NCRE', 'A');
DECLARE @sn INT = SCOPE_IDENTITY();

/* ---------- 2. Clientes ---------- */
DECLARE @cf INT = (SELECT id_cliente FROM dbo.cliente WHERE documento_norm = 'CF');   -- Consumidor Final (ya existe)

INSERT INTO dbo.cliente (nombre_cliente, tipo_documento, documento, correo, telefono, direccion, municipio, departamento) VALUES
 ('Maria Lopez Perez',        'NIT', '4587123-6', 'maria.lopez@ejemplo.com',   '55512345', '3a. Calle 7-15 Zona 3',  'Guatemala', 'Guatemala'),
 ('Restaurante El Fogon, S.A.','NIT', '9988776-K', 'compras@elfogon.example',   '22334455', 'Calzada Roosevelt 22-10', 'Mixco',     'Guatemala'),
 ('Carlos Hernandez Ruiz',    'NIT', '1122334-5', 'carlos.h@ejemplo.com',      '44556677', '5a. Avenida 10-30 Zona 6','Guatemala', 'Guatemala'),
 ('Panaderia Santa Ana',      'NIT', '5566778-9', NULL,                         '77889900', 'Calle Real 4-12',         'Villa Nueva','Guatemala'),
 ('Ana Sofia Morales',        'CUI', '2415678900101', 'ana.morales@ejemplo.com','33221100', '6a. Calle 2-45 Zona 11', 'Guatemala', 'Guatemala');
DECLARE @maria INT = (SELECT id_cliente FROM dbo.cliente WHERE documento_norm = '45871236');
DECLARE @fogon INT = (SELECT id_cliente FROM dbo.cliente WHERE documento_norm = '9988776K');
DECLARE @carlos INT = (SELECT id_cliente FROM dbo.cliente WHERE documento_norm = '11223345');
DECLARE @pan   INT = (SELECT id_cliente FROM dbo.cliente WHERE documento_norm = '55667789');

/* ---------- 3. Productos (precio con IVA incluido) ---------- */
INSERT INTO dbo.producto (sku, nombre_producto, codigo_unidad, tipo_item, precio_venta, controla_stock, stock_minimo) VALUES
 ('ARR-001', 'Arroz blanco',              'LB',  'BIEN',     4.50, 1, 30),
 ('FRI-001', 'Frijol negro',              'LB',  'BIEN',     6.00, 1, 30),
 ('AZU-001', 'Azucar',                    'LB',  'BIEN',     3.75, 1, 40),
 ('ACE-001', 'Aceite vegetal 1 litro',    'LT',  'BIEN',    22.00, 1, 12),
 ('HUE-001', 'Huevos (cartera de 30)',    'UNI', 'BIEN',    42.00, 1, 10),
 ('LEC-001', 'Leche entera 1 litro',      'LT',  'BIEN',    10.50, 1, 20),
 ('PAN-001', 'Pan de caja',               'UNI', 'BIEN',    16.00, 1, 10),
 ('GAS-001', 'Gaseosa 2 litros',          'UNI', 'BIEN',    14.00, 1, 24),
 ('JAB-001', 'Jabon de bano',             'UNI', 'BIEN',     5.50, 1, 20),
 ('DET-001', 'Detergente en polvo 1 kg',  'UNI', 'BIEN',    18.00, 1, 10),
 ('PAP-001', 'Papel higienico (4 rollos)','UNI', 'BIEN',    12.00, 1, 15),
 ('CAF-001', 'Cafe molido 1 libra',       'LB',  'BIEN',    28.00, 1, 10),
 ('HAR-001', 'Harina de trigo',           'LB',  'BIEN',     4.00, 1, 40),
 ('SAL-001', 'Sal',                       'LB',  'BIEN',     2.00, 1, 20);
INSERT INTO dbo.producto (sku, nombre_producto, codigo_unidad, tipo_item, precio_venta, controla_stock, stock_minimo)
VALUES ('SRV-001', 'Entrega a domicilio', 'SRV', 'SERVICIO', 15.00, 0, 0);

/* ---------- 4. Existencia inicial (entradas al kardex) ---------- */
DECLARE @p INT, @cant DECIMAL(18,4);
DECLARE c_stock CURSOR LOCAL FOR
    SELECT id_producto, CASE sku
        WHEN 'ARR-001' THEN 200 WHEN 'FRI-001' THEN 150 WHEN 'AZU-001' THEN 250 WHEN 'ACE-001' THEN 60
        WHEN 'HUE-001' THEN 40  WHEN 'LEC-001' THEN 80  WHEN 'PAN-001' THEN 30  WHEN 'GAS-001' THEN 72
        WHEN 'JAB-001' THEN 100 WHEN 'DET-001' THEN 40  WHEN 'PAP-001' THEN 60  WHEN 'CAF-001' THEN 35
        WHEN 'HAR-001' THEN 180 WHEN 'SAL-001' THEN 90 END
    FROM dbo.producto WHERE controla_stock = 1;
OPEN c_stock;
FETCH NEXT FROM c_stock INTO @p, @cant;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC dbo.usp_ajustar_inventario @p, @cant, 'ENTRADA', @u, 'Existencia inicial';
    FETCH NEXT FROM c_stock INTO @p, @cant;
END;
CLOSE c_stock; DEALLOCATE c_stock;

/* ---------- 5. Ventas ---------- */
-- Atajos para encontrar productos por sku
DECLARE @arroz INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'ARR-001');
DECLARE @frijol INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'FRI-001');
DECLARE @azucar INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'AZU-001');
DECLARE @aceite INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'ACE-001');
DECLARE @huevos INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'HUE-001');
DECLARE @leche INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'LEC-001');
DECLARE @pancaja INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'PAN-001');
DECLARE @gaseosa INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'GAS-001');
DECLARE @detergente INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'DET-001');
DECLARE @cafe INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'CAF-001');
DECLARE @harina INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'HAR-001');
DECLARE @entrega INT = (SELECT id_producto FROM dbo.producto WHERE sku = 'SRV-001');

DECLARE @f BIGINT, @num BIGINT, @det BIGINT, @cobro BIGINT, @total DECIMAL(18,2);
DECLARE @vence DATE = DATEADD(DAY, 15, CAST(SYSDATETIMEOFFSET() AS DATE));
DECLARE @f2 BIGINT;   -- factura de Maria (se usa luego para la nota de credito)

-- V1: consumidor final, contado, efectivo
EXEC dbo.usp_crear_factura_borrador @neg, @sf, @cf, @u, 'CONTADO', NULL, NULL, NULL, @f OUTPUT, @num OUTPUT;
EXEC dbo.usp_agregar_linea @f, @arroz,  5, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @azucar, 3, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @leche,  2, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @f, @u;
SELECT @total = total FROM dbo.factura WHERE id_factura = @f;
EXEC dbo.usp_registrar_cobro @u, 'EFECTIVO', @total, NULL, @f, NULL, NULL, @cobro OUTPUT;

-- V2: Maria, contado, tarjeta
EXEC dbo.usp_crear_factura_borrador @neg, @sf, @maria, @u, 'CONTADO', NULL, NULL, NULL, @f OUTPUT, @num OUTPUT;
SET @f2 = @f;
EXEC dbo.usp_agregar_linea @f, @aceite,  2, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @huevos,  1, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @pancaja, 1, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @cafe,    1, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @f, @u;
SELECT @total = total FROM dbo.factura WHERE id_factura = @f;
EXEC dbo.usp_registrar_cobro @u, 'TARJETA', @total, NULL, @f, 'AUT-004511', NULL, @cobro OUTPUT;

-- V3: Restaurante El Fogon, a credito (15 dias), pago parcial por transferencia
EXEC dbo.usp_crear_factura_borrador @neg, @sf, @fogon, @u, 'CREDITO', @vence, NULL, NULL, @f OUTPUT, @num OUTPUT;
EXEC dbo.usp_agregar_linea @f, @arroz,  40, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @frijol, 30, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @aceite, 12, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @harina, 50, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @entrega, 1, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @f, @u;
EXEC dbo.usp_registrar_cobro @u, 'TRANSFERENCIA', 500, NULL, @f, 'TRF-778812', 'Anticipo', @cobro OUTPUT;

-- V4: Panaderia Santa Ana, a credito, sin pago todavia
EXEC dbo.usp_crear_factura_borrador @neg, @sf, @pan, @u, 'CREDITO', @vence, NULL, NULL, @f OUTPUT, @num OUTPUT;
EXEC dbo.usp_agregar_linea @f, @harina, 60, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @azucar, 40, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @f, @u;

-- V5: Carlos, a credito, abono en efectivo
EXEC dbo.usp_crear_factura_borrador @neg, @sf, @carlos, @u, 'CREDITO', @vence, NULL, NULL, @f OUTPUT, @num OUTPUT;
EXEC dbo.usp_agregar_linea @f, @gaseosa,    24, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @detergente,  6, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @cafe,        3, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @f, @u;
EXEC dbo.usp_registrar_cobro @u, 'EFECTIVO', 100, NULL, @f, NULL, 'Abono', @cobro OUTPUT;

-- V6: consumidor final, contado, efectivo
EXEC dbo.usp_crear_factura_borrador @neg, @sf, @cf, @u, 'CONTADO', NULL, NULL, NULL, @f OUTPUT, @num OUTPUT;
EXEC dbo.usp_agregar_linea @f, @pancaja, 2, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @gaseosa, 2, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_agregar_linea @f, @leche,   3, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @f, @u;
SELECT @total = total FROM dbo.factura WHERE id_factura = @f;
EXEC dbo.usp_registrar_cobro @u, 'EFECTIVO', @total, NULL, @f, NULL, NULL, @cobro OUTPUT;

-- V7: una factura que se emite y luego se anula (error del cajero)
EXEC dbo.usp_crear_factura_borrador @neg, @sf, @cf, @u, 'CONTADO', NULL, NULL, NULL, @f OUTPUT, @num OUTPUT;
EXEC dbo.usp_agregar_linea @f, @huevos, 2, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @f, @u;
EXEC dbo.usp_anular_simulado @f, @u, 'Cliente se equivoco de pedido';

-- Un cobro sin indicar factura: se reparte entre las mas antiguas del cliente (Panaderia, por FIFO)
EXEC dbo.usp_registrar_cobro @u, 'DEPOSITO', 300, @pan, NULL, 'BOL-90321', 'Pago a cuenta', @cobro OUTPUT;

-- Nota de credito: Maria devuelve 1 aceite de la factura V2
DECLARE @nc BIGINT;
EXEC dbo.usp_crear_factura_borrador @neg, @sn, @maria, @u, 'CONTADO', NULL, @f2, 'Devolucion de 1 aceite', @nc OUTPUT, @num OUTPUT;
EXEC dbo.usp_agregar_linea @nc, @aceite, 1, @u, 0, NULL, @det OUTPUT;
EXEC dbo.usp_certificar_simulado @nc, @u;

COMMIT TRANSACTION;
PRINT 'Datos de ejemplo cargados.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT CONCAT('ERROR ', ERROR_NUMBER(), ': ', ERROR_MESSAGE(), ' (linea ', ERROR_LINE(), '). No se guardo nada.');
END CATCH;
GO
