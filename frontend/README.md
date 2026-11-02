# Frontend

Aplicación web en Next.js: las pantallas que ve el usuario.

## Contenido

- `src/app`: pantallas (`page.tsx`), el layout y los componentes compartidos (`_components`: barra lateral, ventanas de pago, anulación, nota de crédito y contraseña, y las notificaciones `Avisos`).
- `src/app/api/v1`: archivos `route.ts` de una línea que conectan cada URL con su
  lógica en `../backend/src/api` (Next.js exige que vivan aquí).
- `src/lib/client`: utilidades usadas por las pantallas (fetch con sesión, notificaciones `avisos.ts`, saludo `bienvenida.ts`, descarga CSV, formato de dinero).
- `src/proxy.ts`: punto de entrada del límite de peticiones (la lógica está en el backend).
- `public`: archivos públicos.

El código del servidor (facturación, seguridad, base de datos) **no** está aquí:
vive en `../backend/src`. Se importa con el alias `@backend/...`.

## Comandos desde la raíz del proyecto

```bash
npm run dev
npm run build
npm run start
```

La raíz mantiene los comandos para que no tengas que entrar manualmente a esta carpeta.
