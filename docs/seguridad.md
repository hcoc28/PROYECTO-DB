# Seguridad del sistema

Resumen de las protecciones que tiene el sistema, dónde están y qué falta decidir al publicarlo.

## 1. Contraseñas y sesión

| Protección | Dónde |
|---|---|
| Las contraseñas se guardan como **hash argon2id** (la columna `usuario.contrasena` nunca tiene la contraseña real) | `backend/src/api/usuarios/*.ts`, `auth/login.ts` |
| **Política de contraseñas**: 8 a 100 caracteres con mayúscula, minúscula y número | `backend/src/seguridad/contrasena.ts` |
| El login hace una comparación falsa si el usuario no existe (no se puede averiguar qué usuarios existen midiendo el tiempo) | `auth/login.ts` |
| Mensaje de error genérico: "Usuario o contraseña incorrectos" | `auth/login.ts` |
| **Bloqueo de cuenta**: 5 intentos fallidos = 15 minutos bloqueada (se reinicia con un inicio de sesión correcto) | `backend/src/seguridad/bloqueo.ts` |
| La sesión es un **token firmado (JWT)** que caduca (480 minutos por defecto, `JWT_ACCESS_TTL_MIN`) | `backend/src/seguridad/auth.ts` |
| El token va en una **cookie `httpOnly`, `SameSite=Strict`** (y `Secure` en producción): el JavaScript de la página no puede leerla | `backend/src/seguridad/sesion-cookie.ts` |
| En **cada petición** se confirma en la base de datos que el usuario sigue activo y se usa su **rol actual** (desactivar a alguien le quita el acceso al instante) | `sesionDesdeRequest()` en `auth.ts` |
| Cerrar sesión borra la cookie, queda en la bitácora y **invalida el token en el servidor**: la base de datos sube `usuario.version_sesion` (procedimiento `usp_cerrar_sesiones`) y todo token emitido antes deja de valer, aunque no haya vencido. Lo mismo ocurre al cambiar o restablecer la contraseña. | `backend/src/api/auth/logout.ts`, `10_seguridad_db.sql` |

## 2. Control de acceso
- Todos los endpoints exigen sesión; solo el login es público.
- Hay tres roles reconocidos: `ADMIN` (todo), `CAJERO` (vende, cobra y consulta) y `GERENTE` (solo lectura: ve facturas, pagos, inventario, clientes y reportes, pero no vende, cobra ni modifica nada). **Cualquier otro rol no tiene permisos.**
- Cada persona puede cambiar su propia contraseña desde el botón de la llave en el menú; se pide la actual y queda registrado en la bitácora (`CAMBIAR_CONTRASENA`).
- Solo ADMIN: anular facturas y cobros, usuarios, series, negocio, crear y editar productos, reportes y bitácora.

## 3. Protección contra ataques web

| Ataque | Protección |
|---|---|
| **Inyección SQL** | Todo va por Prisma o por consultas con parámetros. No hay SQL armado con texto (0 usos de `Unsafe`). |
| **XSS** (inyectar código en la página) | React escapa el texto; no se usa `innerHTML`. Además la cabecera **Content-Security-Policy** bloquea scripts de otros sitios. |
| **CSRF** (otra página usa tu sesión abierta para cambiar datos) | Cookie `SameSite=Strict` + verificación del origen en cada petición que cambia datos (`limite-peticiones.ts`). |
| **Clickjacking** (incrustar el sistema en otra página) | `X-Frame-Options: DENY` y `frame-ancestors 'none'`. |
| **Fuerza bruta** | Límite de peticiones (login: 10 por minuto, sin sesión: 60, con sesión: 300) + bloqueo de cuenta tras 5 fallos. |
| Datos inválidos | Validación con `zod` en cada endpoint (tipos, largos, rangos). |
| Fuga de información | Los errores internos no muestran detalles; no se envía `X-Powered-By`. |

Cabeceras que se envían (`frontend/next.config.ts`): `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security`.

## 4. Cifrado y secretos
- Las llaves del certificador FEL se cifran con **AES-256-GCM** antes de guardarse; la API nunca las devuelve.
- Los secretos (`JWT_SECRET`, `ENCRYPTION_KEY`, la cadena de conexión) están en `frontend/.env`, que **git ignora**.
- La conexión a SQL Server va cifrada (`encrypt=true`).

## 5. Base de datos
- El usuario de la aplicación (`app_user`, rol `rol_app_facturacion`) **no puede** escribir directamente facturas, cobros,
  kardex ni historiales: solo ejecutar procedimientos. Tampoco puede cambiar la existencia (`stock_actual`) de un producto.
- Las facturas y los cobros no se borran, se anulan. Una factura certificada no se puede modificar.
- Kardex, cuenta corriente, historial de estados, auditoría y bitácora son de **solo inserción**.
- La auditoría guarda el antes y el después de los cambios en productos, clientes y usuarios, y quién los hizo
  (de la contraseña solo anota que cambió).
- El certificador simulado se niega a funcionar si el negocio está en PRODUCCIÓN.
- **Roles para personas** (`07_permisos.sql`): `rol_cajero`, `rol_admin` y `rol_auditor`, cada uno con solo lo que necesita.
  Ninguno puede leer las contraseñas (hash) ni las llaves del certificador. El auditor solo lee bitácora, auditoría e historiales.
  Se prueban en `database/pruebas/3_roles_y_permisos.sql`.
- **Bitácora de lecturas sensibles**: además de logins y cambios, se anota quién consultó un estado de cuenta, la lista de usuarios,
  la bitácora o el reporte de ventas (acciones `LEER_*`). Consulta de ejemplo en `09_consultas.sql` (#13).
- **Seguridad que vive en la base de datos** (`10_seguridad_db.sql`, pruebas en `5_seguridad_en_bd.sql`):
  - `ck_usuario_hash`: la contraseña solo se guarda si empieza con `$argon2id$` (el texto plano no entra, ni a mano).
  - `usp_login_bloqueado` y `usp_registrar_login`: el bloqueo de cuenta (5 fallos en 15 min) lo decide la base, y los intentos con
    usuarios que **no existen** también quedan en la bitácora (`bitacora.usuario_intentado`).
  - `tr_bitacora_alertas`: genera solas las filas `ALERTA_FUERZA_BRUTA` y `ALERTA_ANULACIONES`; se leen en `vw_alertas_seguridad`.
  - **Enmascarado de datos**: correo y teléfono del cliente se ven tapados para quien no tiene `UNMASK` (el auditor).
  - **Seguridad por fila**: quien entre a SQL como `rol_cajero` solo ve las facturas y cobros que creó (la aplicación, el admin y el auditor ven todo).
  - `11_auditoria_servidor.sql` (opcional, requiere sysadmin): auditoría nativa de SQL Server de logins, lecturas y cambios de permisos.
- **Eliminar clientes**: la aplicación no tiene permiso `DELETE` sobre `cliente`; solo puede ejecutar `usp_eliminar_cliente`, que rechaza al consumidor final y a cualquier cliente con facturas o cobros, y deja el rastro en la auditoría (pruebas en `9_eliminar_cliente.sql`).
- **Triggers de inventario**: `stock_actual` solo puede cambiar a un valor que ya esté en el kardex, incluso para quien tenga permisos de administrador.

## 6. Qué hacer al publicarlo (producción)

1. **HTTPS obligatorio.** Sin HTTPS, la cookie `Secure` y `Strict-Transport-Security` no sirven de nada.
2. **Proxy delante de la aplicación.** `docker-compose.yml` incluye uno (Caddy, con HTTPS automático): `docker compose up -d --build`.
   La aplicación no publica puertos y corre con `TRUST_PROXY=1`, así que el límite de peticiones y la IP de la bitácora usan la IP
   real que escribe el proxy: el límite de logins es **por persona (IP)** y no un contador único para todos. Con otro proxy
   (nginx, un balanceador), defina `TRUST_PROXY=1` en `.env` y que el proxy **sobrescriba** `X-Forwarded-For`, `X-Forwarded-Host`
   y `X-Forwarded-Proto` (ver `Caddyfile`). **No** lo defina si la aplicación está expuesta directamente: esa cabecera la puede
   falsificar cualquiera.
3. Quitar `trustServerCertificate=true` de `DATABASE_URL` y usar un certificado válido en SQL Server.
4. No instalar `06_certificador_simulado.sql` y poner el negocio en ambiente `PRODUCCION`.
5. Cambiar las contraseñas de prueba y generar un `JWT_SECRET` y un `ENCRYPTION_KEY` nuevos (nunca los de desarrollo).
6. **Respaldos**: programar copias de la base (ejemplo en `database/sql/respaldo.sql`) y guardarlas fuera del servidor.
7. Fijar el **puerto TCP** de SQL Server (hoy es dinámico y cambia al reiniciar).

## 7. Antes de subir a git
- Subir **solo el proyecto**, con su propio repositorio dentro de la carpeta `Bases de datos` (`git init` ahí), nunca desde la carpeta personal.
- `.env` y las copias de la base de datos (`*.bak`) están en `.gitignore`; la plantilla `frontend/.env.example` sí se sube.

## 8. Limitaciones conocidas
- El documento (NIT) del cliente no se puede enmascarar porque la columna calculada `documento_norm` depende de él.
- Las columnas no están cifradas en disco. Cifrarlas (Always Encrypted o TDE) requiere un driver compatible y configuración en el servidor; el NIT cifrado además impediría buscar y evitar duplicados.
- No hay doble factor (TOTP): es lógica de la aplicación (pantalla de alta con QR y verificación del código), no de la base.
- Con la seguridad por fila, un `rol_cajero` que cobre por SQL directo solo ve sus propias facturas y cobros, y lo que cuelga de ellos (líneas, historial, cobros aplicados, kardex y cuenta corriente).
- No hay autenticación de dos pasos ni recuperación de contraseña (un ADMIN la restablece desde Configuración).
- El límite de peticiones guarda sus contadores en memoria: se reinician con el servidor y no se comparten entre varias copias de la aplicación.
- La política de contraseñas no revisa listas de contraseñas filtradas ni obliga a cambiarlas cada cierto tiempo.
- El bloqueo de cuenta puede usarse para molestar a un usuario (fallar a propósito su contraseña); es el costo de frenar la fuerza bruta.

## Requisitos SAT y resiliencia del certificador (`13_sat_resiliencia.sql`)

- **Idempotencia:** cada factura tiene un `id_transaccion_fel` único e inmutable que se manda siempre al certificador; si hubo un timeout y se reintenta, no se crea una segunda factura.
- **Contingencia:** si el certificador no responde, la factura queda en `PENDIENTE_CERTIFICACION` (la venta no se pierde). Un proceso en segundo plano (`frontend/src/instrumentation.ts`, cada `FEL_REINTENTO_MINUTOS`, 0 = apagado) la reenvía; un ADMIN también puede lanzarlo con `POST /api/v1/facturas/reintentar`. Las facturas esperando se ven en `vw_facturas_por_certificar`.
- **Documento legal:** se guardan `url_xml`, `url_pdf` y el hash SHA-256 del XML certificado.
- **Validaciones en la base:** UUID de 36 caracteres; CUI de 13 dígitos; NIT con dígitos y dígito final o K; pasaporte de 5 a 20 caracteres. El dígito verificador del NIT/CUI se sigue revisando en la aplicación.
- **Límites:** no se probó con un certificador real; la anulación es un estado con `uuid_anulacion`, no un documento aparte; el reintento corre en el proceso de Next.js porque SQL Server no puede llamar a un servicio web.

## Respaldos
`database/sql/facturacion/respaldo_diario.sql` hace un respaldo completo y del log con un archivo por día de la semana (siempre 7, sin llenar el disco) y comprueba que se pueda leer. Para programarlo a las 2:00 en Windows, ejecuta una vez en una consola de comandos:

```
schtasks /Create /SC DAILY /ST 02:00 /TN "Respaldo proyecto_final" /TR "sqlcmd -S localhost\MSSQLSERVER01 -E -C -b -i \"C:\Users\coced\Desktop\Bases de datos\database\sql\facturacion\respaldo_diario.sql\""
```

Para quitarla: `schtasks /Delete /TN "Respaldo proyecto_final" /F`. La computadora debe estar encendida a esa hora.
