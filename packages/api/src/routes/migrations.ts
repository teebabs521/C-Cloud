import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  DnsProviderCredentials,
  JobStore,
  MigrationJob,
  MigrationSelection,
  TargetCredentials,
  applyDnsCutover,
  extractBackupArchive,
  parseJob,
  runMigration,
} from "@c-cloud/migration-engine";
import { EXTRACTED_DIR, UPLOADS_DIR } from "../config.js";
import { toPublicJob } from "../redact.js";

function nowIso(): string {
  return new Date().toISOString();
}

function newJobSkeleton(id: string, archivePath: string): MigrationJob {
  const ts = nowIso();
  return {
    id,
    status: "uploaded",
    createdAt: ts,
    updatedAt: ts,
    archivePath,
    extractedDir: null,
    plan: null,
    selection: null,
    targetCredentials: null,
    provisionedTarget: null,
    databaseCredentials: [],
    emailGuidance: [],
    dnsInstructions: [],
    dnsProviderCredentials: null,
    dnsCutoverAppliedAt: null,
    error: null,
  };
}

function defaultSelection(job: MigrationJob): MigrationSelection {
  const plan = job.plan;
  return {
    domains: plan?.domains.map((d) => d.domain) ?? [],
    databases: plan?.databases.map((d) => d.name) ?? [],
    emailAccounts: plan?.emailAccounts.map((a) => a.address) ?? [],
    emailForwarders: true,
    cronJobs: true,
    dnsZones: true,
  };
}

export function registerMigrationRoutes(app: FastifyInstance, store: JobStore): void {
  app.get("/api/migrations", async () => {
    return store.list().map(toPublicJob);
  });

  app.get<{ Params: { id: string } }>("/api/migrations/:id", async (request, reply) => {
    const job = store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: "job not found" });
    return toPublicJob(job);
  });

  app.post("/api/migrations", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "expected a multipart file field named 'backup'" });
    if (!/\.(tar\.gz|tgz|tar)$/i.test(file.filename)) {
      return reply.code(400).send({ error: "expected a .tar.gz/.tgz/.tar cPanel backup archive" });
    }

    const id = randomUUID();
    const archivePath = path.join(UPLOADS_DIR, `${id}-${file.filename}`);
    await pipeline(file.file, createWriteStream(archivePath));

    const job = newJobSkeleton(id, archivePath);
    store.create(job);
    store.appendLog(id, `Received upload ${file.filename}.`);

    reply.code(202).send(toPublicJob(job));

    // Extract + parse in the background; client polls GET /api/migrations/:id or the log stream.
    (async () => {
      try {
        store.appendLog(id, "Extracting archive...");
        const extractedDir = await extractBackupArchive(archivePath, EXTRACTED_DIR);
        const current = store.get(id);
        if (!current) return;
        current.extractedDir = extractedDir;
        store.update(current);
        await parseJob(store, id);
      } catch (err) {
        const failed = store.get(id);
        if (failed) {
          failed.status = "failed";
          failed.error = err instanceof Error ? err.message : String(err);
          store.update(failed);
        }
        store.appendLog(id, `Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  });

  app.put<{ Params: { id: string }; Body: MigrationSelection }>(
    "/api/migrations/:id/selection",
    async (request, reply) => {
      const job = store.get(request.params.id);
      if (!job) return reply.code(404).send({ error: "job not found" });
      if (!job.plan) return reply.code(409).send({ error: "backup has not finished parsing yet" });
      job.selection = request.body ?? defaultSelection(job);
      store.update(job);
      return toPublicJob(job);
    }
  );

  app.put<{ Params: { id: string }; Body: TargetCredentials }>(
    "/api/migrations/:id/target",
    async (request, reply) => {
      const job = store.get(request.params.id);
      if (!job) return reply.code(404).send({ error: "job not found" });
      if (!request.body?.kind) return reply.code(400).send({ error: "missing target credentials" });
      job.targetCredentials = request.body;
      store.update(job);
      return toPublicJob(job);
    }
  );

  app.post<{ Params: { id: string } }>("/api/migrations/:id/start", async (request, reply) => {
    const job = store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: "job not found" });
    if (!job.plan) return reply.code(409).send({ error: "backup has not finished parsing yet" });
    if (!job.selection) job.selection = defaultSelection(job);
    if (!job.targetCredentials) return reply.code(409).send({ error: "no target configured for this job" });
    store.update(job);

    reply.code(202).send(toPublicJob(job));

    runMigration(store, job.id).catch((err) => {
      request.log.error(err, `migration ${job.id} failed`);
    });
  });

  app.put<{ Params: { id: string }; Body: DnsProviderCredentials }>(
    "/api/migrations/:id/dns-provider",
    async (request, reply) => {
      const job = store.get(request.params.id);
      if (!job) return reply.code(404).send({ error: "job not found" });
      if (!request.body?.kind) return reply.code(400).send({ error: "missing DNS provider credentials" });
      job.dnsProviderCredentials = request.body;
      store.update(job);
      return toPublicJob(job);
    }
  );

  app.post<{ Params: { id: string } }>("/api/migrations/:id/dns/apply", async (request, reply) => {
    const job = store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: "job not found" });
    if (job.status !== "cutover_ready" && job.status !== "complete") {
      return reply.code(409).send({ error: `job is not ready for DNS cutover (status: ${job.status})` });
    }
    if (!job.dnsProviderCredentials) {
      return reply.code(409).send({ error: "no DNS provider configured for this job" });
    }
    try {
      await applyDnsCutover(store, job.id);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return toPublicJob(store.get(job.id)!);
  });

  app.get<{ Params: { id: string } }>("/api/migrations/:id/logs", async (request, reply) => {
    const job = store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: "job not found" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const lastEventIdHeader = request.headers["last-event-id"];
    let lastId = lastEventIdHeader ? Number(lastEventIdHeader) : 0;

    const send = () => {
      const { rows, lastId: newLastId } = store.getLogs(job.id, lastId);
      for (const row of rows) {
        lastId += 1;
        reply.raw.write(`id: ${lastId}\ndata: ${JSON.stringify(row)}\n\n`);
      }
      lastId = newLastId;
    };

    send();
    const interval = setInterval(() => {
      send();
      const current = store.get(job.id);
      if (current && (current.status === "complete" || current.status === "cutover_ready" || current.status === "failed")) {
        reply.raw.write(`event: done\ndata: ${current.status}\n\n`);
        clearInterval(interval);
        reply.raw.end();
      }
    }, 1000);

    request.raw.on("close", () => clearInterval(interval));
  });
}
