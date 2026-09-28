import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCpanelBackup } from "../src/parser/cpanelBackup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

describe("parseCpanelBackup", () => {
  it("parses a full cPanel account backup layout", async () => {
    const plan = await parseCpanelBackup(fixturesDir);

    expect(plan.cpanelUser).toBe("testuser");

    expect(plan.domains).toHaveLength(1);
    expect(plan.domains[0].domain).toBe("example.com");
    expect(plan.domains[0].isPrimary).toBe(true);
    expect(plan.domains[0].documentRoot).toBe(path.join(plan.homedir.path, "public_html"));

    expect(plan.databases).toHaveLength(1);
    expect(plan.databases[0].name).toBe("exampledb");
    expect(plan.databases[0].users).toContain("testuser_dbuser");
    expect(plan.databases[0].sizeBytes).toBeGreaterThan(0);

    const addresses = plan.emailAccounts.map((a) => a.address).sort();
    expect(addresses).toEqual(["alice@example.com", "bob@example.com"]);

    expect(plan.emailForwarders).toHaveLength(2);
    expect(plan.emailForwarders.find((f) => f.from === "sales@example.com")?.to).toBe("alice@example.com");

    expect(plan.cronJobs).toHaveLength(1);
    expect(plan.cronJobs[0].schedule).toBe("0 3 * * *");
    expect(plan.cronJobs[0].command).toContain("cleanup.php");

    const records = plan.dnsZones["example.com"];
    expect(records).toBeDefined();
    expect(records.find((r) => r.type === "A")?.value).toBe("203.0.113.10");
    expect(records.find((r) => r.type === "MX")?.value).toBe("10 mail.example.com.");

    expect(plan.phpConfigs.find((c) => c.domain === "example.com")?.phpVersion).toBe("ea-php81");

    expect(plan.homedir.sizeBytes).toBeGreaterThan(0);
    expect(plan.warnings).toEqual([]);
  });
});
