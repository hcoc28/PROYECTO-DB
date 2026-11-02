/*
    VISTAS del sistema de facturacion y cobros.
    Requiere haber ejecutado: 01
    Una vista es una consulta guardada con un nombre: se usa igual que una tabla
    (SELECT * FROM dbo.vw_...), pero sus datos se calculan al momento.

    Lista:
      vw_saldo_factura          cuanto se ha pagado y cuanto debe cada factura
      vw_factura_resumen        facturas con cliente, pagado y saldo
      vw_cuentas_por_cobrar     facturas que todavia deben dinero, con dias de atraso
      vw_estado_cuenta_cliente  movimientos de cada cliente con su saldo
      vw_saldo_cliente          cuanto debe cada cliente
      vw_libro_ventas           documentos certificados (libro de ventas)
      vw_kardex                 entradas y salidas de inventario
      vw_stock_bajo             productos con poca existencia
      vw_cobros_detalle         cobros con lo aplicado y el saldo a favor
      vw_corte_caja             cobros por dia, cajero y metodo
      vw_ventas_por_producto    ventas por producto y por dia
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ------------------------------------------------------------
   Saldo de cada factura:  saldo = total - cobros - notas de credito
   Es la vista mas importante: de aqui salen saldo_pendiente y estado_pago.
   Solo tienen saldo las facturas CERTIFICADAS que suman a la deuda del cliente
   (no las notas de credito, ni las anuladas, ni los borradores). */
CREATE OR ALTER VIEW dbo.vw_saldo_factura
AS
SELECT
    f.id_factura,
    CONVERT(DECIMAL(18,2), ISNULL(p.pagado, 0)) AS pagado,
    CONVERT(DECIMAL(18,2), ISNULL(n.notas, 0)) AS notas_credito,

    -- saldo "crudo": puede dar negativo si se pago de mas
    CONVERT(DECIMAL(18,2),
        CASE WHEN f.estado = 'CERTIFICADA' AND t.signo_saldo = 1
             THEN f.total - ISNULL(p.pagado, 0) - ISNULL(n.notas, 0)
             ELSE 0 END) AS saldo_calculado,

    -- saldo que se muestra: nunca menor que cero
    CONVERT(DECIMAL(18,2),
        CASE WHEN f.estado = 'CERTIFICADA' AND t.signo_saldo = 1
                  AND f.total - ISNULL(p.pagado, 0) - ISNULL(n.notas, 0) > 0
             THEN f.total - ISNULL(p.pagado, 0) - ISNULL(n.notas, 0)
             ELSE 0 END) AS saldo,

    CASE
        WHEN f.estado <> 'CERTIFICADA' OR t.signo_saldo <> 1 THEN 'NO_APLICA'
        WHEN ISNULL(p.pagado, 0) + ISNULL(n.notas, 0) = 0 THEN 'SIN_PAGO'
        WHEN f.total - ISNULL(p.pagado, 0) - ISNULL(n.notas, 0) <= 0 THEN 'PAGADA'
        ELSE 'PARCIAL'
    END AS estado_pago
FROM dbo.factura f
JOIN dbo.serie_documento s ON s.id_serie_documento = f.id_serie_documento
JOIN dbo.tipo_dte t ON t.codigo_dte = s.codigo_dte
-- Total cobrado a cada factura (solo cobros que no estan anulados)
LEFT JOIN (
    SELECT ca.id_factura, SUM(ca.monto) AS pagado
    FROM dbo.cobro_aplicacion ca
    JOIN dbo.cobro c ON c.id_cobro = ca.id_cobro
    WHERE c.estado = 'APLICADO'
    GROUP BY ca.id_factura
) p ON p.id_factura = f.id_factura
-- Total de notas de credito certificadas que corrigen a cada factura
LEFT JOIN (
    SELECT g.id_factura_referencia AS id_factura, SUM(g.total) AS notas
    FROM dbo.factura g
    JOIN dbo.serie_documento sg ON sg.id_serie_documento = g.id_serie_documento
    JOIN dbo.tipo_dte tg ON tg.codigo_dte = sg.codigo_dte
    WHERE g.estado = 'CERTIFICADA'
      AND tg.signo_saldo = -1
    GROUP BY g.id_factura_referencia
) n ON n.id_factura = f.id_factura;
GO


/* ------------------------------------------------------------
   Facturas con sus datos principales (pantalla de facturas). */
CREATE OR ALTER VIEW dbo.vw_factura_resumen
AS
SELECT f.id_factura, s.codigo_dte, s.serie_interna, f.numero_interno,
       f.serie_fel, f.numero_fel, f.uuid_fel, f.fecha_emision, f.estado, f.estado_pago,
       f.id_cliente, c.nombre_cliente, c.documento, f.condicion_pago, f.fecha_vencimiento,
       f.subtotal_gravado, f.subtotal_exento, f.iva_total, f.total,
       v.pagado, v.notas_credito, f.saldo_pendiente, u.nombre_usuario AS emitida_por
FROM dbo.factura f
JOIN dbo.serie_documento s ON s.id_serie_documento = f.id_serie_documento
JOIN dbo.cliente c ON c.id_cliente = f.id_cliente
JOIN dbo.usuario u ON u.id_usuario = f.id_usuario
JOIN dbo.vw_saldo_factura v ON v.id_factura = f.id_factura;
GO


/* ------------------------------------------------------------
   Cuentas por cobrar: facturas certificadas que todavia deben dinero.
   "antiguedad" clasifica los dias de atraso respecto a la fecha de vencimiento. */
CREATE OR ALTER VIEW dbo.vw_cuentas_por_cobrar
AS
SELECT f.id_factura, s.codigo_dte, s.serie_interna, f.numero_interno,
       f.id_cliente, c.nombre_cliente, c.documento,
       f.fecha_emision, f.fecha_vencimiento, f.total, f.saldo_pendiente,
       CASE WHEN f.fecha_vencimiento IS NULL THEN NULL
            ELSE DATEDIFF(DAY, f.fecha_vencimiento, dbo.fn_hoy_gt()) END AS dias_vencida,
       CASE
            WHEN f.fecha_vencimiento IS NULL OR f.fecha_vencimiento >= dbo.fn_hoy_gt() THEN 'VIGENTE'
            WHEN DATEDIFF(DAY, f.fecha_vencimiento, dbo.fn_hoy_gt()) <= 30 THEN '1-30'
            WHEN DATEDIFF(DAY, f.fecha_vencimiento, dbo.fn_hoy_gt()) <= 60 THEN '31-60'
            WHEN DATEDIFF(DAY, f.fecha_vencimiento, dbo.fn_hoy_gt()) <= 90 THEN '61-90'
            ELSE '90+'
       END AS antiguedad
FROM dbo.factura f
JOIN dbo.serie_documento s ON s.id_serie_documento = f.id_serie_documento
JOIN dbo.cliente c ON c.id_cliente = f.id_cliente
WHERE f.estado = 'CERTIFICADA'
  AND f.saldo_pendiente > 0;
GO


/* ------------------------------------------------------------
   Estado de cuenta: cada movimiento del cliente y su saldo despues de ese movimiento.
   saldo_acumulado = suma de (cargo - abono) de todos los movimientos hasta ese momento.
   Positivo = el cliente debe. Negativo = tiene saldo a favor. */
CREATE OR ALTER VIEW dbo.vw_estado_cuenta_cliente
AS
SELECT m.id_movimiento, m.id_cliente, c.nombre_cliente, m.fecha_movimiento, m.tipo_movimiento,
       m.id_factura, m.id_cobro, m.descripcion, m.cargo, m.abono,
       (SELECT SUM(m2.cargo - m2.abono)
        FROM dbo.movimiento_cliente m2
        WHERE m2.id_cliente = m.id_cliente
          AND m2.id_movimiento <= m.id_movimiento) AS saldo_acumulado
FROM dbo.movimiento_cliente m
JOIN dbo.cliente c ON c.id_cliente = m.id_cliente;
GO


/* ------------------------------------------------------------
   Cuanto debe cada cliente en total. */
CREATE OR ALTER VIEW dbo.vw_saldo_cliente
AS
SELECT c.id_cliente, c.nombre_cliente, c.documento,
       ISNULL(SUM(m.cargo - m.abono), 0) AS saldo,     -- positivo: debe; negativo: saldo a favor
       ISNULL(SUM(m.cargo), 0) AS cargos,
       ISNULL(SUM(m.abono), 0) AS abonos
FROM dbo.cliente c
LEFT JOIN dbo.movimiento_cliente m ON m.id_cliente = c.id_cliente
GROUP BY c.id_cliente, c.nombre_cliente, c.documento;
GO


/* ------------------------------------------------------------
   Libro de ventas: documentos certificados (y los que se anularon despues de certificarse).
   Las notas de credito restan; los documentos anulados valen cero. */
CREATE OR ALTER VIEW dbo.vw_libro_ventas
AS
SELECT f.id_factura,
       dbo.fn_dia_gt(f.fecha_emision) AS fecha,
       s.codigo_dte, s.serie_interna, f.numero_interno,
       f.serie_fel, f.numero_fel, f.uuid_fel, f.estado,
       c.documento, c.nombre_cliente,
       CASE WHEN f.estado = 'ANULADA' THEN 0 ELSE t.signo_saldo END AS signo,
       CASE WHEN f.estado = 'ANULADA' THEN 0 ELSE t.signo_saldo * f.subtotal_gravado END AS subtotal_gravado,
       CASE WHEN f.estado = 'ANULADA' THEN 0 ELSE t.signo_saldo * f.subtotal_exento END AS subtotal_exento,
       CASE WHEN f.estado = 'ANULADA' THEN 0 ELSE t.signo_saldo * f.iva_total END AS iva,
       CASE WHEN f.estado = 'ANULADA' THEN 0 ELSE t.signo_saldo * f.total END AS total
FROM dbo.factura f
JOIN dbo.serie_documento s ON s.id_serie_documento = f.id_serie_documento
JOIN dbo.tipo_dte t ON t.codigo_dte = s.codigo_dte
JOIN dbo.cliente c ON c.id_cliente = f.id_cliente
WHERE f.uuid_fel IS NOT NULL;          -- solo documentos que SAT llego a certificar
GO


/* ------------------------------------------------------------
   Kardex: historial de entradas y salidas de inventario. */
CREATE OR ALTER VIEW dbo.vw_kardex
AS
SELECT m.id_movimiento, m.fecha_movimiento, m.id_producto, p.sku, p.nombre_producto,
       m.tipo_movimiento, m.cantidad, m.stock_resultante,
       m.id_factura, m.id_detalle, u.nombre_usuario, m.observacion
FROM dbo.movimiento_inventario m
JOIN dbo.producto p ON p.id_producto = m.id_producto
LEFT JOIN dbo.usuario u ON u.id_usuario = m.id_usuario;
GO


/* ------------------------------------------------------------
   Productos activos con existencia igual o menor al minimo. */
CREATE OR ALTER VIEW dbo.vw_stock_bajo
AS
SELECT id_producto, sku, nombre_producto, stock_actual, stock_minimo,
       stock_minimo - stock_actual AS faltante
FROM dbo.producto
WHERE activo = 1
  AND controla_stock = 1
  AND stock_actual <= stock_minimo;
GO


/* ------------------------------------------------------------
   Cobros con cuanto se aplico a facturas y cuanto quedo a favor del cliente. */
CREATE OR ALTER VIEW dbo.vw_cobros_detalle
AS
SELECT co.id_cobro, co.fecha_cobro, co.estado, co.id_cliente, c.nombre_cliente,
       co.codigo_metodo, co.referencia, co.monto,
       ISNULL(a.aplicado, 0) AS aplicado,
       CASE WHEN co.estado = 'APLICADO' THEN co.monto - ISNULL(a.aplicado, 0) ELSE 0 END AS saldo_a_favor,
       u.nombre_usuario AS cobrado_por
FROM dbo.cobro co
JOIN dbo.cliente c ON c.id_cliente = co.id_cliente
JOIN dbo.usuario u ON u.id_usuario = co.id_usuario
LEFT JOIN (
    SELECT id_cobro, SUM(monto) AS aplicado
    FROM dbo.cobro_aplicacion
    GROUP BY id_cobro
) a ON a.id_cobro = co.id_cobro;
GO


/* ------------------------------------------------------------
   Corte de caja: lo cobrado por dia, cajero y metodo de pago (sin los cobros anulados). */
CREATE OR ALTER VIEW dbo.vw_corte_caja
AS
SELECT dbo.fn_dia_gt(co.fecha_cobro) AS fecha,
       co.id_usuario, u.nombre_usuario, co.codigo_metodo,
       COUNT(*) AS cantidad,
       SUM(co.monto) AS total
FROM dbo.cobro co
JOIN dbo.usuario u ON u.id_usuario = co.id_usuario
WHERE co.estado = 'APLICADO'
GROUP BY dbo.fn_dia_gt(co.fecha_cobro), co.id_usuario, u.nombre_usuario, co.codigo_metodo;
GO


/* ------------------------------------------------------------
   Ventas por producto y por dia (las notas de credito restan). */
CREATE OR ALTER VIEW dbo.vw_ventas_por_producto
AS
SELECT d.id_producto, p.nombre_producto,
       dbo.fn_dia_gt(f.fecha_emision) AS fecha,
       SUM(t.signo_saldo * d.cantidad) AS cantidad,
       SUM(t.signo_saldo * d.total_linea) AS importe
FROM dbo.detalle_factura d
JOIN dbo.factura f ON f.id_factura = d.id_factura
JOIN dbo.serie_documento s ON s.id_serie_documento = f.id_serie_documento
JOIN dbo.tipo_dte t ON t.codigo_dte = s.codigo_dte
JOIN dbo.producto p ON p.id_producto = d.id_producto
WHERE f.estado = 'CERTIFICADA'
  AND t.signo_inventario <> 0
GROUP BY d.id_producto, p.nombre_producto, dbo.fn_dia_gt(f.fecha_emision);
GO
