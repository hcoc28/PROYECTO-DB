// ============================================================
// API — /api/v1/facturas/{uuid}  (GET, DELETE)
// Next.js exige que cada endpoint viva en una carpeta de esta ruta
// (la carpeta define la URL). La lógica real está en el backend:
// backend/src/api/facturas/factura-por-uuid.ts
// ============================================================

export { GET, DELETE } from "@backend/api/facturas/factura-por-uuid";
