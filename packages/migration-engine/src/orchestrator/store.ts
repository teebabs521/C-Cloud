import Database from "better-sqlite3";
import { JobLogEntry, MigrationJob } from "./types.js";

/** Thin SQLite-backed persistence for migration jobs and their progress logs. */
export class JobStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
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
  }

  create(job: MigrationJob): void {
    this.db
      .prepare("INSERT INTO jobs (id, status, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?)")
      .run(job.id, job.status, job.createdAt, job.updatedAt, JSON.stringify(job));
  }

  get(id: string): MigrationJob | null {
    const row = this.db.prepare("SELECT data FROM jobs WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as MigrationJob) : null;
  }

  update(job: MigrationJob): void {
    job.updatedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE jobs SET status = ?, updated_at = ?, data = ? WHERE id = ?")
      .run(job.status, job.updatedAt, JSON.stringify(job), job.id);
  }

  list(): MigrationJob[] {
    const rows = this.db.prepare("SELECT data FROM jobs ORDER BY created_at DESC").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as MigrationJob);
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
