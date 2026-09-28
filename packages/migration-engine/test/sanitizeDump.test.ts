import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeDumpForImport } from "../src/adapters/dockerVm/deploy.js";

function writeTempSql(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "c-cloud-dump-test-"));
  const file = path.join(dir, "dump.sql");
  writeFileSync(file, content, "utf8");
  return file;
}

describe("sanitizeDumpForImport", () => {
  it("strips a trailing GRANT statement that would break import on a fresh server", async () => {
    const dump = writeTempSql(
      [
        "CREATE TABLE `posts` (`id` int NOT NULL);",
        "INSERT INTO `posts` VALUES (1);",
        "GRANT ALL PRIVILEGES ON `exampledb`.* TO 'olduser'@'localhost';",
        "",
      ].join("\n")
    );

    const sanitized = await sanitizeDumpForImport(dump);
    expect(sanitized).not.toBe(dump);
    const content = readFileSync(sanitized, "utf8");
    expect(content).not.toMatch(/GRANT/i);
    expect(content).toContain("CREATE TABLE");
    expect(content).toContain("INSERT INTO");
  });

  it("returns the original path unchanged when there's nothing to strip", async () => {
    const dump = writeTempSql("CREATE TABLE `posts` (`id` int NOT NULL);\n");
    const sanitized = await sanitizeDumpForImport(dump);
    expect(sanitized).toBe(dump);
  });

  it("does not touch a GRANT-like string that isn't its own statement", async () => {
    const dump = writeTempSql("INSERT INTO `logs` VALUES ('user requested GRANT access');\n");
    const sanitized = await sanitizeDumpForImport(dump);
    expect(sanitized).toBe(dump);
  });
});
