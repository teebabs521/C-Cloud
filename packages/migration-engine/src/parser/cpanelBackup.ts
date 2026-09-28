import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CpanelBackupPlan,
  CpanelCronJob,
  CpanelDatabase,
  CpanelDnsRecord,
  CpanelDomain,
  CpanelEmailAccount,
  CpanelEmailForwarder,
  CpanelPhpConfig,
} from "./types.js";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirSizeBytes(dir: string): Promise<number> {
  if (!(await pathExists(dir))) return 0;
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      total += stat.size;
    }
  }
  return total;
}

/** Finds the single top-level `backup-*` (or `cpmove-*`) directory inside an extracted archive. */
async function findBackupRoot(extractedDir: string): Promise<string> {
  const entries = await fs.readdir(extractedDir, { withFileTypes: true });
  const candidate = entries.find(
    (e) => e.isDirectory() && (e.name.startsWith("backup-") || e.name.startsWith("cpmove-"))
  );
  if (candidate) return path.join(extractedDir, candidate.name);
  // Some exports put homedir/mysql/meta directly at the top level.
  return extractedDir;
}

async function parseCronFile(cronPath: string): Promise<CpanelCronJob[]> {
  if (!(await pathExists(cronPath))) return [];
  const raw = await fs.readFile(cronPath, "utf8");
  const jobs: CpanelCronJob[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^((?:\S+\s+){4}\S+)\s+(.*)$/);
    if (!match) continue;
    jobs.push({ schedule: match[1], command: match[2], raw: trimmed });
  }
  return jobs;
}

async function parseDnsZone(zonePath: string): Promise<CpanelDnsRecord[]> {
  if (!(await pathExists(zonePath))) return [];
  const raw = await fs.readFile(zonePath, "utf8");
  const records: CpanelDnsRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";")) continue;
    // Simplified BIND zone line: NAME [TTL] [CLASS] TYPE VALUE...
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const [name, ttlOrClassOrType, ...rest] = parts;
    let ttl: number | null = null;
    let recordClass = "IN";
    let type: string;
    let valueParts: string[];
    if (/^\d+$/.test(ttlOrClassOrType)) {
      ttl = Number(ttlOrClassOrType);
      recordClass = rest[0] ?? "IN";
      type = rest[1] ?? "";
      valueParts = rest.slice(2);
    } else if (ttlOrClassOrType === "IN") {
      recordClass = "IN";
      type = rest[0] ?? "";
      valueParts = rest.slice(1);
    } else {
      type = ttlOrClassOrType;
      valueParts = rest;
    }
    if (!type) continue;
    records.push({ name, ttl, recordClass, type, value: valueParts.join(" ") });
  }
  return records;
}

async function parseDatabases(mysqlDir: string): Promise<CpanelDatabase[]> {
  if (!(await pathExists(mysqlDir))) return [];
  const entries = await fs.readdir(mysqlDir, { withFileTypes: true });
  const databases: CpanelDatabase[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
    const dumpFile = path.join(mysqlDir, entry.name);
    const stat = await fs.stat(dumpFile);
    const name = entry.name.replace(/\.sql$/, "");
    const raw = await fs.readFile(dumpFile, "utf8").catch(() => "");
    const users = new Set<string>();
    const grantRegex = /GRANT[^;]*ON\s+`?[\w-]+`?\.\*\s+TO\s+'([^']+)'/gi;
    let match: RegExpExecArray | null;
    while ((match = grantRegex.exec(raw))) {
      users.add(match[1]);
    }
    databases.push({ name, dumpFile, users: [...users], sizeBytes: stat.size });
  }
  return databases;
}

async function parseEmailAccounts(homedir: string, domains: string[]): Promise<CpanelEmailAccount[]> {
  const mailDir = path.join(homedir, "mail");
  if (!(await pathExists(mailDir))) return [];
  const accounts: CpanelEmailAccount[] = [];
  for (const domain of domains) {
    const domainMailDir = path.join(mailDir, domain);
    if (!(await pathExists(domainMailDir))) continue;
    const mailboxes = await fs.readdir(domainMailDir, { withFileTypes: true });
    for (const mailbox of mailboxes) {
      if (!mailbox.isDirectory()) continue;
      const maildirPath = path.join(domainMailDir, mailbox.name);
      const sizeBytes = await dirSizeBytes(maildirPath);
      accounts.push({
        address: `${mailbox.name}@${domain}`,
        domain,
        maildirPath,
        sizeBytes,
      });
    }
  }
  return accounts;
}

async function parseEmailForwarders(backupRoot: string, domains: string[]): Promise<CpanelEmailForwarder[]> {
  const vaDir = path.join(backupRoot, "va");
  if (!(await pathExists(vaDir))) return [];
  const forwarders: CpanelEmailForwarder[] = [];
  for (const domain of domains) {
    const domainFile = path.join(vaDir, domain);
    if (!(await pathExists(domainFile))) continue;
    const raw = await fs.readFile(domainFile, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [from, to] = trimmed.split(":").map((s) => s.trim());
      if (from && to) forwarders.push({ from: `${from}@${domain}`, to });
    }
  }
  return forwarders;
}

/**
 * cPanel's userdata stores the document root as it was on the OLD server
 * (e.g. `/home/testuser/public_html` or `/home/testuser/public_html/blog`).
 * That path doesn't exist locally — only the extracted `homedir/` does — so
 * we re-anchor it at the `public_html` segment and resolve it against the
 * locally extracted homedir instead of using it verbatim.
 */
function resolveLocalDocumentRoot(rawDocRoot: string, homedir: string): string {
  const marker = "public_html";
  const idx = rawDocRoot.indexOf(marker);
  const relative = idx >= 0 ? rawDocRoot.slice(idx) : path.join("public_html", rawDocRoot.replace(/^\/+/, ""));
  return path.join(homedir, relative);
}

async function parseDomains(backupRoot: string, homedir: string): Promise<CpanelDomain[]> {
  const userdataDir = path.join(backupRoot, "meta", "userdata");
  const domains: CpanelDomain[] = [];
  if (await pathExists(userdataDir)) {
    const entries = await fs.readdir(userdataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === "main") continue;
      const raw = await fs.readFile(path.join(userdataDir, entry.name), "utf8").catch(() => "");
      const docRootMatch = raw.match(/documentroot:\s*(.+)/i);
      const documentRoot = docRootMatch
        ? resolveLocalDocumentRoot(docRootMatch[1].trim(), homedir)
        : path.join(homedir, "public_html");
      domains.push({
        domain: entry.name,
        isPrimary: false,
        documentRoot,
        subdomains: [],
      });
    }
  }
  if (domains.length === 0) {
    // Fall back to whatever public_html-like directories exist.
    const publicHtml = path.join(homedir, "public_html");
    if (await pathExists(publicHtml)) {
      domains.push({ domain: "primary", isPrimary: true, documentRoot: publicHtml, subdomains: [] });
    }
  } else {
    domains[0].isPrimary = true;
  }
  return domains;
}

async function parsePhpConfigs(backupRoot: string, domains: string[]): Promise<CpanelPhpConfig[]> {
  const phpFile = path.join(backupRoot, "meta", "php_versions");
  const configs: CpanelPhpConfig[] = [];
  if (await pathExists(phpFile)) {
    const raw = await fs.readFile(phpFile, "utf8");
    for (const line of raw.split("\n")) {
      const [domain, version] = line.split("=").map((s) => s.trim());
      if (domain && version) configs.push({ domain, phpVersion: version, extensions: [] });
    }
  }
  for (const domain of domains) {
    if (!configs.find((c) => c.domain === domain)) {
      configs.push({ domain, phpVersion: null, extensions: [] });
    }
  }
  return configs;
}

/**
 * Parses an already-extracted cPanel full account backup (or cpmove archive)
 * into a provider-agnostic migration plan. Layout follows cPanel's documented
 * backup structure: homedir/, mysql/, meta/, cron/, va/ (mail forwarders).
 */
export async function parseCpanelBackup(extractedDir: string): Promise<CpanelBackupPlan> {
  const warnings: string[] = [];
  const backupRoot = await findBackupRoot(extractedDir);
  const homedir = path.join(backupRoot, "homedir");

  if (!(await pathExists(homedir))) {
    warnings.push(`No homedir/ found under ${backupRoot}; file migration will be empty.`);
  }

  const cpanelUser = path.basename(backupRoot).replace(/^backup-[^_]*_/, "").replace(/^cpmove-/, "") || "unknown";

  const domains = await parseDomains(backupRoot, homedir);
  const domainNames = domains.map((d) => d.domain);

  const publicHtmlByDomain: Record<string, string> = {};
  for (const d of domains) publicHtmlByDomain[d.domain] = d.documentRoot;

  const [databases, emailAccounts, emailForwarders, cronJobs, phpConfigs, homedirSize] = await Promise.all([
    parseDatabases(path.join(backupRoot, "mysql")),
    parseEmailAccounts(homedir, domainNames),
    parseEmailForwarders(backupRoot, domainNames),
    parseCronFile(path.join(backupRoot, "cron", cpanelUser)),
    parsePhpConfigs(backupRoot, domainNames),
    dirSizeBytes(homedir),
  ]);

  const dnsZones: Record<string, CpanelDnsRecord[]> = {};
  const dnsZonesDir = path.join(backupRoot, "meta", "dnszones");
  if (await pathExists(dnsZonesDir)) {
    const entries = await fs.readdir(dnsZonesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const domain = entry.name.replace(/\.db$/, "");
      dnsZones[domain] = await parseDnsZone(path.join(dnsZonesDir, entry.name));
    }
  } else {
    warnings.push("No DNS zone files found; DNS cutover instructions will need to be entered manually.");
  }

  if (databases.length === 0) warnings.push("No MySQL databases found in this backup.");
  if (emailAccounts.length === 0) warnings.push("No email accounts found in this backup.");

  return {
    cpanelUser,
    domains,
    homedir: { path: homedir, publicHtmlByDomain, sizeBytes: homedirSize },
    databases,
    emailAccounts,
    emailForwarders,
    cronJobs,
    dnsZones,
    phpConfigs,
    warnings,
  };
}
