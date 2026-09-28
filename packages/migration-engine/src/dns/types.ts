import { LogFn } from "../adapters/types.js";

export interface DnsInstruction {
  domain: string;
  recordType: "A" | "MX" | "CNAME";
  name: string;
  value: string;
  note: string;
}

export interface CloudflareDnsCredentials {
  kind: "cloudflare";
  apiToken: string;
  zoneId: string;
}

export interface Route53DnsCredentials {
  kind: "route53";
  /** Mostly irrelevant for Route53 (it's a global service) — any valid AWS region works. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  hostedZoneId: string;
}

export type DnsProviderCredentials = CloudflareDnsCredentials | Route53DnsCredentials;

/** Pushes a migration's DNS cutover instructions to a real DNS provider, upserting each record. */
export interface DnsProviderAdapter {
  readonly kind: DnsProviderCredentials["kind"];
  applyRecords(credentials: DnsProviderCredentials, instructions: DnsInstruction[], log: LogFn): Promise<void>;
}
