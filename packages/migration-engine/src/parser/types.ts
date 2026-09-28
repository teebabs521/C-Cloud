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

export interface CpanelDnsRecord {
  name: string;
  ttl: number | null;
  recordClass: string;
  type: string;
  value: string;
}

export interface CpanelDomain {
  domain: string;
  isPrimary: boolean;
  documentRoot: string;
  subdomains: string[];
}

export interface CpanelPhpConfig {
  domain: string;
  phpVersion: string | null;
  extensions: string[];
}

/** The parsed, provider-agnostic contents of a cPanel full account backup. */
export interface CpanelBackupPlan {
  cpanelUser: string;
  domains: CpanelDomain[];
  homedir: {
    path: string;
    publicHtmlByDomain: Record<string, string>;
    sizeBytes: number;
  };
  databases: CpanelDatabase[];
  emailAccounts: CpanelEmailAccount[];
  emailForwarders: CpanelEmailForwarder[];
  cronJobs: CpanelCronJob[];
  dnsZones: Record<string, CpanelDnsRecord[]>;
  phpConfigs: CpanelPhpConfig[];
  warnings: string[];
}

/** Subset of a CpanelBackupPlan the user has opted to migrate, with any edits. */
export interface MigrationSelection {
  domains: string[];
  databases: string[];
  emailAccounts: string[];
  emailForwarders: boolean;
  cronJobs: boolean;
  dnsZones: boolean;
}
