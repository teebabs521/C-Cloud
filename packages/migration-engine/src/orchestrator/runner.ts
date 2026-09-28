import { TargetAdapter } from "../adapters/types.js";
import { dockerVmAdapter } from "../adapters/dockerVm/dockerVmAdapter.js";
import { awsAdapter } from "../adapters/aws/awsAdapter.js";
import { dnsAdaptersByKind } from "../dns/registry.js";
import { DnsInstruction } from "../dns/types.js";
import { parseCpanelBackup } from "../parser/cpanelBackup.js";
import { JobStore } from "./store.js";
import { MigrationJob } from "./types.js";

export const adaptersByKind: Record<string, TargetAdapter> = {
  "docker-vm": dockerVmAdapter,
  aws: awsAdapter,
};

function requireJob(store: JobStore, jobId: string): MigrationJob {
  const job = store.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  return job;
}

/** Parses the extracted backup and stores the resulting plan on the job. */
export async function parseJob(store: JobStore, jobId: string): Promise<void> {
  const job = requireJob(store, jobId);
  job.status = "parsing";
  store.update(job);
  store.appendLog(jobId, "Parsing cPanel backup...");
  try {
    if (!job.extractedDir) throw new Error("Job has no extracted backup directory");
    const plan = await parseCpanelBackup(job.extractedDir);
    job.plan = plan;
    job.status = "parsed";
    store.update(job);
    store.appendLog(jobId, `Parse complete: ${plan.domains.length} domain(s), ${plan.databases.length} database(s), ${plan.emailAccounts.length} mailbox(es), ${plan.cronJobs.length} cron job(s).`);
    for (const warning of plan.warnings) store.appendLog(jobId, `WARNING: ${warning}`);
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    store.update(job);
    store.appendLog(jobId, `Parse failed: ${job.error}`);
    throw err;
  }
}

function buildDnsInstructions(job: MigrationJob): DnsInstruction[] {
  if (!job.plan || !job.provisionedTarget) return [];
  const instructions: DnsInstruction[] = [];
  for (const domain of job.plan.domains) {
    if (!job.selection?.domains.includes(domain.domain)) continue;
    instructions.push({
      domain: domain.domain,
      recordType: "A",
      name: "@",
      value: job.provisionedTarget.address,
      note: "Point the apex domain at the new host. Lower the TTL on this record a day before cutover if possible.",
    });
    instructions.push({
      domain: domain.domain,
      recordType: "A",
      name: "www",
      value: job.provisionedTarget.address,
      note: "Point www at the new host too, unless you're handling it with a CNAME elsewhere.",
    });
  }
  return instructions;
}

/**
 * Runs the full migration pipeline for a job that already has a plan,
 * selection, and target credentials attached. Emits progress via the job
 * store's log table so a caller (e.g. an SSE endpoint) can tail it live.
 */
export async function runMigration(store: JobStore, jobId: string): Promise<void> {
  const job = requireJob(store, jobId);
  if (!job.plan || !job.selection || !job.targetCredentials) {
    throw new Error("Job is missing plan/selection/target credentials");
  }
  const adapter = adaptersByKind[job.targetCredentials.kind];
  if (!adapter) throw new Error(`No adapter registered for target kind ${job.targetCredentials.kind}`);

  const log = (message: string) => store.appendLog(jobId, message);

  try {
    job.status = "provisioning";
    store.update(job);
    log(`Provisioning ${job.targetCredentials.kind} target...`);
    job.provisionedTarget = await adapter.provision(job.targetCredentials, job.plan, log);
    store.update(job);

    job.status = "transferring_files";
    store.update(job);
    await adapter.transferFiles(job.targetCredentials, job.provisionedTarget, job.plan, job.selection, log);

    job.status = "importing_databases";
    store.update(job);
    job.databaseCredentials = await adapter.importDatabases(
      job.targetCredentials,
      job.provisionedTarget,
      job.plan,
      job.selection,
      log
    );
    store.update(job);

    job.status = "configuring_cron";
    store.update(job);
    await adapter.setupCronJobs(job.targetCredentials, job.provisionedTarget, job.plan, job.selection, log);

    job.status = "configuring_email";
    store.update(job);
    job.emailGuidance = await adapter.setupEmail(job.targetCredentials, job.provisionedTarget, job.plan, job.selection, log);

    job.dnsInstructions = buildDnsInstructions(job);
    job.status = "cutover_ready";
    store.update(job);
    log(
      job.dnsProviderCredentials
        ? "Migration complete. Verify the new site, then apply the DNS cutover when ready."
        : "Migration complete. Review the DNS cutover checklist, verify the new site, then update your DNS records when ready."
    );
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    store.update(job);
    log(`Migration failed: ${job.error}`);
    throw err;
  }
}

/**
 * Pushes the job's DNS cutover instructions to whichever provider is
 * configured on it. Left as an explicit, separate step from runMigration —
 * changing DNS is meant to be a deliberate action once the new site has
 * been verified, not something that fires automatically the moment file/DB
 * transfer finishes.
 */
export async function applyDnsCutover(store: JobStore, jobId: string): Promise<void> {
  const job = requireJob(store, jobId);
  if (job.status !== "cutover_ready" && job.status !== "complete") {
    throw new Error(`Job is not ready for DNS cutover (status: ${job.status})`);
  }
  if (!job.dnsProviderCredentials) throw new Error("No DNS provider configured for this job");
  if (job.dnsInstructions.length === 0) throw new Error("No DNS instructions to apply");

  const adapter = dnsAdaptersByKind[job.dnsProviderCredentials.kind];
  if (!adapter) throw new Error(`No DNS adapter registered for provider kind ${job.dnsProviderCredentials.kind}`);

  const log = (message: string) => store.appendLog(jobId, message);
  try {
    log(`Applying DNS cutover via ${job.dnsProviderCredentials.kind}...`);
    await adapter.applyRecords(job.dnsProviderCredentials, job.dnsInstructions, log);
    job.dnsCutoverAppliedAt = new Date().toISOString();
    job.status = "complete";
    store.update(job);
    log("DNS cutover applied.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.appendLog(jobId, `DNS cutover failed: ${message}`);
    throw err;
  }
}
