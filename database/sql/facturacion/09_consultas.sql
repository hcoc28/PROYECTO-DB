/*
    Consultas de ejemplo (solo leen datos, no modifican nada)
    Cada una usa JOIN y/o funciones de agregacion (COUNT, SUM, AVG, MAX, MIN).
    Se pueden ejecutar una por una en SSMS.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1) Ventas certificadas por cliente: cuantas facturas y cuanto se les ha vendido (JOIN + COUNT + SUM)
SELECT c.nombre_cliente,
       COUNT(f.id_factura) AS facturas,
       SUM(f.total)        AS total_vendido
FROM dbo.cliente c
JOIN dbo.factura f ON f.id_cliente = c.id_cliente
WHERE f.estado = 'CERTIFICADA'
GROUP BY c.nombre_cliente
ORDER BY total_vendido DESC;

-- 2) Productos mas vendidos (JOIN de 3 tablas + SUM)
SELECT p.nombre_producto,
       SUM(d.cantidad)    AS unidades_vendidas,
       SUM(d.total_linea) AS ingreso
FROM dbo.detalle_factura d
JOIN dbo.producto p ON p.id_producto = d.id_producto
JOIN dbo.factura  f ON f.id_factura  = d.id_factura
WHERE f.estado = 'CERTIFICADA'
GROUP BY p.nombre_producto
ORDER BY unidades_vendidas DESC;

-- 3) Promedio, maximo y minimo del total de las facturas certificadas (AVG, MAX, MIN)
SELECT COUNT(*)     AS facturas,
       AVG(total)   AS promedio,
       MAX(total)   AS la_mas_grande,
       MIN(total)   AS la_mas_pequena
FROM dbo.factura
WHERE estado = 'CERTIFICADA';

-- 4) Cartera: clientes que deben dinero (facturas certificadas con saldo pendiente)
SELECT c.nombre_cliente,
       COUNT(*)                AS facturas_con_saldo,
       SUM(f.saldo_pendiente)  AS total_adeudado
FROM dbo.factura f
JOIN dbo.cliente c ON c.id_cliente = f.id_cliente
WHERE f.estado = 'CERTIFICADA' AND f.saldo_pendiente > 0
GROUP BY c.nombre_cliente
HAVING SUM(f.saldo_pendiente) > 0
ORDER BY total_adeudado DESC;

-- 5) Facturas a credito vencidas y cuantos dias llevan de atraso
SELECT f.id_factura, c.nombre_cliente, f.fecha_vencimiento, f.saldo_pendiente,
       DATEDIFF(DAY, f.fecha_vencimiento, SYSDATETIMEOFFSET()) AS dias_de_atraso
FROM dbo.factura f
JOIN dbo.cliente c ON c.id_cliente = f.id_cliente
WHERE f.estado = 'CERTIFICADA'
  AND f.saldo_pendiente > 0
  AND f.fecha_vencimiento < CAST(SYSDATETIMEOFFSET() AS DATE)
ORDER BY dias_de_atraso DESC;

-- 6) Cobros recibidos por metodo de pago (no cuenta los anulados)
SELECT m.nombre AS metodo,
       COUNT(*)      AS cobros,
       SUM(b.monto)  AS total_cobrado
FROM dbo.cobro b
JOIN dbo.metodo_pago m ON m.codigo = b.codigo_metodo
WHERE b.estado <> 'ANULADO'
GROUP BY m.nombre
ORDER BY total_cobrado DESC;

-- 7) Ventas por mes (agrupa por anio y mes)
SELECT YEAR(fecha_emision)  AS anio,
       MONTH(fecha_emision) AS mes,
       COUNT(*)             AS facturas,
       SUM(total)           AS total
FROM dbo.factura
WHERE estado = 'CERTIFICADA'
GROUP BY YEAR(fecha_emision), MONTH(fecha_emision)
ORDER BY anio, mes;

-- 8) Productos con existencia por debajo del minimo (los que hay que reabastecer)
SELECT nombre_producto, stock_actual, stock_minimo
FROM dbo.producto
WHERE controla_stock = 1
  AND activo = 1
  AND stock_actual <= stock_minimo
ORDER BY stock_actual;

-- 9) Facturas por tipo de documento (factura, nota de credito...) con su total (JOIN + GROUP BY)
SELECT t.nombre AS tipo_documento,
       COUNT(f.id_factura) AS cantidad,
       SUM(f.total)        AS total
FROM dbo.factura f
JOIN dbo.serie_documento s ON s.id_serie_documento = f.id_serie_documento
JOIN dbo.tipo_dte        t ON t.codigo_dte         = s.codigo_dte
GROUP BY t.nombre
ORDER BY cantidad DESC;

-- 10) Cuantas facturas ha creado cada usuario, con su rol (JOIN de 3 tablas)
SELECT u.nombre_usuario, r.nombre_rol, COUNT(f.id_factura) AS facturas_creadas
FROM dbo.usuario u
JOIN dbo.rol r ON r.id_rol = u.id_rol
LEFT JOIN dbo.factura f ON f.id_usuario = u.id_usuario
GROUP BY u.nombre_usuario, r.nombre_rol
ORDER BY facturas_creadas DESC;

-- 11) Facturas anuladas, con quien las anulo y por que (JOIN con usuario)
SELECT f.id_factura, f.total, f.anulada_en, u.nombre_usuario AS anulada_por, f.motivo_anulacion
FROM dbo.factura f
JOIN dbo.usuario u ON u.id_usuario = f.id_usuario_anula
WHERE f.estado = 'ANULADA'
ORDER BY f.anulada_en DESC;

-- 12) Movimientos de un producto (kardex) con el usuario que los hizo
SELECT TOP 20 p.nombre_producto, m.fecha_movimiento, m.tipo_movimiento, m.cantidad,
       m.stock_resultante, u.nombre_usuario
FROM dbo.movimiento_inventario m
JOIN dbo.producto p ON p.id_producto = m.id_producto
LEFT JOIN dbo.usuario u ON u.id_usuario = m.id_usuario
ORDER BY m.fecha_movimiento DESC;

-- 13) AUDITORIA: quien consulto informacion sensible en los ultimos 7 dias
SELECT u.nombre_usuario, b.accion, COUNT(*) AS veces, MAX(b.fecha) AS ultima_vez
FROM dbo.bitacora b
JOIN dbo.usuario u ON u.id_usuario = b.id_usuario
WHERE b.accion LIKE 'LEER_%'
  AND b.fecha >= DATEADD(DAY, -7, SYSDATETIMEOFFSET())
GROUP BY u.nombre_usuario, b.accion
ORDER BY veces DESC;

-- 14) AUDITORIA: intentos de inicio de sesion fallidos por usuario (posible fuerza bruta)
SELECT u.nombre_usuario, COUNT(*) AS intentos_fallidos, MAX(b.fecha) AS ultimo_intento
FROM dbo.bitacora b
JOIN dbo.usuario u ON u.id_usuario = b.id_usuario
WHERE b.accion IN ('LOGIN_FALLIDO', 'LOGIN_BLOQUEADO')
GROUP BY u.nombre_usuario
ORDER BY intentos_fallidos DESC;
GO
