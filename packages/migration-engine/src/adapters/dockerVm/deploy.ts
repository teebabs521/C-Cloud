import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CpanelBackupPlan, MigrationSelection } from "../../parser/types.js";
import { DatabaseCredentialsOut, DockerVmCredentials, LogFn } from "../types.js";
import { generateDockerCompose, generateNginxConf } from "./compose.js";
import { rsyncPush, scpPush, sshExec, writeRemoteFile } from "./ssh.js";

function randomPassword(): string {
  return randomBytes(18).toString("base64url");
}

function sanitizeSqlIdentifier(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to use unsafe SQL identifier: ${name}`);
  }
  return name;
}

/**
 * A raw mysqldump occasionally carries a `GRANT ... TO 'olduser'@'oldhost'`
 * line (cPanel exports sometimes include one). Piping that verbatim into
 * the new server breaks the whole import the moment MySQL hits a GRANT for
 * a user that doesn't exist there — and it would grant access for an old
 * hostname/user we don't want anyway, since we create fresh DB users
 * ourselves. Strip such lines before uploading; leave everything else
 * (including DEFINER= clauses, which we deliberately don't touch) as-is.
 * Returns the original path unchanged if there was nothing to strip.
 */
export async function sanitizeDumpForImport(dumpFile: string): Promise<string> {
  const original = await fs.readFile(dumpFile, "utf8");
  const sanitized = original.replace(/^\s*GRANT\b.*;\s*$/gim, "");
  if (sanitized === original) return dumpFile;
  const tmpFile = path.join(os.tmpdir(), `c-cloud-dump-${randomUUID()}.sql`);
  await fs.writeFile(tmpFile, sanitized, "utf8");
  return tmpFile;
}

/**
 * Installs Docker (if missing), writes docker-compose.yml + nginx configs
 * for the plan's domains, and starts the stack. Shared by the generic
 * Docker/VM adapter (box already exists) and the AWS adapter (box was just
 * provisioned) — both end up needing the same steps once SSH is reachable.
 */
export async function provisionDockerStack(
  ssh: DockerVmCredentials,
  plan: CpanelBackupPlan,
  log: LogFn,
  options: { includeLocalMysql?: boolean } = {}
): Promise<Record<string, string>> {
  const includeLocalMysql = options.includeLocalMysql ?? true;

  await sshExec(ssh, "command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh)", log);
  await sshExec(ssh, `mkdir -p '${ssh.remoteBaseDir}/nginx' '${ssh.remoteBaseDir}/sites' '${ssh.remoteBaseDir}/tmp'`, log);

  const mysqlRootPassword = includeLocalMysql ? randomPassword() : undefined;
  const compose = generateDockerCompose({
    domains: plan.domains,
    phpConfigs: plan.phpConfigs,
    mysqlRootPassword,
  });
  await writeRemoteFile(ssh, `${ssh.remoteBaseDir}/docker-compose.yml`, compose, log);

  for (const domain of plan.domains) {
    const service = domain.domain.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const conf = generateNginxConf(domain.domain, `php_${service}`);
    await writeRemoteFile(ssh, `${ssh.remoteBaseDir}/nginx/${domain.domain}.conf`, conf, log);
  }

  const details: Record<string, string> = {
    remoteBaseDir: ssh.remoteBaseDir,
    composeFile: `${ssh.remoteBaseDir}/docker-compose.yml`,
  };

  if (mysqlRootPassword) {
    await writeRemoteFile(ssh, `${ssh.remoteBaseDir}/.env.mysql-root-password`, `${mysqlRootPassword}\n`, log);
    details.mysqlRootPasswordFile = `${ssh.remoteBaseDir}/.env.mysql-root-password`;
  }

  log("Starting containers...");
  await sshExec(ssh, `cd '${ssh.remoteBaseDir}' && docker compose up -d`, log);

  return details;
}

export async function transferFilesOverSsh(
  ssh: DockerVmCredentials,
  plan: CpanelBackupPlan,
  selection: MigrationSelection,
  log: LogFn
): Promise<void> {
  for (const domain of plan.domains) {
    if (!selection.domains.includes(domain.domain)) continue;
    const remoteDir = `${ssh.remoteBaseDir}/sites/${domain.domain}/public_html`;
    log(`Transferring files for ${domain.domain}...`);
    await rsyncPush(ssh, domain.documentRoot, remoteDir, log);
  }
}

export async function importDatabasesOverSsh(
  ssh: DockerVmCredentials,
  plan: CpanelBackupPlan,
  selection: MigrationSelection,
  log: LogFn
): Promise<DatabaseCredentialsOut[]> {
  const results: DatabaseCredentialsOut[] = [];

  await sshExec(ssh, `mkdir -p '${ssh.remoteBaseDir}/tmp'`, () => {});

  log("Waiting for MySQL container to accept connections...");
  await sshExec(
    ssh,
    `cd '${ssh.remoteBaseDir}' && for i in $(seq 1 30); do docker compose exec -T mysql mysqladmin ping -uroot -p"$(cat .env.mysql-root-password)" --silent && break; sleep 2; done`,
    log
  );

  for (const db of plan.databases) {
    if (!selection.databases.includes(db.name)) continue;
    const dbName = sanitizeSqlIdentifier(db.name);
    const dbUser = sanitizeSqlIdentifier(dbName.slice(0, 16));
    const dbPassword = randomPassword();

    log(`Creating database ${dbName}...`);
    const createSql = `CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\`; CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'%'; FLUSH PRIVILEGES;`;
    await sshExec(
      ssh,
      `cd '${ssh.remoteBaseDir}' && docker compose exec -T mysql mysql -uroot -p"$(cat .env.mysql-root-password)" -e "${createSql}"`,
      log,
      [dbPassword]
    );

    const remoteDump = `${ssh.remoteBaseDir}/tmp/${dbName}.sql`;
    log(`Uploading dump for ${dbName}...`);
    await scpPush(ssh, await sanitizeDumpForImport(db.dumpFile), remoteDump, log);

    log(`Importing ${dbName}...`);
    await sshExec(
      ssh,
      `cd '${ssh.remoteBaseDir}' && docker compose exec -T mysql mysql -uroot -p"$(cat .env.mysql-root-password)" '${dbName}' < tmp/${dbName}.sql && rm -f tmp/${dbName}.sql`,
      log
    );

    results.push({ database: dbName, host: "mysql", port: 3306, user: dbUser, password: dbPassword });
  }

  return results;
}

export interface ExternalMysqlEndpoint {
  host: string;
  port: number;
  masterUser: string;
  masterPassword: string;
}

/**
 * Same as importDatabasesOverSsh, but targets an external MySQL server (e.g.
 * AWS RDS) reachable from the remote box, using a `mysql` client installed
 * there instead of `docker compose exec`.
 */
export async function importDatabasesToExternalMysql(
  ssh: DockerVmCredentials,
  endpoint: ExternalMysqlEndpoint,
  plan: CpanelBackupPlan,
  selection: MigrationSelection,
  log: LogFn
): Promise<DatabaseCredentialsOut[]> {
  const results: DatabaseCredentialsOut[] = [];

  await sshExec(ssh, `mkdir -p '${ssh.remoteBaseDir}/tmp'`, () => {});
  await sshExec(ssh, "command -v mysql >/dev/null 2>&1 || (apt-get update -y && apt-get install -y mysql-client)", log);

  const mysqlCli = (sql: string) =>
    `mysql -h '${endpoint.host}' -P ${endpoint.port} -u'${endpoint.masterUser}' -p'${endpoint.masterPassword}' -e "${sql}"`;

  for (const db of plan.databases) {
    if (!selection.databases.includes(db.name)) continue;
    const dbName = sanitizeSqlIdentifier(db.name);
    const dbUser = sanitizeSqlIdentifier(dbName.slice(0, 16));
    const dbPassword = randomPassword();

    log(`Creating database ${dbName} on ${endpoint.host}...`);
    const createSql = `CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\`; CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'%'; FLUSH PRIVILEGES;`;
    await sshExec(ssh, mysqlCli(createSql), log, [endpoint.masterPassword, dbPassword]);

    const remoteDump = `${ssh.remoteBaseDir}/tmp/${dbName}.sql`;
    log(`Uploading dump for ${dbName}...`);
    await scpPush(ssh, await sanitizeDumpForImport(db.dumpFile), remoteDump, log);

    log(`Importing ${dbName} into ${endpoint.host}...`);
    await sshExec(
      ssh,
      `mysql -h '${endpoint.host}' -P ${endpoint.port} -u'${endpoint.masterUser}' -p'${endpoint.masterPassword}' '${dbName}' < ${remoteDump} && rm -f ${remoteDump}`,
      log,
      [endpoint.masterPassword]
    );

    results.push({ database: dbName, host: endpoint.host, port: endpoint.port, user: dbUser, password: dbPassword });
  }

  return results;
}

export async function setupCronJobsOverSsh(
  ssh: DockerVmCredentials,
  plan: CpanelBackupPlan,
  selection: MigrationSelection,
  log: LogFn
): Promise<void> {
  if (!selection.cronJobs || plan.cronJobs.length === 0) return;
  log(`Installing ${plan.cronJobs.length} cron job(s)...`);
  const lines = plan.cronJobs.map((j) => j.raw).join("\\n");
  await sshExec(ssh, `(crontab -l 2>/dev/null; printf '${lines}\\n') | crontab -`, log);
  log(
    "NOTE: cron commands were copied verbatim and may reference the old cPanel file paths (/home/<user>/...) — review and update them to the new site paths."
  );
}

export async function setupEmailOverSsh(
  ssh: DockerVmCredentials,
  plan: CpanelBackupPlan,
  selection: MigrationSelection,
  log: LogFn
): Promise<string[]> {
  const guidance: string[] = [];
  const accountsToMigrate = plan.emailAccounts.filter((a) => selection.emailAccounts.includes(a.address));

  if (accountsToMigrate.length > 0) {
    log(`Preserving mailbox data for ${accountsToMigrate.length} account(s)...`);
    for (const account of accountsToMigrate) {
      const remoteDir = `${ssh.remoteBaseDir}/mail/${account.domain}/${account.address.split("@")[0]}`;
      await rsyncPush(ssh, account.maildirPath, remoteDir, log);
    }
    guidance.push(
      `Mailbox contents for ${accountsToMigrate.length} account(s) were copied to ${ssh.remoteBaseDir}/mail/ in Maildir format.`,
      "This host is not yet running a mail server (Postfix/Dovecot). Either point MX records at a hosted provider (Google Workspace, Mailgun, Fastmail) and import the copied Maildir data there, or provision Postfix+Dovecot on this box and point it at the copied data."
    );
  }

  if (plan.emailForwarders.length > 0 && selection.emailForwarders) {
    guidance.push(
      `${plan.emailForwarders.length} email forwarder(s) were detected in the backup — recreate these on whichever mail provider you choose.`
    );
  }

  return guidance;
}
