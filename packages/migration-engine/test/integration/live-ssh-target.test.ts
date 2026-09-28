import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseCpanelBackup } from "../../src/parser/cpanelBackup.js";
import { MigrationSelection } from "../../src/parser/types.js";
import { DockerVmCredentials } from "../../src/adapters/types.js";
import { rsyncPush, sshExec, waitForSsh, writeRemoteFile } from "../../src/adapters/dockerVm/ssh.js";
import {
  ExternalMysqlEndpoint,
  importDatabasesToExternalMysql,
  setupCronJobsOverSsh,
  setupEmailOverSsh,
  transferFilesOverSsh,
} from "../../src/adapters/dockerVm/deploy.js";

const SSH_HOST = process.env.CCLOUD_IT_SSH_HOST ?? "127.0.0.1";
const SSH_PORT = Number(process.env.CCLOUD_IT_SSH_PORT ?? 2200);
const SSH_USER = process.env.CCLOUD_IT_SSH_USER ?? "ccloud_test";
const SSH_KEY_PATH = process.env.CCLOUD_IT_SSH_KEY_PATH ?? "/tmp/ccloud_test_key";

const MYSQL: ExternalMysqlEndpoint = {
  host: process.env.CCLOUD_IT_MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.CCLOUD_IT_MYSQL_PORT ?? 3306),
  masterUser: process.env.CCLOUD_IT_MYSQL_USER ?? "ccloud_master",
  masterPassword: process.env.CCLOUD_IT_MYSQL_PASSWORD ?? "master-pw-for-test",
};

function sshReachable(): boolean {
  try {
    execSync(
      `ssh -i ${SSH_KEY_PATH} -p ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=3 ${SSH_USER}@${SSH_HOST} true`,
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

const reachable = sshReachable();
if (!reachable) {
  console.warn(
    `[integration] Skipping: SSH target ${SSH_USER}@${SSH_HOST}:${SSH_PORT} not reachable. Run test/integration/setup.sh first (see test/integration/README.md).`
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");

/**
 * Runs a remote command and returns only its real stdout/stderr lines.
 * sshExec's log callback also receives the echoed "$ ssh ..." command line
 * (useful in real progress logs, noise here), so filter that out.
 */
async function captureOutput(ssh: DockerVmCredentials, command: string): Promise<string> {
  const lines: string[] = [];
  await sshExec(ssh, command, (line) => {
    if (!line.startsWith("$ ssh")) lines.push(line);
  });
  return lines.join("\n");
}

function creds(remoteBaseDir: string): DockerVmCredentials {
  return {
    kind: "docker-vm",
    host: SSH_HOST,
    port: SSH_PORT,
    username: SSH_USER,
    privateKey: readFileSync(SSH_KEY_PATH, "utf8"),
    remoteBaseDir,
  };
}

describe.skipIf(!reachable)("live SSH/rsync/MySQL transport (no mocks)", () => {
  let remoteBaseDir: string;
  let ssh: DockerVmCredentials;

  beforeAll(async () => {
    remoteBaseDir = `/tmp/ccloud-it-${randomUUID().slice(0, 8)}`;
    ssh = creds(remoteBaseDir);
    await waitForSsh(ssh, () => {});
  });

  afterAll(async () => {
    await sshExec(ssh, `rm -rf '${remoteBaseDir}'`, () => {});
  });

  it("sshExec runs a real command on the remote host and streams real output", async () => {
    const lines: string[] = [];
    await sshExec(ssh, "echo real-remote-output && whoami", (line) => lines.push(line));
    expect(lines.join("\n")).toContain("real-remote-output");
    expect(lines.join("\n")).toContain(SSH_USER);
  });

  it("writeRemoteFile actually writes bytes that round-trip correctly", async () => {
    const content = "hello from c-cloud\nwith a second line + \"quotes\" and 'apostrophes'\n";
    await writeRemoteFile(ssh, `${remoteBaseDir}/roundtrip.txt`, content, () => {});

    const remoteContent = await captureOutput(ssh, `cat '${remoteBaseDir}/roundtrip.txt'`);
    expect(remoteContent).toBe(content.trimEnd());
  });

  it("transferFilesOverSsh rsyncs a real domain's public_html to the target", async () => {
    const plan = await parseCpanelBackup(fixturesDir);
    const selection: MigrationSelection = {
      domains: ["example.com"],
      databases: [],
      emailAccounts: [],
      emailForwarders: false,
      cronJobs: false,
      dnsZones: false,
    };

    await transferFilesOverSsh(ssh, plan, selection, () => {});

    const remoteContent = await captureOutput(ssh, `cat '${remoteBaseDir}/sites/example.com/public_html/index.php'`);
    const localContent = await fs.readFile(path.join(plan.domains[0].documentRoot, "index.php"), "utf8");
    expect(remoteContent.trim()).toBe(localContent.trim());
  });

  it("setupCronJobsOverSsh installs the real crontab entry on the target", async () => {
    const plan = await parseCpanelBackup(fixturesDir);
    const selection: MigrationSelection = {
      domains: [],
      databases: [],
      emailAccounts: [],
      emailForwarders: false,
      cronJobs: true,
      dnsZones: false,
    };
    expect(plan.cronJobs.length).toBeGreaterThan(0);

    await setupCronJobsOverSsh(ssh, plan, selection, () => {});

    const crontab = await captureOutput(ssh, "crontab -l");
    expect(crontab).toContain(plan.cronJobs[0].raw);
  });

  it("setupEmailOverSsh rsyncs a real mailbox's contents to the target", async () => {
    const plan = await parseCpanelBackup(fixturesDir);
    const selection: MigrationSelection = {
      domains: [],
      databases: [],
      emailAccounts: ["alice@example.com"],
      emailForwarders: false,
      cronJobs: false,
      dnsZones: false,
    };

    const guidance = await setupEmailOverSsh(ssh, plan, selection, () => {});
    expect(guidance.length).toBeGreaterThan(0);

    const listing = await captureOutput(ssh, `find '${remoteBaseDir}/mail/example.com/alice/cur' -type f`);
    expect(listing).toContain("1.eml");
  });

  it("importDatabasesToExternalMysql creates the db, imports the real dump, and the data is queryable", async () => {
    const plan = await parseCpanelBackup(fixturesDir);
    const selection: MigrationSelection = {
      domains: [],
      databases: ["exampledb"],
      emailAccounts: [],
      emailForwarders: false,
      cronJobs: false,
      dnsZones: false,
    };

    const results = await importDatabasesToExternalMysql(ssh, MYSQL, plan, selection, () => {});
    expect(results).toHaveLength(1);
    expect(results[0].database).toBe("exampledb");

    const rowsOut = await captureOutput(
      ssh,
      `mysql -h '${MYSQL.host}' -P ${MYSQL.port} -u'${MYSQL.masterUser}' -p'${MYSQL.masterPassword}' -N -e "SELECT title FROM exampledb.posts"`
    );
    expect(rowsOut).toContain("Hello world");

    await sshExec(
      ssh,
      `mysql -h '${MYSQL.host}' -P ${MYSQL.port} -u'${MYSQL.masterUser}' -p'${MYSQL.masterPassword}' -e "DROP DATABASE IF EXISTS exampledb; DROP USER IF EXISTS '${results[0].user}'@'%';"`,
      () => {}
    );
  });
});
