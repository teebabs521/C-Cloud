import { CpanelBackupPlan, MigrationSelection } from "../parser/types.js";
import { DatabaseCredentialsOut, ProvisionedTarget, TargetCredentials } from "../adapters/types.js";
import { DnsInstruction, DnsProviderCredentials } from "../dns/types.js";

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
  /** Optional — only needed if the user wants C-Cloud to push the DNS cutover itself. */
  dnsProviderCredentials: DnsProviderCredentials | null;
  dnsCutoverAppliedAt: string | null;
  error: string | null;
}

export interface JobLogEntry {
  jobId: string;
  timestamp: string;
  message: string;
}
