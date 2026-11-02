# Mi Negocio FEL

Sistema de punto de venta con facturación electrónica FEL Guatemala, inventario,
pagos, auditoría y base de datos SQL Server separada.

**Pila:** Next.js 16 · TypeScript · React 19 · Tailwind CSS v4 · Prisma · SQL Server.

## Estructura ordenada

```text
backend/                       TODO el código del servidor
  src/api/                     Lógica de cada endpoint (facturas, pagos, productos…)
  src/servicios/               Lógica de negocio (facturación)
  src/fel/                     Facturación electrónica: IVA, XML, certificadores
  src/seguridad/               Sesión, permisos, bitácora, cifrado, límite de peticiones
  src/base-de-datos/           Conexión a SQL Server (Prisma)
  src/comun/                   Formato de respuestas y manejo de errores
  src/validaciones/            Validar NIT y DPI (CUI)

frontend/                      Lo que ve el usuario
  src/app/                     Pantallas
  src/app/api/v1/              Archivos de una línea que conectan cada URL con el backend
  src/lib/client/              Utilidades del frontend (API, notificaciones, bienvenida, CSV)
  src/proxy.ts                 Entrada del límite de peticiones
  public/                      Archivos públicos
  .env                         Variables locales de la app
  next.config.ts               Configuración Next.js
  tsconfig.json                Configuración TypeScript

database/
  prisma/schema.prisma         Modelo Prisma para SQL Server
  sql/facturacion/             Scripts SQL Server (tablas, vistas, procedimientos, triggers, permisos, seguridad)
  sql/respaldo.sql             Respaldo de la base

docs/
  seguridad.md                 Seguridad del sistema y guía de despliegue

Dockerfile, docker-compose.yml Aplicación detrás de un proxy con HTTPS (Caddy)
```

Los documentos de la entrega (script completo `script.sql`, MER, documento técnico,
diccionario de datos y capturas del sistema) se entregan aparte, fuera del repositorio.

## Comandos desde la raíz

```bash
npm run dev
npm run build
npm run typecheck
npm run prisma:validate
npm run prisma:generate
```

## Base de datos

Las reglas de negocio (totales, inventario, saldos, historial, auditoría) viven **en SQL Server**,
no en la aplicación. La base se llama `proyecto_final` y se instala con los scripts de
[database/sql/facturacion](database/sql/facturacion) — ver [database/README.md](database/README.md).

El archivo `.env` está dentro de `frontend/`, y los comandos de Prisma ya están
configurados para leerlo desde ahí.

## Rutas principales

- POS: `http://localhost:3000/pos`
- Facturas: `http://localhost:3000/facturas`
- Inventario: `http://localhost:3000/inventario`
- Pagos: `http://localhost:3000/pagos`
- Reportes: `http://localhost:3000/reportes`

## Funciones principales

- La referencia o número de autorización del banco en un cobro es **opcional** (la base la exige solo si el método de pago se configura con `requiere_referencia = 1`).
- Punto de venta, facturas FEL (simulador de certificador en desarrollo), cobros y abonos, cuentas por cobrar e inventario con kardex.
- Clientes con NIT o DPI (CUI) validados; notas de crédito desde el detalle de la factura (solo ADMIN).
- Roles de la aplicación ADMIN, CAJERO y GERENTE (y roles de base rol_auditor y rol_consulta); bitácora, bloqueo de cuenta, cierre de sesiones y límite de peticiones.
- Notificaciones en pantalla y un saludo de bienvenida distinto en cada sesión.

## Producción con proxy (límite de logins por IP)

```bash
docker compose up -d --build
```

El proxy (Caddy) es lo único publicado; la aplicación corre con `TRUST_PROXY=1` y ve la IP real de cada visitante. Sin proxy, deje `TRUST_PROXY` apagado. Detalles en [docs/seguridad.md](docs/seguridad.md).
