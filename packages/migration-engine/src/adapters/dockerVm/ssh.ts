import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DockerVmCredentials, LogFn } from "../types.js";

async function withTempKey<T>(creds: DockerVmCredentials, fn: (keyPath: string | null) => Promise<T>): Promise<T> {
  if (!creds.privateKey) return fn(null);
  const keyPath = path.join(os.tmpdir(), `c-cloud-key-${randomUUID()}`);
  await fs.writeFile(keyPath, creds.privateKey, { mode: 0o600 });
  try {
    return await fn(keyPath);
  } finally {
    await fs.rm(keyPath, { force: true });
  }
}

/**
 * `ssh` takes the port as `-p <port>`; `scp` takes the *same* port flag as
 * `-P <port>` (uppercase) — its lowercase `-p` means "preserve
 * modification times" instead and silently swallows the port number as a
 * positional filename argument. Pass `portFlag: "-P"` when building args
 * for `scp`.
 */
function baseSshArgs(creds: DockerVmCredentials, keyPath: string | null, portFlag: "-p" | "-P" = "-p"): string[] {
  const args = [portFlag, String(creds.port), "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes"];
  if (keyPath) args.push("-i", keyPath);
  return args;
}

/** Replaces any occurrence of a secret value with `***` before it reaches a log sink. */
function maskSecrets(text: string, secrets: string[]): string {
  let masked = text;
  for (const secret of secrets) {
    if (!secret) continue;
    masked = masked.split(secret).join("***");
  }
  return masked;
}

function runCommand(cmd: string, args: string[], log: LogFn): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => log(d.toString().trimEnd()));
    child.stderr.on("data", (d) => log(d.toString().trimEnd()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

/**
 * Runs a single command on the remote host over SSH. Requires the `ssh`
 * binary. Any strings passed in `secrets` are masked out of what gets
 * logged (the *actual* command sent over SSH is never altered) — pass the
 * literal secret values a command embeds, e.g. a freshly generated DB
 * password, so they never end up sitting in the job's log history.
 */
export async function sshExec(
  creds: DockerVmCredentials,
  remoteCommand: string,
  log: LogFn,
  secrets: string[] = []
): Promise<void> {
  await withTempKey(creds, async (keyPath) => {
    const args = [...baseSshArgs(creds, keyPath), `${creds.username}@${creds.host}`, remoteCommand];
    log(`$ ssh ${creds.host} '${maskSecrets(remoteCommand, secrets)}'`);
    await runCommand("ssh", args, (line) => log(maskSecrets(line, secrets)));
  });
}

/** Pushes a local directory to the remote host with rsync over SSH. Requires the `rsync` binary. */
export async function rsyncPush(
  creds: DockerVmCredentials,
  localDir: string,
  remoteDir: string,
  log: LogFn
): Promise<void> {
  await withTempKey(creds, async (keyPath) => {
    const sshCmd = ["ssh", ...baseSshArgs(creds, keyPath)].join(" ");
    await sshExec(creds, `mkdir -p '${remoteDir}'`, log);
    const src = localDir.endsWith("/") ? localDir : `${localDir}/`;
    const args = ["-az", "--delete", "-e", sshCmd, src, `${creds.username}@${creds.host}:${remoteDir}`];
    log(`$ rsync -> ${creds.host}:${remoteDir}`);
    await runCommand("rsync", args, log);
  });
}

/** Copies a single local file to the remote host. Requires the `scp` binary. */
export async function scpPush(
  creds: DockerVmCredentials,
  localFile: string,
  remoteFile: string,
  log: LogFn
): Promise<void> {
  await withTempKey(creds, async (keyPath) => {
    const args = [...baseSshArgs(creds, keyPath, "-P"), localFile, `${creds.username}@${creds.host}:${remoteFile}`];
    log(`$ scp ${localFile} -> ${creds.host}:${remoteFile}`);
    await runCommand("scp", args, log);
  });
}

/** Polls until the remote host accepts an SSH connection, or throws after the timeout. */
export async function waitForSsh(creds: DockerVmCredentials, log: LogFn, timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await sshExec(creds, "true", () => {});
      log(`SSH is reachable on ${creds.host}.`);
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error(`Timed out waiting for SSH on ${creds.host}: ${String(lastError)}`);
}

/**
 * Writes a small text file's contents directly on the remote host (no local
 * temp file needed). The underlying command (which embeds the file's full
 * content as base64) is deliberately never passed to `log` — only a
 * one-line summary is — since this is how secret files like the MySQL root
 * password get written.
 */
export async function writeRemoteFile(
  creds: DockerVmCredentials,
  remotePath: string,
  contents: string,
  log: LogFn
): Promise<void> {
  log(`Writing ${remotePath} (${contents.length} bytes)...`);
  const encoded = Buffer.from(contents, "utf8").toString("base64");
  // NOTE: the dirname substitution must be double-quoted, not single-quoted —
  // single quotes suppress `$(...)` command substitution entirely, which
  // silently no-ops the mkdir and only surfaces later as a write failure.
  await sshExec(
    creds,
    `mkdir -p "$(dirname "${remotePath}")" && echo '${encoded}' | base64 -d > '${remotePath}'`,
    () => {}
  );
}
