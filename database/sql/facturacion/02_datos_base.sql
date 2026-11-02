/*
    Datos iniciales de catalogos: roles, unidades, tipos de documento, metodos de pago, estados y transiciones, Consumidor Final
    Requiere haber ejecutado: 01
    Parte de la base de facturacion y cobros (ver instalar.sql para el orden completo).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================================================
   Datos base
   ============================================================ */

INSERT INTO dbo.rol(nombre_rol) VALUES ('ADMIN'), ('CAJERO'),('GERENTE');

INSERT INTO dbo.unidad_medida(codigo, nombre) VALUES
    ('UNI','Unidad'), ('SRV','Servicio'), ('KG','Kilogramo'), ('LB','Libra'),
    ('LT','Litro'), ('MT','Metro'), ('CAJ','Caja'), ('DOC','Docena');

INSERT INTO dbo.tipo_dte(codigo_dte, nombre, signo_inventario, signo_saldo, requiere_referencia) VALUES
    ('FACT','Factura',                        -1,  1, 0),
    ('FCAM','Factura cambiaria',              -1,  1, 0),
    ('FPEQ','Factura pequeno contribuyente',  -1,  1, 0),
    ('NCRE','Nota de credito',                 1, -1, 1),
    ('NDEB','Nota de debito',                  0,  1, 1);

INSERT INTO dbo.metodo_pago(codigo, nombre, requiere_referencia) VALUES
    ('EFECTIVO','Efectivo',0), ('TARJETA','Tarjeta',0), ('TRANSFERENCIA','Transferencia',0),
    ('DEPOSITO','Deposito',0), ('QR','Pago QR',0), ('CHEQUE','Cheque',0);

INSERT INTO dbo.estado_factura(codigo, descripcion, editable) VALUES
    ('BORRADOR','En preparacion',1),
    ('PENDIENTE_CERTIFICACION','Enviada al certificador',0),
    ('CERTIFICADA','Certificada ante SAT',0),
    ('RECHAZADA','Rechazada por el certificador',1),
    ('ANULADA','Anulada',0);

INSERT INTO dbo.transicion_estado_factura(estado_origen, estado_destino) VALUES
    ('BORRADOR','PENDIENTE_CERTIFICACION'),
    ('BORRADOR','CERTIFICADA'),
    ('BORRADOR','ANULADA'),
    ('PENDIENTE_CERTIFICACION','CERTIFICADA'),
    ('PENDIENTE_CERTIFICACION','RECHAZADA'),
    ('RECHAZADA','BORRADOR'),
    ('RECHAZADA','PENDIENTE_CERTIFICACION'),
    ('RECHAZADA','ANULADA'),
    ('CERTIFICADA','ANULADA');

-- Consumidor Final
INSERT INTO dbo.cliente(nombre_cliente, tipo_documento, documento) VALUES ('Consumidor Final','CF','CF');
GO
