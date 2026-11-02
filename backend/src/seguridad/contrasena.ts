// ============================================================
// SEGURIDAD — política de contraseñas
// Una contraseña débil es la forma más fácil de entrar a un sistema.
// Se exige: 8 a 100 caracteres, con minúscula, mayúscula y número.
// Se usa al crear un usuario y al restablecer su contraseña.
// ============================================================

import { z } from "zod";

export const esquemaContrasena = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(100, "La contraseña es demasiado larga")
  .regex(/[a-z]/, "La contraseña debe incluir una letra minúscula")
  .regex(/[A-Z]/, "La contraseña debe incluir una letra mayúscula")
  .regex(/[0-9]/, "La contraseña debe incluir un número");
