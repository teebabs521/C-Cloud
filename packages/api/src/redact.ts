import type { DnsProviderCredentials, MigrationJob, TargetCredentials } from "@c-cloud/migration-engine";

function redactTargetCredentials(creds: TargetCredentials | null): Record<string, unknown> | null {
  if (!creds) return null;
  if (creds.kind === "docker-vm") {
    const { privateKey, password, ...rest } = creds;
    return { ...rest, privateKey: privateKey ? "[redacted]" : undefined, password: password ? "[redacted]" : undefined };
  }
  const { accessKeyId, secretAccessKey, ...rest } = creds;
  return {
    ...rest,
    accessKeyId: accessKeyId ? `${accessKeyId.slice(0, 4)}${"*".repeat(Math.max(accessKeyId.length - 4, 0))}` : undefined,
    secretAccessKey: secretAccessKey ? "[redacted]" : undefined,
  };
}

function redactDnsProviderCredentials(creds: DnsProviderCredentials | null): Record<string, unknown> | null {
  if (!creds) return null;
  if (creds.kind === "cloudflare") {
    const { apiToken, ...rest } = creds;
    return { ...rest, apiToken: apiToken ? "[redacted]" : undefined };
  }
  const { accessKeyId, secretAccessKey, ...rest } = creds;
  return {
    ...rest,
    accessKeyId: accessKeyId ? `${accessKeyId.slice(0, 4)}${"*".repeat(Math.max(accessKeyId.length - 4, 0))}` : undefined,
    secretAccessKey: secretAccessKey ? "[redacted]" : undefined,
  };
}

/**
 * Strips input credentials (AWS keys, SSH password, DNS provider API
 * tokens/keys) before a job is sent to the client. Values C-Cloud generated
 * on the user's behalf (e.g. a fresh SSH private key for their new
 * instance, an RDS master password) are intentionally left in
 * `provisionedTarget.details` — the user needs those to access resources it
 * just created for them.
 */
export function toPublicJob(job: MigrationJob): Record<string, unknown> {
  return {
    ...job,
    targetCredentials: redactTargetCredentials(job.targetCredentials),
    dnsProviderCredentials: redactDnsProviderCredentials(job.dnsProviderCredentials),
  };
}
