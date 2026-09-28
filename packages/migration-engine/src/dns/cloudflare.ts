import { DnsInstruction, DnsProviderAdapter, DnsProviderCredentials } from "./types.js";

function asCloudflare(creds: DnsProviderCredentials) {
  if (creds.kind !== "cloudflare") throw new Error("CloudflareDnsAdapter received non-cloudflare credentials");
  return creds;
}

interface CloudflareApiError {
  message: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  errors: CloudflareApiError[];
  result: T;
}

async function cfFetch<T>(apiToken: string, path: string, init?: RequestInit): Promise<CloudflareApiResponse<T>> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as CloudflareApiResponse<T>;
  if (!res.ok || body.success === false) {
    const message = body.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Cloudflare API error: ${message}`);
  }
  return body;
}

function recordName(instruction: DnsInstruction): string {
  return instruction.name === "@" ? instruction.domain : `${instruction.name}.${instruction.domain}`;
}

/** Cloudflare wants MX priority as its own field and no trailing dot on hostnames. */
function splitMxValue(value: string): { priority: number; host: string } {
  const [priorityRaw, ...rest] = value.split(" ");
  const priority = Number(priorityRaw);
  return { priority: Number.isFinite(priority) ? priority : 10, host: rest.join(" ").replace(/\.$/, "") };
}

function recordContent(instruction: DnsInstruction): string {
  if (instruction.recordType === "MX") return splitMxValue(instruction.value).host;
  if (instruction.recordType === "CNAME") return instruction.value.replace(/\.$/, "");
  return instruction.value;
}

interface CloudflareDnsRecord {
  id: string;
}

/** Pushes DNS cutover instructions to Cloudflare, upserting by (type, name) within the given zone. */
export const cloudflareDnsAdapter: DnsProviderAdapter = {
  kind: "cloudflare",

  async applyRecords(credentials, instructions, log): Promise<void> {
    const creds = asCloudflare(credentials);

    for (const instruction of instructions) {
      const name = recordName(instruction);
      const content = recordContent(instruction);

      log(`Looking up existing ${instruction.recordType} record for ${name}...`);
      const existing = await cfFetch<CloudflareDnsRecord[]>(
        creds.apiToken,
        `/zones/${creds.zoneId}/dns_records?type=${instruction.recordType}&name=${encodeURIComponent(name)}`
      );

      const payload: Record<string, unknown> = {
        type: instruction.recordType,
        name,
        content,
        ttl: 1, // Cloudflare's "automatic" TTL.
      };
      if (instruction.recordType === "MX") payload.priority = splitMxValue(instruction.value).priority;

      const recordId = existing.result[0]?.id;
      if (recordId) {
        log(`Updating ${instruction.recordType} ${name} -> ${content}`);
        await cfFetch(creds.apiToken, `/zones/${creds.zoneId}/dns_records/${recordId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        log(`Creating ${instruction.recordType} ${name} -> ${content}`);
        await cfFetch(creds.apiToken, `/zones/${creds.zoneId}/dns_records`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
    }
  },
};
