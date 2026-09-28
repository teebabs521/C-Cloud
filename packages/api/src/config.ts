import path from "node:path";
import { promises as fs } from "node:fs";

export const PORT = Number(process.env.PORT ?? 4000);
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
export const DB_PATH = path.join(DATA_DIR, "c-cloud.sqlite");
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

/**
 * When set, job data (target credentials, generated SSH keys, DB passwords)
 * is encrypted at rest in SQLite. Strongly recommended outside of local/
 * throwaway use — see README's "Credentials at rest" section.
 */
export const ENCRYPTION_SECRET = process.env.CCLOUD_ENCRYPTION_KEY || undefined;

export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(EXTRACTED_DIR, { recursive: true });
}
