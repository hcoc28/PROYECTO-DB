/*
    Plantilla (comentada) para cargar tu negocio, series y primer usuario
    Requiere haber ejecutado: 01, 02
    Parte de la base de facturacion y cobros (ver instalar.sql para el orden completo).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================================================
   Datos del negocio (editar y ejecutar una vez)
   ============================================================ */

INSERT INTO dbo.negocio(nit, razon_social, nombre_comercial, direccion, municipio, departamento)
VALUES ('12345678', 'Mi Negocio, S.A.', 'Mi Tienda', '4a. Calle 5-20 Zona 1', 'Guatemala', 'Guatemala');
INSERT INTO dbo.serie_documento(id_negocio, codigo_dte, serie_interna) VALUES (1,'FACT','A'), (1,'NCRE','A');
INSERT INTO dbo.usuario(nombre_usuario, contrasena, id_rol) VALUES ('admin', '<hash argon2id, debe empezar con $argon2id$>', 1);
*/
GO
