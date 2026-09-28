import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LEN);
}

/**
 * Encrypts an arbitrary JSON-serializable value with AES-256-GCM, deriving
 * a per-call key from `secret` + a fresh random salt (so the same secret
 * never reuses a key/IV pair across rows). Output is a single
 * `salt.iv.authTag.ciphertext` string (each segment base64), safe to store
 * as one SQLite column.
 */
export function encryptJson(secret: string, value: unknown): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(secret, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptJson<T>(secret: string, payload: string): T {
  const parts = payload.split(".");
  if (parts.length !== 4) throw new Error("Malformed encrypted payload (expected salt.iv.tag.ciphertext)");
  const [saltB64, ivB64, tagB64, ciphertextB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
