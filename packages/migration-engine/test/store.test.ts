import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { JobStore } from "../src/orchestrator/store.js";
import { MigrationJob } from "../src/orchestrator/types.js";

function makeJob(id: string): MigrationJob {
  const ts = new Date().toISOString();
  return {
    id,
    status: "uploaded",
    createdAt: ts,
    updatedAt: ts,
    archivePath: "/tmp/x.tar.gz",
    extractedDir: null,
    plan: null,
    selection: null,
    targetCredentials: {
      kind: "docker-vm",
      host: "example.invalid",
      port: 22,
      username: "root",
      privateKey: "SUPER-SECRET-KEY-MATERIAL",
      remoteBaseDir: "/srv/site",
    },
    provisionedTarget: null,
    databaseCredentials: [],
    emailGuidance: [],
    dnsInstructions: [],
    error: null,
  };
}

function tmpDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "c-cloud-store-test-")), "jobs.sqlite");
}

describe("JobStore encryption", () => {
  it("round-trips a job when an encryption secret is configured", () => {
    const dbPath = tmpDbPath();
    const store = new JobStore(dbPath, { encryptionSecret: "test-secret" });
    const job = makeJob("job-1");
    store.create(job);

    const fetched = store.get("job-1");
    expect(fetched?.targetCredentials).toMatchObject({ host: "example.invalid" });
    if (fetched?.targetCredentials?.kind === "docker-vm") {
      expect(fetched.targetCredentials.privateKey).toBe("SUPER-SECRET-KEY-MATERIAL");
    } else {
      throw new Error("expected docker-vm credentials");
    }
  });

  it("never writes the secret key material in plaintext to the sqlite file", () => {
    const dbPath = tmpDbPath();
    const store = new JobStore(dbPath, { encryptionSecret: "test-secret" });
    store.create(makeJob("job-2"));

    const raw = new Database(dbPath).prepare("SELECT data, encrypted FROM jobs WHERE id = ?").get("job-2") as {
      data: string;
      encrypted: number;
    };
    expect(raw.encrypted).toBe(1);
    expect(raw.data).not.toContain("SUPER-SECRET-KEY-MATERIAL");
  });

  it("throws when reading an encrypted row without the secret configured", () => {
    const dbPath = tmpDbPath();
    const writer = new JobStore(dbPath, { encryptionSecret: "test-secret" });
    writer.create(makeJob("job-3"));

    const reader = new JobStore(dbPath);
    expect(() => reader.get("job-3")).toThrow(/encryption secret/i);
  });

  it("stores plain JSON when no secret is configured", () => {
    const dbPath = tmpDbPath();
    const store = new JobStore(dbPath);
    store.create(makeJob("job-4"));

    const raw = new Database(dbPath).prepare("SELECT data, encrypted FROM jobs WHERE id = ?").get("job-4") as {
      data: string;
      encrypted: number;
    };
    expect(raw.encrypted).toBe(0);
    expect(raw.data).toContain("SUPER-SECRET-KEY-MATERIAL");
  });
});
