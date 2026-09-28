import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { JobStore } from "@c-cloud/migration-engine";
import { CORS_ORIGIN, DB_PATH, PORT, ensureDataDirs } from "./config.js";
import { registerMigrationRoutes } from "./routes/migrations.js";

async function main() {
  await ensureDataDirs();
  const store = new JobStore(DB_PATH);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 * 1024 } });

  app.get("/api/health", async () => ({ ok: true }));
  registerMigrationRoutes(app, store);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
