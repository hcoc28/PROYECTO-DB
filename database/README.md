# Base de datos

La lógica de facturación, cobros e inventario vive **dentro de SQL Server**
(constraints, triggers, procedimientos y vistas). La aplicación solo la usa.

## Carpetas

- `prisma/schema.prisma` — modelo que lee la aplicación. Se genera desde la base con `prisma db pull`.
- `sql/facturacion/` — los scripts que crean la base, **separados por tipo de objeto**:

| Archivo | Contenido |
|---|---|
| `00_funciones_y_tipos.sql` | Funciones de fecha/usuario y tipo de tabla |
| `01_tablas.sql` | Todas las tablas, constraints e índices |
| `02_datos_base.sql` | Roles, unidades, tipos de documento, métodos de pago (sin referencia obligatoria), estados |
| `03_vistas.sql` | Vistas (14 con las de seguridad): saldos, cuentas por cobrar, libro de ventas, kardex, caja… |
| `04_procedimientos.sql` | Procedimientos: facturar, certificar, cobrar, anular, inventario y reportes (20 en total con los de seguridad) |
| `05_triggers.sql` | Triggers (21): reglas de facturas y cobros, historiales de solo inserción, auditoría |
| `06_certificador_simulado.sql` | **Solo desarrollo.** Certifica "de mentira" si no hay certificador. Omitir en producción |
| `07_permisos.sql` | Rol `rol_app_facturacion`: la app lee todo y escribe documentos solo vía procedimientos |
| `08_datos_negocio_ejemplo.sql` | Plantilla (comentada) de negocio, series y primer usuario |
| `09_consultas.sql` | 14 consultas de ejemplo (solo leen) |
| `10_seguridad_db.sql` | Hash obligatorio, bloqueo de cuenta y alertas, cierre de sesiones, eliminar clientes, enmascarado, seguridad por fila y vista de seguridad |
| `11_auditoria_servidor.sql` | Auditoría a nivel de servidor (la ejecuta quien administra el servidor) |
| `12_datos_ejemplo.sql` | Datos de ejemplo de una tienda ficticia («La Esquina») |
| `13_sat_resiliencia.sql` | Columnas y validaciones para SAT/FEL: formato de documentos, UUID e identificador de transacción |
| `respaldo_diario.sql` | Respaldo completo y del registro de transacciones, un archivo por día de la semana (7 en rotación). Hay que programarlo con el Programador de tareas |
| `instalar.sql` | Ejecuta lo anterior en orden (sin 08, 09, 11 y 12, que son opcionales) |

## Instalar en `proyecto_final`

Desde la carpeta `sql/facturacion/`, con la base de datos ya creada y vacía:

```bash
sqlcmd -S "localhost\MSSQLSERVER01" -E -C -I -d proyecto_final -i instalar.sql
```

(`-I` es obligatorio: los índices filtrados y las columnas calculadas exigen `QUOTED_IDENTIFIER ON`.)

Luego, **una sola vez**, dar acceso al usuario que usa la aplicación (`app_user`, el de `frontend/.env`):

```sql
USE proyecto_final;
CREATE USER app_user FOR LOGIN app_user;
ALTER ROLE rol_app_facturacion ADD MEMBER app_user;
```

Y cargar lo mínimo para poder entrar (edita `08_datos_negocio_ejemplo.sql`): el negocio, las series
(`FACT-A`, `NCRE-A`) y un usuario ADMIN. La contraseña va **hasheada con argon2id**; se genera con:

```bash
node -e "const a=require('argon2'); a.hash(process.argv[1],{type:a.argon2id}).then(console.log)" "TuContraseña"
```

## Comandos desde la raíz

```bash
npm run prisma:validate
npm run prisma:generate   # tras cambiar el esquema de la base
```

Si cambias las tablas: aplica el cambio en SQL, luego
`cd frontend && npx prisma db pull --schema ../database/prisma/schema.prisma` y `npm run prisma:generate`,
con el servidor de desarrollo detenido (si no, Windows bloquea el motor de Prisma).

## Importante

- **Fechas:** se guardan en UTC. La hora de Guatemala (UTC-6) se calcula al mostrar o al agrupar por día.
  (Prisma lee mal `DATETIMEOFFSET` con desfase distinto de cero; por eso no se guarda con -06:00.)
- **Sin certificador** y fuera de `PRODUCCION`, la app certifica con el simulador (serie FEL `SIM`). Esos documentos
  no tienen validez fiscal. Con el negocio en `PRODUCCION` el simulador se niega a funcionar.

## Documentación de entrega
- `database/sql/facturacion/09_consultas.sql`: 14 consultas con JOIN y agregaciones (no modifican datos).
- `database/sql/facturacion/12_datos_ejemplo.sql`: datos ficticios de un pequeño negocio (tienda de abarrotes). Se ejecuta una sola vez.
- El script completo de la base, el MER, el diccionario de datos y el documento técnico se entregan aparte.
