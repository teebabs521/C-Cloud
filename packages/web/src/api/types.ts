export interface CpanelDomain {
  domain: string;
  isPrimary: boolean;
  documentRoot: string;
  subdomains: string[];
}

export interface CpanelDatabase {
  name: string;
  dumpFile: string;
  users: string[];
  sizeBytes: number;
}

export interface CpanelEmailAccount {
  address: string;
  domain: string;
  maildirPath: string;
  sizeBytes: number;
}

export interface CpanelEmailForwarder {
  from: string;
  to: string;
}

export interface CpanelCronJob {
  schedule: string;
  command: string;
  raw: string;
}

export interface CpanelBackupPlan {
  cpanelUser: string;
  domains: CpanelDomain[];
  homedir: { path: string; publicHtmlByDomain: Record<string, string>; sizeBytes: number };
  databases: CpanelDatabase[];
  emailAccounts: CpanelEmailAccount[];
  emailForwarders: CpanelEmailForwarder[];
  cronJobs: CpanelCronJob[];
  dnsZones: Record<string, unknown>;
  phpConfigs: { domain: string; phpVersion: string | null }[];
  warnings: string[];
}

export interface MigrationSelection {
  domains: string[];
  databases: string[];
  emailAccounts: string[];
  emailForwarders: boolean;
  cronJobs: boolean;
  dnsZones: boolean;
}

export type DockerVmCredentials = {
  kind: "docker-vm";
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  remoteBaseDir: string;
};

export type AwsCredentials = {
  kind: "aws";
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  computeMode: "lightsail" | "ec2-rds";
  instanceType: string;
  keyPairName: string;
};

export type TargetCredentials = DockerVmCredentials | AwsCredentials;

export interface ProvisionedTarget {
  address: string;
  details: Record<string, string>;
}

export interface DatabaseCredentialsOut {
  database: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface DnsInstruction {
  domain: string;
  recordType: "A" | "MX" | "CNAME";
  name: string;
  value: string;
  note: string;
}

export type CloudflareDnsCredentials = {
  kind: "cloudflare";
  apiToken: string;
  zoneId: string;
};

export type Route53DnsCredentials = {
  kind: "route53";
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  hostedZoneId: string;
};

export type DnsProviderCredentials = CloudflareDnsCredentials | Route53DnsCredentials;

export type JobStatus =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "provisioning"
  | "transferring_files"
  | "importing_databases"
  | "configuring_cron"
  | "configuring_email"
  | "cutover_ready"
  | "complete"
  | "failed";

export interface MigrationJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  plan: CpanelBackupPlan | null;
  selection: MigrationSelection | null;
  targetCredentials: Record<string, unknown> | null;
  provisionedTarget: ProvisionedTarget | null;
  databaseCredentials: DatabaseCredentialsOut[];
  emailGuidance: string[];
  dnsInstructions: DnsInstruction[];
  dnsProviderCredentials: Record<string, unknown> | null;
  dnsCutoverAppliedAt: string | null;
  error: string | null;
}

export interface JobLogEntry {
  jobId: string;
  timestamp: string;
  message: string;
}
