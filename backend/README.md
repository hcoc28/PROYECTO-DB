# Backend

Aquí vive **todo el código del servidor**: la lógica de cada endpoint, la
facturación, la seguridad y la conexión a la base de datos. El frontend
(`../frontend`) solo tiene las pantallas y unos archivos delgados que conectan
cada URL con su lógica de aquí.

## Carpetas (`src/`)

| Carpeta | Qué contiene |
|---|---|
| `api/` | La lógica de cada endpoint, una carpeta por recurso (`facturas/`, `pagos/`, `productos/`…) |
| `servicios/` | Lógica de negocio: `facturacion.ts` crea la factura y la certifica (la base descuenta inventario y calcula saldos); `cobros.ts`, `reintentos.ts` y `negocio-activo.ts` |
| `fel/` | Todo lo específico de facturación electrónica: cálculo de IVA, XML, certificadores |
| `seguridad/` | Sesión y permisos (`auth.ts`), bitácora (`audit.ts`), bloqueo de cuenta (`bloqueo.ts`), contraseñas (`contrasena.ts`), cookie (`sesion-cookie.ts`), IP confiable (`cliente.ts`), cifrado (`crypto.ts`), límite de peticiones |
| `base-de-datos/` | Conexión a SQL Server con Prisma (`prisma.ts`), traducción de errores de la base (`sql.ts`) y adaptadores |
| `comun/` | Formato uniforme de las respuestas y manejo de errores (`respuestas.ts`) |
| `validaciones/` | Validar NIT y DPI (CUI): dígito verificador, departamento y municipio |

## Endpoints (`src/api/`)

| URL | Archivo |
|---|---|
| `POST /api/v1/auth/login`, `logout`, `cambiar-password` | `api/auth/` |
| `/api/v1/facturas`, `/facturas/{uuid}`, `POST /facturas/reintentar` | `api/facturas/` |
| `/api/v1/negocio` | `api/negocio/negocio.ts` |
| `/api/v1/pagos`, `/pagos/{id}`, `/pagos/por-cobrar` | `api/pagos/` |
| `POST /api/v1/pos/ventas` | `api/pos/pos-ventas.ts` |
| `/api/v1/productos`, `/productos/{id}`, `/productos/{id}/kardex`, `/unidades` | `api/productos/` |
| `/api/v1/clientes`, `/clientes/{id}`, `/clientes/{id}/estado-cuenta` | `api/clientes/` |
| `GET /api/v1/reportes/ventas`, `/reportes/resumen` | `api/reportes/` |
| `/api/v1/series`, `/series/{id}` | `api/series/` |
| `/api/v1/usuarios`, `/usuarios/{id}` | `api/usuarios/` |
| `GET /api/v1/bitacora` | `api/bitacora/bitacora.ts` |

## ¿Por qué el frontend tiene archivos `route.ts`?

Next.js decide la URL de un endpoint por la **carpeta** donde está el archivo,
y esa carpeta tiene que estar dentro del proyecto Next.js (`frontend/src/app/api/v1/...`).
Por eso allí quedan archivos de una sola línea, por ejemplo:

```ts
export { GET, POST } from "@backend/api/facturas/facturas";
```

La lógica real está aquí; ese archivo solo la conecta con su URL.

`@backend` es un alias configurado en `frontend/tsconfig.json` que apunta a
`backend/src`. Dentro del backend los archivos se importan entre sí con rutas
relativas (`../seguridad/auth`), nunca con `@/`.

## Si agregas un endpoint nuevo

1. Crea la lógica en `src/api/<recurso>/<nombre>.ts` exportando `GET`, `POST`, etc.
   envueltos en `manejarErrores(...)`.
2. Crea `frontend/src/app/api/v1/<recurso>/route.ts` con una sola línea:
   `export { GET } from "@backend/api/<recurso>/<nombre>";`
