// ============================================================
// LIBRERÍA — cifrado
// Cifra y descifra las llaves del certificador FEL antes de
// guardarlas en la base de datos (nunca en texto plano).
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ============================================================
// Cifrado AES-256-GCM para datos sensibles en reposo:
// llaves del certificador FEL, tokens de pasarelas, etc.
// Formato almacenado: base64(iv):base64(tag):base64(cifrado)
// La llave vive SOLO en ENCRYPTION_KEY (AWS Secrets Manager en prod).
// ============================================================

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error("ENCRYPTION_KEY no configurada");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY debe ser de 32 bytes en base64");
  return key;
}

export function cifrar(textoPlano: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${cifrado.toString("base64")}`;
}

export function descifrar(almacenado: string): string {
  const [ivB64, tagB64, dataB64] = almacenado.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Formato de dato cifrado inválido");
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
