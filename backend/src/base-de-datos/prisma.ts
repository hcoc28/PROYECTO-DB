// ============================================================
// LIBRERÍA — conexión a la base de datos
// Crea una única instancia de Prisma Client compartida por
// toda la aplicación (evita abrir demasiadas conexiones).
// ============================================================

import { PrismaClient } from "@prisma/client";

// Singleton de Prisma: evita agotar el pool de conexiones de RDS
// con el hot-reload de Next.js en desarrollo.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
