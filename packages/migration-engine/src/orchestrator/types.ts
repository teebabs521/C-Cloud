import { CpanelBackupPlan, MigrationSelection } from "../parser/types.js";
import { DatabaseCredentialsOut, ProvisionedTarget, TargetCredentials } from "../adapters/types.js";

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
  archivePath: string;
  extractedDir: string | null;
  plan: CpanelBackupPlan | null;
  selection: MigrationSelection | null;
  targetCredentials: TargetCredentials | null;
  provisionedTarget: ProvisionedTarget | null;
  databaseCredentials: DatabaseCredentialsOut[];
  emailGuidance: string[];
  dnsInstructions: DnsInstruction[];
  error: string | null;
}

export interface DnsInstruction {
  domain: string;
  recordType: "A" | "MX" | "CNAME";
  name: string;
  value: string;
  note: string;
}

export interface JobLogEntry {
  jobId: string;
  timestamp: string;
  message: string;
}
