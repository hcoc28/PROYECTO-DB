/*
    TODAS las tablas, con sus constraints e indices (20 tablas)
    Requiere haber ejecutado: 00
    Parte de la base de facturacion y cobros (ver instalar.sql para el orden completo).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================================================
   Catalogos y seguridad
   ============================================================ */

CREATE TABLE dbo.rol (
    id_rol      INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_rol PRIMARY KEY,
    nombre_rol  NVARCHAR(40) NOT NULL,
    CONSTRAINT uq_rol_nombre UNIQUE (nombre_rol)
);

CREATE TABLE dbo.usuario (
    id_usuario       INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_usuario PRIMARY KEY,
    nombre_usuario   NVARCHAR(50) NOT NULL,
    contrasena       NVARCHAR(255) NOT NULL,                  -- guarda el HASH argon2id, nunca la contraseña real
    id_rol           INT NOT NULL,
    activo           BIT NOT NULL CONSTRAINT df_usuario_activo DEFAULT (1),
    version_sesion   INT NOT NULL CONSTRAINT df_usuario_version_sesion DEFAULT (0),   -- sube en 1 al cerrar sesion o cambiar la contrasena: los tokens anteriores dejan de servir
    creado_en        DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_usuario_creado DEFAULT (dbo.fn_ahora_utc()),
    CONSTRAINT uq_usuario_nombre UNIQUE (nombre_usuario),
    CONSTRAINT fk_usuario_rol FOREIGN KEY (id_rol) REFERENCES dbo.rol(id_rol)
);

CREATE TABLE dbo.negocio (
    id_negocio              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_negocio PRIMARY KEY,
    nit                     NVARCHAR(20) NOT NULL,
    razon_social            NVARCHAR(255) NOT NULL,
    nombre_comercial        NVARCHAR(255) NULL,
    codigo_establecimiento  NVARCHAR(10) NOT NULL CONSTRAINT df_negocio_estab DEFAULT ('1'),
    direccion               NVARCHAR(500) NOT NULL,
    municipio               NVARCHAR(100) NOT NULL,
    departamento            NVARCHAR(100) NOT NULL,
    codigo_postal           NVARCHAR(12) NULL,
    correo                  NVARCHAR(254) NULL,
    afiliacion_iva          NVARCHAR(30) NOT NULL CONSTRAINT df_negocio_afil DEFAULT ('GENERAL'),
    ambiente_fel            NVARCHAR(20) NOT NULL CONSTRAINT df_negocio_ambiente DEFAULT ('CERTIFICACION'),
    certificador            NVARCHAR(100) NULL,
    credencial_ref          NVARCHAR(200) NULL,
    usuario_api             NVARCHAR(100) NULL,               -- credenciales del certificador (las llaves van CIFRADAS por la aplicacion)
    llave_api               NVARCHAR(1000) NULL,
    llave_firma             NVARCHAR(1000) NULL,
    activo                  BIT NOT NULL CONSTRAINT df_negocio_activo DEFAULT (1),
    CONSTRAINT uq_negocio_nit_estab UNIQUE (nit, codigo_establecimiento),
    CONSTRAINT ck_negocio_ambiente CHECK (ambiente_fel IN ('CERTIFICACION','PRODUCCION')),
    CONSTRAINT ck_negocio_afiliacion CHECK (afiliacion_iva IN ('GENERAL','PEQUENO_CONTRIBUYENTE','EXENTO','OTRO'))
);

CREATE TABLE dbo.unidad_medida (
    codigo  NVARCHAR(10) NOT NULL CONSTRAINT pk_unidad_medida PRIMARY KEY,
    nombre  NVARCHAR(60) NOT NULL
);

CREATE TABLE dbo.cliente (
    id_cliente      INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_cliente PRIMARY KEY,
    nombre_cliente  NVARCHAR(160) NOT NULL,
    tipo_documento  NVARCHAR(20) NOT NULL CONSTRAINT df_cliente_tipo_doc DEFAULT ('CF'),
    documento       NVARCHAR(30) NOT NULL CONSTRAINT df_cliente_documento DEFAULT ('CF'),
    documento_norm  AS CONVERT(NVARCHAR(30), UPPER(REPLACE(REPLACE(LTRIM(RTRIM(documento)), '-', ''), ' ', ''))) PERSISTED,
    correo          NVARCHAR(254) NULL,
    telefono        NVARCHAR(25) NULL,
    direccion       NVARCHAR(500) NULL,
    municipio       NVARCHAR(100) NULL,
    departamento    NVARCHAR(100) NULL,
    activo          BIT NOT NULL CONSTRAINT df_cliente_activo DEFAULT (1),
    creado_en       DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_cliente_creado DEFAULT (dbo.fn_ahora_utc()),
    CONSTRAINT ck_cliente_tipo_doc CHECK (tipo_documento IN ('NIT','CUI','PASAPORTE','CF','OTRO')),
    CONSTRAINT ck_cliente_documento CHECK (LEN(LTRIM(RTRIM(documento))) > 0),
    CONSTRAINT ck_cliente_cf CHECK ((tipo_documento = 'CF' AND documento = 'CF') OR (tipo_documento <> 'CF' AND documento <> 'CF'))
);
CREATE UNIQUE INDEX ux_cliente_documento_real ON dbo.cliente(tipo_documento, documento_norm) WHERE tipo_documento <> 'CF';

CREATE TABLE dbo.producto (
    id_producto      INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_producto PRIMARY KEY,
    sku              NVARCHAR(50) NULL,
    codigo_barras    NVARCHAR(80) NULL,
    nombre_producto  NVARCHAR(160) NOT NULL,
    descripcion      NVARCHAR(500) NULL,
    codigo_unidad    NVARCHAR(10) NOT NULL CONSTRAINT df_producto_unidad DEFAULT ('UNI'),
    tipo_item        NVARCHAR(10) NOT NULL CONSTRAINT df_producto_tipo_item DEFAULT ('BIEN'),
    precio_venta     DECIMAL(18,2) NOT NULL,            -- con IVA incluido
    tasa_iva         DECIMAL(9,6) NOT NULL CONSTRAINT df_producto_tasa_iva DEFAULT (0.120000),
    controla_stock   BIT NOT NULL CONSTRAINT df_producto_controla DEFAULT (1),
    stock_actual     DECIMAL(18,4) NOT NULL CONSTRAINT df_producto_stock DEFAULT (0),
    stock_minimo     DECIMAL(18,4) NOT NULL CONSTRAINT df_producto_stock_min DEFAULT (0),
    activo           BIT NOT NULL CONSTRAINT df_producto_activo DEFAULT (1),
    creado_en        DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_producto_creado DEFAULT (dbo.fn_ahora_utc()),
    CONSTRAINT fk_producto_unidad FOREIGN KEY (codigo_unidad) REFERENCES dbo.unidad_medida(codigo),
    CONSTRAINT ck_producto_tipo_item CHECK (tipo_item IN ('BIEN','SERVICIO')),
    CONSTRAINT ck_producto_servicio CHECK (tipo_item = 'BIEN' OR controla_stock = 0),
    CONSTRAINT ck_producto_precio CHECK (precio_venta >= 0),
    CONSTRAINT ck_producto_tasa_iva CHECK (tasa_iva >= 0 AND tasa_iva <= 1),
    CONSTRAINT ck_producto_stock CHECK (stock_actual >= 0 AND stock_minimo >= 0)
);
CREATE UNIQUE INDEX ux_producto_sku    ON dbo.producto(sku)           WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX ux_producto_codigo ON dbo.producto(codigo_barras) WHERE codigo_barras IS NOT NULL;

/* ---- Tipos de documento: definen como afectan inventario y saldo ---- */
CREATE TABLE dbo.tipo_dte (
    codigo_dte          NVARCHAR(10) NOT NULL CONSTRAINT pk_tipo_dte PRIMARY KEY,
    nombre              NVARCHAR(100) NOT NULL,
    signo_inventario    SMALLINT NOT NULL,   -- -1 sale mercaderia, +1 entra (devolucion), 0 no mueve
    signo_saldo         SMALLINT NOT NULL,   -- +1 aumenta lo que debe el cliente, -1 lo disminuye
    requiere_referencia BIT NOT NULL CONSTRAINT df_tipo_dte_ref DEFAULT (0),
    activo              BIT NOT NULL CONSTRAINT df_tipo_dte_activo DEFAULT (1),
    CONSTRAINT ck_tipo_dte_inv CHECK (signo_inventario IN (-1,0,1)),
    CONSTRAINT ck_tipo_dte_saldo CHECK (signo_saldo IN (-1,1))
);

CREATE TABLE dbo.serie_documento (
    id_serie_documento INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_serie_documento PRIMARY KEY,
    id_negocio         INT NOT NULL,
    codigo_dte         NVARCHAR(10) NOT NULL,
    serie_interna      NVARCHAR(30) NOT NULL,
    ultimo_numero      BIGINT NOT NULL CONSTRAINT df_serie_ultimo DEFAULT (0),
    activa             BIT NOT NULL CONSTRAINT df_serie_activa DEFAULT (1),
    CONSTRAINT uq_serie_documento UNIQUE (id_negocio, codigo_dte, serie_interna),
    CONSTRAINT uq_serie_con_negocio UNIQUE (id_serie_documento, id_negocio),
    CONSTRAINT ck_serie_ultimo CHECK (ultimo_numero >= 0),
    CONSTRAINT fk_serie_negocio FOREIGN KEY (id_negocio) REFERENCES dbo.negocio(id_negocio),
    CONSTRAINT fk_serie_tipo_dte FOREIGN KEY (codigo_dte) REFERENCES dbo.tipo_dte(codigo_dte)
);

CREATE TABLE dbo.metodo_pago (
    codigo              NVARCHAR(20) NOT NULL CONSTRAINT pk_metodo_pago PRIMARY KEY,
    nombre              NVARCHAR(60) NOT NULL,
    requiere_referencia BIT NOT NULL CONSTRAINT df_metodo_ref DEFAULT (0),
    activo              BIT NOT NULL CONSTRAINT df_metodo_activo DEFAULT (1)
);

CREATE TABLE dbo.estado_factura (
    codigo       NVARCHAR(25) NOT NULL CONSTRAINT pk_estado_factura PRIMARY KEY,
    descripcion  NVARCHAR(100) NOT NULL,
    editable     BIT NOT NULL      -- 1 = se pueden modificar lineas y totales
);

CREATE TABLE dbo.transicion_estado_factura (
    estado_origen   NVARCHAR(25) NOT NULL,
    estado_destino  NVARCHAR(25) NOT NULL,
    CONSTRAINT pk_transicion PRIMARY KEY (estado_origen, estado_destino),
    CONSTRAINT fk_trans_origen  FOREIGN KEY (estado_origen)  REFERENCES dbo.estado_factura(codigo),
    CONSTRAINT fk_trans_destino FOREIGN KEY (estado_destino) REFERENCES dbo.estado_factura(codigo)
);

/* ============================================================
   Documentos: factura, detalle, respuestas FEL
   ============================================================ */

CREATE TABLE dbo.factura (
    id_factura            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_factura PRIMARY KEY,
    id_negocio            INT NOT NULL,
    id_serie_documento    INT NOT NULL,
    numero_interno        BIGINT NOT NULL,
    id_cliente            INT NOT NULL,
    id_usuario            INT NOT NULL,                       -- quien la creo
    fecha_emision         DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_factura_fecha DEFAULT (dbo.fn_ahora_utc()),
    moneda                NVARCHAR(3) NOT NULL CONSTRAINT df_factura_moneda DEFAULT ('GTQ'),
    condicion_pago        NVARCHAR(10) NOT NULL CONSTRAINT df_factura_condicion DEFAULT ('CONTADO'),
    fecha_vencimiento     DATE NULL,
    subtotal_gravado      DECIMAL(18,2) NOT NULL CONSTRAINT df_factura_sg DEFAULT (0),
    subtotal_exento       DECIMAL(18,2) NOT NULL CONSTRAINT df_factura_se DEFAULT (0),
    descuento_total       DECIMAL(18,2) NOT NULL CONSTRAINT df_factura_desc DEFAULT (0),
    iva_total             DECIMAL(18,2) NOT NULL CONSTRAINT df_factura_iva DEFAULT (0),
    total                 DECIMAL(18,2) NOT NULL CONSTRAINT df_factura_total DEFAULT (0),
    saldo_pendiente       DECIMAL(18,2) NOT NULL CONSTRAINT df_factura_saldo DEFAULT (0),
    estado                NVARCHAR(25) NOT NULL CONSTRAINT df_factura_estado DEFAULT ('BORRADOR'),
    estado_pago           NVARCHAR(15) NOT NULL CONSTRAINT df_factura_estado_pago DEFAULT ('NO_APLICA'),
    uuid_fel              NVARCHAR(80) NULL,
    serie_fel             NVARCHAR(40) NULL,
    numero_fel            NVARCHAR(40) NULL,
    fecha_certificacion   DATETIMEOFFSET(0) NULL,
    xml_fel_hash          VARBINARY(32) NULL,
    id_transaccion_fel    UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_factura_transaccion_fel DEFAULT (NEWID()),  -- identificador fijo que se manda al certificador (evita duplicar al reintentar)
    url_xml               NVARCHAR(500) NULL,                 -- donde se guardo el XML certificado (el documento legal)
    url_pdf               NVARCHAR(500) NULL,                 -- donde se guardo el PDF
    id_factura_referencia BIGINT NULL,                        -- documento que modifica una NCRE/NDEB
    motivo_referencia     NVARCHAR(500) NULL,
    motivo_anulacion      NVARCHAR(500) NULL,
    anulada_en            DATETIMEOFFSET(0) NULL,
    id_usuario_anula      INT NULL,
    uuid_anulacion        NVARCHAR(80) NULL,
    fecha_anulacion_fel   DATETIMEOFFSET(0) NULL,
    observaciones         NVARCHAR(1000) NULL,
    CONSTRAINT uq_factura_numero_interno UNIQUE (id_serie_documento, numero_interno),
    CONSTRAINT uq_factura_con_cliente UNIQUE (id_factura, id_cliente),
    CONSTRAINT fk_factura_negocio FOREIGN KEY (id_negocio) REFERENCES dbo.negocio(id_negocio),
    CONSTRAINT fk_factura_serie FOREIGN KEY (id_serie_documento, id_negocio)
        REFERENCES dbo.serie_documento(id_serie_documento, id_negocio),
    CONSTRAINT fk_factura_cliente FOREIGN KEY (id_cliente) REFERENCES dbo.cliente(id_cliente),
    CONSTRAINT fk_factura_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT fk_factura_usuario_anula FOREIGN KEY (id_usuario_anula) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT fk_factura_estado FOREIGN KEY (estado) REFERENCES dbo.estado_factura(codigo),
    CONSTRAINT ck_factura_condicion CHECK (condicion_pago IN ('CONTADO','CREDITO')),
    CONSTRAINT ck_factura_vencimiento CHECK ((condicion_pago = 'CREDITO' AND fecha_vencimiento IS NOT NULL) OR (condicion_pago = 'CONTADO' AND fecha_vencimiento IS NULL)),
    CONSTRAINT ck_factura_estado_pago CHECK (estado_pago IN ('NO_APLICA','SIN_PAGO','PARCIAL','PAGADA')),
    CONSTRAINT ck_factura_montos CHECK (
        subtotal_gravado >= 0 AND subtotal_exento >= 0 AND descuento_total >= 0
        AND iva_total >= 0 AND total >= 0 AND saldo_pendiente >= 0),
    CONSTRAINT ck_factura_total_cuadra CHECK (total = subtotal_gravado + subtotal_exento + iva_total),
    CONSTRAINT ck_factura_no_autoref CHECK (id_factura_referencia IS NULL OR id_factura_referencia <> id_factura),
    CONSTRAINT ck_factura_certificada CHECK (
        estado <> 'CERTIFICADA'
        OR (uuid_fel IS NOT NULL AND serie_fel IS NOT NULL AND numero_fel IS NOT NULL AND fecha_certificacion IS NOT NULL)),
    CONSTRAINT ck_factura_anulada CHECK (
        estado <> 'ANULADA'
        OR (motivo_anulacion IS NOT NULL AND anulada_en IS NOT NULL AND id_usuario_anula IS NOT NULL
            AND (uuid_fel IS NULL OR uuid_anulacion IS NOT NULL)))
);
ALTER TABLE dbo.factura ADD CONSTRAINT fk_factura_referencia
    FOREIGN KEY (id_factura_referencia, id_cliente) REFERENCES dbo.factura(id_factura, id_cliente);

CREATE UNIQUE INDEX ux_factura_uuid          ON dbo.factura(uuid_fel)       WHERE uuid_fel IS NOT NULL;
CREATE UNIQUE INDEX ux_factura_uuid_anul     ON dbo.factura(uuid_anulacion) WHERE uuid_anulacion IS NOT NULL;
CREATE UNIQUE INDEX ux_factura_serie_num_fel ON dbo.factura(serie_fel, numero_fel) WHERE serie_fel IS NOT NULL AND numero_fel IS NOT NULL;
CREATE INDEX ix_factura_cliente_fecha ON dbo.factura(id_cliente, fecha_emision DESC);
CREATE INDEX ix_factura_estado        ON dbo.factura(estado, fecha_emision DESC);
CREATE INDEX ix_factura_referencia    ON dbo.factura(id_factura_referencia) WHERE id_factura_referencia IS NOT NULL;
CREATE INDEX ix_factura_cobrar        ON dbo.factura(id_cliente, fecha_vencimiento) INCLUDE (saldo_pendiente) WHERE estado = 'CERTIFICADA' AND saldo_pendiente > 0;

CREATE TABLE dbo.detalle_factura (
    id_detalle        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_detalle_factura PRIMARY KEY,
    id_factura        BIGINT NOT NULL,
    id_producto       INT NOT NULL,
    descripcion       NVARCHAR(250) NOT NULL,
    codigo_unidad     NVARCHAR(10) NOT NULL,
    tipo_item         NVARCHAR(10) NOT NULL,
    cantidad          DECIMAL(18,4) NOT NULL,
    precio_unitario   DECIMAL(18,2) NOT NULL,                 -- con IVA incluido
    descuento_linea   DECIMAL(18,2) NOT NULL CONSTRAINT df_detalle_descuento DEFAULT (0),
    tasa_iva          DECIMAL(9,6) NOT NULL,
    total_linea       AS CONVERT(DECIMAL(18,2), ROUND(cantidad * precio_unitario - descuento_linea, 2)) PERSISTED,
    subtotal_sin_iva  AS CONVERT(DECIMAL(18,2), ROUND((cantidad * precio_unitario - descuento_linea) / (1 + tasa_iva), 2)) PERSISTED,
    iva_linea         AS CONVERT(DECIMAL(18,2), ROUND(cantidad * precio_unitario - descuento_linea, 2))
                       - CONVERT(DECIMAL(18,2), ROUND((cantidad * precio_unitario - descuento_linea) / (1 + tasa_iva), 2)) PERSISTED,
    CONSTRAINT uq_detalle_completo UNIQUE (id_detalle, id_factura, id_producto),
    CONSTRAINT fk_detalle_factura  FOREIGN KEY (id_factura)  REFERENCES dbo.factura(id_factura),
    CONSTRAINT fk_detalle_producto FOREIGN KEY (id_producto) REFERENCES dbo.producto(id_producto),
    CONSTRAINT fk_detalle_unidad   FOREIGN KEY (codigo_unidad) REFERENCES dbo.unidad_medida(codigo),
    CONSTRAINT ck_detalle_tipo_item CHECK (tipo_item IN ('BIEN','SERVICIO')),
    CONSTRAINT ck_detalle_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_detalle_montos CHECK (precio_unitario >= 0 AND descuento_linea >= 0),
    CONSTRAINT ck_detalle_descuento CHECK (descuento_linea <= cantidad * precio_unitario),
    CONSTRAINT ck_detalle_tasa_iva CHECK (tasa_iva >= 0 AND tasa_iva <= 1)
);
CREATE INDEX ix_detalle_factura  ON dbo.detalle_factura(id_factura);
CREATE INDEX ix_detalle_producto ON dbo.detalle_factura(id_producto);

CREATE TABLE dbo.factura_fel (
    id_factura_fel    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_factura_fel PRIMARY KEY,
    id_factura        BIGINT NOT NULL,
    tipo_evento       NVARCHAR(20) NOT NULL,
    intento           INT NOT NULL,
    exito             BIT NOT NULL,
    xml_enviado       XML NULL,
    xml_respuesta     XML NULL,
    codigo_respuesta  NVARCHAR(40) NULL,
    mensaje           NVARCHAR(2000) NULL,
    creado_en         DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_fel_creado DEFAULT (dbo.fn_ahora_utc()),
    CONSTRAINT fk_fel_factura FOREIGN KEY (id_factura) REFERENCES dbo.factura(id_factura),
    CONSTRAINT ck_fel_evento CHECK (tipo_evento IN ('CERTIFICACION','ANULACION')),
    CONSTRAINT uq_fel_intento UNIQUE (id_factura, tipo_evento, intento)
);

/* ============================================================
   Cobros (recibos) y su aplicacion a facturas
   ============================================================ */

CREATE TABLE dbo.cobro (
    id_cobro          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_cobro PRIMARY KEY,
    id_cliente        INT NOT NULL,
    id_usuario        INT NOT NULL,
    fecha_cobro       DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_cobro_fecha DEFAULT (dbo.fn_ahora_utc()),
    monto             DECIMAL(18,2) NOT NULL,
    codigo_metodo     NVARCHAR(20) NOT NULL,
    referencia        NVARCHAR(100) NULL,
    estado            NVARCHAR(10) NOT NULL CONSTRAINT df_cobro_estado DEFAULT ('APLICADO'),
    observaciones     NVARCHAR(500) NULL,
    anulado_en        DATETIMEOFFSET(0) NULL,
    id_usuario_anula  INT NULL,
    motivo_anulacion  NVARCHAR(500) NULL,
    CONSTRAINT uq_cobro_con_cliente UNIQUE (id_cobro, id_cliente),
    CONSTRAINT fk_cobro_cliente FOREIGN KEY (id_cliente) REFERENCES dbo.cliente(id_cliente),
    CONSTRAINT fk_cobro_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT fk_cobro_usuario_anula FOREIGN KEY (id_usuario_anula) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT fk_cobro_metodo FOREIGN KEY (codigo_metodo) REFERENCES dbo.metodo_pago(codigo),
    CONSTRAINT ck_cobro_monto CHECK (monto > 0),
    CONSTRAINT ck_cobro_estado CHECK (estado IN ('APLICADO','ANULADO')),
    CONSTRAINT ck_cobro_anulado CHECK (estado <> 'ANULADO' OR (anulado_en IS NOT NULL AND id_usuario_anula IS NOT NULL AND motivo_anulacion IS NOT NULL))
);
CREATE INDEX ix_cobro_cliente_fecha ON dbo.cobro(id_cliente, fecha_cobro DESC);
CREATE INDEX ix_cobro_fecha         ON dbo.cobro(fecha_cobro DESC, codigo_metodo);

CREATE TABLE dbo.cobro_aplicacion (
    id_aplicacion  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_cobro_aplicacion PRIMARY KEY,
    id_cobro       BIGINT NOT NULL,
    id_factura     BIGINT NOT NULL,
    id_cliente     INT NOT NULL,                              -- cobro y factura deben ser del mismo cliente
    monto          DECIMAL(18,2) NOT NULL,
    fecha          DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_aplicacion_fecha DEFAULT (dbo.fn_ahora_utc()),
    CONSTRAINT uq_aplicacion UNIQUE (id_cobro, id_factura),
    CONSTRAINT fk_aplicacion_cobro   FOREIGN KEY (id_cobro, id_cliente)   REFERENCES dbo.cobro(id_cobro, id_cliente),
    CONSTRAINT fk_aplicacion_factura FOREIGN KEY (id_factura, id_cliente) REFERENCES dbo.factura(id_factura, id_cliente),
    CONSTRAINT ck_aplicacion_monto CHECK (monto > 0)
);
CREATE INDEX ix_aplicacion_factura ON dbo.cobro_aplicacion(id_factura) INCLUDE (id_cobro, monto);
CREATE INDEX ix_aplicacion_cliente ON dbo.cobro_aplicacion(id_cliente);

/* ============================================================
   Historiales (solo insercion)
   ============================================================ */

CREATE TABLE dbo.movimiento_inventario (
    id_movimiento     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_movimiento_inventario PRIMARY KEY,
    id_producto       INT NOT NULL,
    id_factura        BIGINT NULL,
    id_detalle        BIGINT NULL,
    id_usuario        INT NULL,
    fecha_movimiento  DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_mov_inv_fecha DEFAULT (dbo.fn_ahora_utc()),
    tipo_movimiento   NVARCHAR(20) NOT NULL,
    cantidad          DECIMAL(18,4) NOT NULL,                 -- negativo = sale, positivo = entra
    stock_resultante  DECIMAL(18,4) NOT NULL CONSTRAINT df_mov_inv_stock DEFAULT (0),  -- lo calcula usp_mover_inventario
    observacion       NVARCHAR(500) NULL,
    CONSTRAINT fk_mov_inv_producto FOREIGN KEY (id_producto) REFERENCES dbo.producto(id_producto),
    CONSTRAINT fk_mov_inv_factura  FOREIGN KEY (id_factura)  REFERENCES dbo.factura(id_factura),
    CONSTRAINT fk_mov_inv_detalle  FOREIGN KEY (id_detalle, id_factura, id_producto)
        REFERENCES dbo.detalle_factura(id_detalle, id_factura, id_producto),
    CONSTRAINT fk_mov_inv_usuario  FOREIGN KEY (id_usuario) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT ck_mov_inv_tipo CHECK (tipo_movimiento IN ('VENTA','DEVOLUCION','REVERSA_VENTA','REVERSA_DEVOLUCION','ENTRADA','AJUSTE')),
    CONSTRAINT ck_mov_inv_cantidad CHECK (cantidad <> 0),
    CONSTRAINT ck_mov_inv_signo CHECK (
        (tipo_movimiento IN ('VENTA','REVERSA_DEVOLUCION') AND cantidad < 0) OR
        (tipo_movimiento IN ('DEVOLUCION','REVERSA_VENTA','ENTRADA') AND cantidad > 0) OR
        tipo_movimiento = 'AJUSTE'),
    CONSTRAINT ck_mov_inv_origen CHECK ((id_detalle IS NULL AND id_factura IS NULL) OR (id_detalle IS NOT NULL AND id_factura IS NOT NULL)),
    CONSTRAINT ck_mov_inv_stock CHECK (stock_resultante >= 0)
);
CREATE UNIQUE INDEX ux_mov_inv_detalle_tipo ON dbo.movimiento_inventario(id_detalle, tipo_movimiento) WHERE id_detalle IS NOT NULL;
CREATE INDEX ix_mov_inv_producto_fecha ON dbo.movimiento_inventario(id_producto, fecha_movimiento DESC);

-- Cuenta corriente del cliente: cargos (lo que debe) y abonos (lo que paga o se le acredita)
CREATE TABLE dbo.movimiento_cliente (
    id_movimiento     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_movimiento_cliente PRIMARY KEY,
    id_cliente        INT NOT NULL,
    fecha_movimiento  DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_mov_cli_fecha DEFAULT (dbo.fn_ahora_utc()),
    tipo_movimiento   NVARCHAR(25) NOT NULL,
    id_factura        BIGINT NULL,
    id_cobro          BIGINT NULL,
    cargo             DECIMAL(18,2) NOT NULL CONSTRAINT df_mov_cli_cargo DEFAULT (0),
    abono             DECIMAL(18,2) NOT NULL CONSTRAINT df_mov_cli_abono DEFAULT (0),
    descripcion       NVARCHAR(200) NULL,
    id_usuario        INT NULL,
    CONSTRAINT fk_mov_cli_cliente FOREIGN KEY (id_cliente) REFERENCES dbo.cliente(id_cliente),
    CONSTRAINT fk_mov_cli_factura FOREIGN KEY (id_factura, id_cliente) REFERENCES dbo.factura(id_factura, id_cliente),
    CONSTRAINT fk_mov_cli_cobro   FOREIGN KEY (id_cobro, id_cliente)   REFERENCES dbo.cobro(id_cobro, id_cliente),
    CONSTRAINT fk_mov_cli_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT ck_mov_cli_tipo CHECK (tipo_movimiento IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO','ANULACION_DOCUMENTO','COBRO','ANULACION_COBRO')),
    CONSTRAINT ck_mov_cli_importe CHECK ((cargo > 0 AND abono = 0) OR (abono > 0 AND cargo = 0)),
    CONSTRAINT ck_mov_cli_origen CHECK (
        (tipo_movimiento IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO','ANULACION_DOCUMENTO') AND id_factura IS NOT NULL AND id_cobro IS NULL) OR
        (tipo_movimiento IN ('COBRO','ANULACION_COBRO') AND id_cobro IS NOT NULL AND id_factura IS NULL))
);
CREATE UNIQUE INDEX ux_mov_cli_factura ON dbo.movimiento_cliente(id_factura, tipo_movimiento) WHERE id_factura IS NOT NULL;
CREATE UNIQUE INDEX ux_mov_cli_cobro   ON dbo.movimiento_cliente(id_cobro, tipo_movimiento)   WHERE id_cobro IS NOT NULL;
CREATE INDEX ix_mov_cli_cliente ON dbo.movimiento_cliente(id_cliente, id_movimiento);

CREATE TABLE dbo.historial_estado_factura (
    id_historial     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_historial_estado PRIMARY KEY,
    id_factura       BIGINT NOT NULL,
    estado_anterior  NVARCHAR(25) NULL,
    estado_nuevo     NVARCHAR(25) NOT NULL,
    id_usuario       INT NULL,
    fecha            DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_hist_estado_fecha DEFAULT (dbo.fn_ahora_utc()),
    motivo           NVARCHAR(500) NULL,
    CONSTRAINT fk_hist_factura FOREIGN KEY (id_factura) REFERENCES dbo.factura(id_factura),
    CONSTRAINT fk_hist_ant FOREIGN KEY (estado_anterior) REFERENCES dbo.estado_factura(codigo),
    CONSTRAINT fk_hist_nuevo FOREIGN KEY (estado_nuevo) REFERENCES dbo.estado_factura(codigo),
    CONSTRAINT fk_hist_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario(id_usuario)
);
CREATE INDEX ix_hist_factura ON dbo.historial_estado_factura(id_factura, id_historial);

CREATE TABLE dbo.auditoria_evento (
    id_evento          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_auditoria_evento PRIMARY KEY,
    tabla              SYSNAME NOT NULL,
    id_registro        NVARCHAR(80) NOT NULL,
    accion             NVARCHAR(10) NOT NULL,
    id_usuario         INT NULL,
    fecha_evento       DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_auditoria_fecha DEFAULT (dbo.fn_ahora_utc()),
    valores_anteriores NVARCHAR(MAX) NULL,
    valores_nuevos     NVARCHAR(MAX) NULL,
    CONSTRAINT fk_auditoria_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT ck_auditoria_accion CHECK (accion IN ('INSERT','UPDATE','DELETE')),
    CONSTRAINT ck_auditoria_json CHECK (
        (valores_anteriores IS NULL OR ISJSON(valores_anteriores) = 1) AND
        (valores_nuevos IS NULL OR ISJSON(valores_nuevos) = 1))
);
CREATE INDEX ix_auditoria_tabla_registro ON dbo.auditoria_evento(tabla, id_registro);
CREATE INDEX ix_auditoria_fecha ON dbo.auditoria_evento(fecha_evento DESC);

-- Bitacora de acciones de los usuarios en la aplicacion (login, crear factura, anular...), con IP.
-- Distinta de auditoria_evento, que guarda el antes/despues de los datos maestros.
CREATE TABLE dbo.bitacora (
    id_bitacora  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_bitacora PRIMARY KEY,
    id_usuario        INT NULL,                         -- NULL si el usuario intentado no existe
    usuario_intentado NVARCHAR(50) NULL,                -- nombre escrito en un login (existiera o no)
    accion       NVARCHAR(100) NOT NULL,
    detalle      NVARCHAR(500) NULL,
    ip           NVARCHAR(45) NULL,
    fecha        DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_bitacora_fecha DEFAULT (dbo.fn_ahora_utc()),
    CONSTRAINT fk_bitacora_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario(id_usuario),
    CONSTRAINT ck_bitacora_quien CHECK (id_usuario IS NOT NULL OR usuario_intentado IS NOT NULL)
);
CREATE INDEX ix_bitacora_fecha  ON dbo.bitacora(fecha DESC);
CREATE INDEX ix_bitacora_accion ON dbo.bitacora(accion, fecha DESC);
GO

/* ============================================================
   Indices en llaves foraneas
   ============================================================
   SQL Server no crea indice automatico en la columna que apunta a otra tabla. Sin el, buscar "las facturas de
   este usuario" o borrar/validar una fila padre recorre toda la tabla. Con muchos datos esto hace la diferencia. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_serie_documento_codigo_dte')
    CREATE INDEX ix_serie_documento_codigo_dte ON dbo.serie_documento(codigo_dte);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_transicion_estado_factura_estado_destino')
    CREATE INDEX ix_transicion_estado_factura_estado_destino ON dbo.transicion_estado_factura(estado_destino);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_factura_id_negocio')
    CREATE INDEX ix_factura_id_negocio ON dbo.factura(id_negocio);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_factura_id_usuario')
    CREATE INDEX ix_factura_id_usuario ON dbo.factura(id_usuario);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_factura_id_usuario_anula')
    CREATE INDEX ix_factura_id_usuario_anula ON dbo.factura(id_usuario_anula);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_detalle_factura_codigo_unidad')
    CREATE INDEX ix_detalle_factura_codigo_unidad ON dbo.detalle_factura(codigo_unidad);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_cobro_id_usuario')
    CREATE INDEX ix_cobro_id_usuario ON dbo.cobro(id_usuario);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_cobro_codigo_metodo')
    CREATE INDEX ix_cobro_codigo_metodo ON dbo.cobro(codigo_metodo);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_cobro_id_usuario_anula')
    CREATE INDEX ix_cobro_id_usuario_anula ON dbo.cobro(id_usuario_anula);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_movimiento_inventario_id_factura')
    CREATE INDEX ix_movimiento_inventario_id_factura ON dbo.movimiento_inventario(id_factura);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_movimiento_inventario_id_usuario')
    CREATE INDEX ix_movimiento_inventario_id_usuario ON dbo.movimiento_inventario(id_usuario);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_usuario_id_rol')
    CREATE INDEX ix_usuario_id_rol ON dbo.usuario(id_rol);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_movimiento_cliente_id_usuario')
    CREATE INDEX ix_movimiento_cliente_id_usuario ON dbo.movimiento_cliente(id_usuario);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_historial_estado_factura_estado_anterior')
    CREATE INDEX ix_historial_estado_factura_estado_anterior ON dbo.historial_estado_factura(estado_anterior);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_historial_estado_factura_estado_nuevo')
    CREATE INDEX ix_historial_estado_factura_estado_nuevo ON dbo.historial_estado_factura(estado_nuevo);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_historial_estado_factura_id_usuario')
    CREATE INDEX ix_historial_estado_factura_id_usuario ON dbo.historial_estado_factura(id_usuario);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_producto_codigo_unidad')
    CREATE INDEX ix_producto_codigo_unidad ON dbo.producto(codigo_unidad);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_auditoria_evento_id_usuario')
    CREATE INDEX ix_auditoria_evento_id_usuario ON dbo.auditoria_evento(id_usuario);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bitacora_id_usuario')
    CREATE INDEX ix_bitacora_id_usuario ON dbo.bitacora(id_usuario);
GO

-- Listados y "ultimas facturas" ordenan por fecha sin filtrar por estado
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_factura_fecha')
    CREATE INDEX ix_factura_fecha ON dbo.factura(fecha_emision DESC);
GO
