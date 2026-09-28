import { CpanelBackupPlan, MigrationSelection } from "../parser/types.js";

export type LogFn = (message: string) => void;

export interface DockerVmCredentials {
  kind: "docker-vm";
  host: string;
  port: number;
  username: string;
  /** Either a private key (PEM) or a password. Prefer the private key. */
  privateKey?: string;
  password?: string;
  /** Directory on the remote host where the site(s) will live, e.g. /srv/sites. */
  remoteBaseDir: string;
}

export interface AwsCredentials {
  kind: "aws";
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Lightsail instance blueprint/bundle, or "ec2" to use EC2 + RDS instead of Lightsail. */
  computeMode: "lightsail" | "ec2-rds";
  instanceType: string;
  keyPairName: string;
}

export type TargetCredentials = DockerVmCredentials | AwsCredentials;

export interface ProvisionedTarget {
  /** Public hostname or IP address the domain(s) should eventually point at. */
  address: string;
  /** Human-readable notes about what was provisioned (instance id, size, etc). */
  details: Record<string, string>;
}

export interface DatabaseCredentialsOut {
  database: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * A deployment target for a migration: knows how to stand up compute/DB,
 * push files and databases onto it, and wire up cron + (eventually) mail.
 */
export interface TargetAdapter {
  readonly kind: TargetCredentials["kind"];

  provision(credentials: TargetCredentials, plan: CpanelBackupPlan, log: LogFn): Promise<ProvisionedTarget>;

  transferFiles(
    credentials: TargetCredentials,
    target: ProvisionedTarget,
    plan: CpanelBackupPlan,
    selection: MigrationSelection,
    log: LogFn
  ): Promise<void>;

  importDatabases(
    credentials: TargetCredentials,
    target: ProvisionedTarget,
    plan: CpanelBackupPlan,
    selection: MigrationSelection,
    log: LogFn
  ): Promise<DatabaseCredentialsOut[]>;

  setupCronJobs(
    credentials: TargetCredentials,
    target: ProvisionedTarget,
    plan: CpanelBackupPlan,
    selection: MigrationSelection,
    log: LogFn
  ): Promise<void>;

  /**
   * Email migration for the generic VM path is a real IMAP-to-Maildir copy;
   * for managed cloud targets it typically means pointing at an external
   * mail provider instead, so adapters may just report guidance here.
   */
  setupEmail(
    credentials: TargetCredentials,
    target: ProvisionedTarget,
    plan: CpanelBackupPlan,
    selection: MigrationSelection,
    log: LogFn
  ): Promise<string[]>;
}
