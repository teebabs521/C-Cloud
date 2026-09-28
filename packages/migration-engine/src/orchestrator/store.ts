import Database from "better-sqlite3";
import { decryptJson, encryptJson } from "./crypto.js";
import { JobLogEntry, MigrationJob } from "./types.js";

export interface JobStoreOptions {
  /**
   * When set, each job row's `data` column (which holds the full job JSON —
   * including target credentials, generated SSH keys and DB passwords) is
   * encrypted at rest with AES-256-GCM using this secret. Without it, jobs
   * are stored as plain JSON, which is fine for local/throwaway use but not
   * for anything shared or persisted long-term.
   */
  encryptionSecret?: string;
}

/** Thin SQLite-backed persistence for migration jobs and their progress logs. */
export class JobStore {
  private db: Database.Database;
  private encryptionSecret?: string;

  constructor(dbPath: string, options: JobStoreOptions = {}) {
    this.encryptionSecret = options.encryptionSecret;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);
    `);
    const columns = this.db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "encrypted")) {
      this.db.exec("ALTER TABLE jobs ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0");
    }
  }

  private serialize(job: MigrationJob): { data: string; encrypted: 0 | 1 } {
    if (this.encryptionSecret) {
      return { data: encryptJson(this.encryptionSecret, job), encrypted: 1 };
    }
    return { data: JSON.stringify(job), encrypted: 0 };
  }

  private deserialize(row: { data: string; encrypted: number }): MigrationJob {
    if (row.encrypted) {
      if (!this.encryptionSecret) {
        throw new Error(
          "This job's data is encrypted but no encryption secret is configured (set CCLOUD_ENCRYPTION_KEY)."
        );
      }
      return decryptJson<MigrationJob>(this.encryptionSecret, row.data);
    }
    return JSON.parse(row.data) as MigrationJob;
  }

  create(job: MigrationJob): void {
    const { data, encrypted } = this.serialize(job);
    this.db
      .prepare("INSERT INTO jobs (id, status, created_at, updated_at, encrypted, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(job.id, job.status, job.createdAt, job.updatedAt, encrypted, data);
  }

  get(id: string): MigrationJob | null {
    const row = this.db.prepare("SELECT data, encrypted FROM jobs WHERE id = ?").get(id) as
      | { data: string; encrypted: number }
      | undefined;
    return row ? this.deserialize(row) : null;
  }

  update(job: MigrationJob): void {
    job.updatedAt = new Date().toISOString();
    const { data, encrypted } = this.serialize(job);
    this.db
      .prepare("UPDATE jobs SET status = ?, updated_at = ?, encrypted = ?, data = ? WHERE id = ?")
      .run(job.status, job.updatedAt, encrypted, data, job.id);
  }

  list(): MigrationJob[] {
    const rows = this.db.prepare("SELECT data, encrypted FROM jobs ORDER BY created_at DESC").all() as {
      data: string;
      encrypted: number;
    }[];
    return rows.map((r) => this.deserialize(r));
  }

  appendLog(jobId: string, message: string): JobLogEntry {
    const entry: JobLogEntry = { jobId, timestamp: new Date().toISOString(), message };
    this.db
      .prepare("INSERT INTO job_logs (job_id, timestamp, message) VALUES (?, ?, ?)")
      .run(entry.jobId, entry.timestamp, entry.message);
    return entry;
  }

  getLogs(jobId: string, sinceId = 0): { rows: JobLogEntry[]; lastId: number } {
    const rows = this.db
      .prepare("SELECT id, job_id, timestamp, message FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id ASC")
      .all(jobId, sinceId) as { id: number; job_id: string; timestamp: string; message: string }[];
    const lastId = rows.length ? rows[rows.length - 1].id : sinceId;
    return {
      rows: rows.map((r) => ({ jobId: r.job_id, timestamp: r.timestamp, message: r.message })),
      lastId,
    };
  }
}
