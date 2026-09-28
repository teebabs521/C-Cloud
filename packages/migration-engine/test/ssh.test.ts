import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      // Simulate the remote command's own stderr echoing back what it ran
      // (e.g. a shell in -x mode, or an error message quoting the command),
      // so the masking test also covers output, not just the initial log line.
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("+ mysql -uroot -psecret-pw -e ...\n"));
        child.emit("close", 0);
      });
      return child;
    }),
  };
});

const { sshExec } = await import("../src/adapters/dockerVm/ssh.js");

describe("sshExec secret masking", () => {
  const creds = { kind: "docker-vm" as const, host: "example.invalid", port: 22, username: "root", remoteBaseDir: "/srv" };

  it("masks secrets in both the echoed command and command output", async () => {
    const lines: string[] = [];
    await sshExec(creds, "mysql -uroot -psecret-pw -e 'SELECT 1'", (line) => lines.push(line), ["secret-pw"]);

    const joined = lines.join("\n");
    expect(joined).not.toContain("secret-pw");
    expect(joined).toContain("***");
  });

  it("logs the real command when no secrets are given", async () => {
    const lines: string[] = [];
    await sshExec(creds, "echo hello", (line) => lines.push(line));
    expect(lines.some((l) => l.includes("echo hello"))).toBe(true);
  });
});
