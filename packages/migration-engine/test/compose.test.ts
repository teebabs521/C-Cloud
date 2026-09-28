import { describe, expect, it } from "vitest";
import { generateDockerCompose, normalizePhpTag } from "../src/adapters/dockerVm/compose.js";

describe("normalizePhpTag", () => {
  it("extracts major.minor from cPanel-style versions", () => {
    expect(normalizePhpTag("ea-php81")).toBe("8.1");
    expect(normalizePhpTag("8.2")).toBe("8.2");
    expect(normalizePhpTag(null)).toBe("8.2");
    expect(normalizePhpTag(undefined, "7.4")).toBe("7.4");
  });
});

describe("generateDockerCompose", () => {
  const domains = [{ domain: "example.com", isPrimary: true, documentRoot: "/x", subdomains: [] }];

  it("includes a php/nginx service pair per domain and a shared mysql service by default", () => {
    const yaml = generateDockerCompose({
      domains,
      phpConfigs: [{ domain: "example.com", phpVersion: "ea-php81", extensions: [] }],
      mysqlRootPassword: "secret",
    });
    expect(yaml).toContain("php_example_com:");
    expect(yaml).toContain("image: php:8.1-fpm");
    expect(yaml).toContain("web_example_com:");
    expect(yaml).toContain("mysql:");
    expect(yaml).toContain('MYSQL_ROOT_PASSWORD: "secret"');
  });

  it("omits the mysql service when mysqlRootPassword is not provided", () => {
    const yaml = generateDockerCompose({ domains, phpConfigs: [] });
    expect(yaml).not.toContain("mysql:");
  });
});
