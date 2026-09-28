import {
  DatabaseCredentialsOut,
  DockerVmCredentials,
  ProvisionedTarget,
  TargetAdapter,
  TargetCredentials,
} from "../types.js";
import {
  importDatabasesOverSsh,
  provisionDockerStack,
  setupCronJobsOverSsh,
  setupEmailOverSsh,
  transferFilesOverSsh,
} from "./deploy.js";

function asDockerVm(creds: TargetCredentials): DockerVmCredentials {
  if (creds.kind !== "docker-vm") throw new Error("DockerVmAdapter received non-docker-vm credentials");
  return creds;
}

/**
 * Deploys onto any SSH-reachable Linux host (a plain VPS/VM on DigitalOcean,
 * Linode, Hetzner, a bare EC2 box, etc.) using Docker Compose. This is the
 * "bring your own box" target and requires only SSH access + `docker`,
 * `rsync`, `scp` available on the machine running C-Cloud.
 */
export const dockerVmAdapter: TargetAdapter = {
  kind: "docker-vm",

  async provision(credentials, plan, log): Promise<ProvisionedTarget> {
    const creds = asDockerVm(credentials);
    log(`Connecting to ${creds.host}:${creds.port} as ${creds.username}...`);
    const details = await provisionDockerStack(creds, plan, log);
    return { address: creds.host, details };
  },

  async transferFiles(credentials, target, plan, selection, log): Promise<void> {
    await transferFilesOverSsh(asDockerVm(credentials), plan, selection, log);
  },

  async importDatabases(credentials, target, plan, selection, log): Promise<DatabaseCredentialsOut[]> {
    return importDatabasesOverSsh(asDockerVm(credentials), plan, selection, log);
  },

  async setupCronJobs(credentials, target, plan, selection, log): Promise<void> {
    await setupCronJobsOverSsh(asDockerVm(credentials), plan, selection, log);
  },

  async setupEmail(credentials, target, plan, selection, log): Promise<string[]> {
    return setupEmailOverSsh(asDockerVm(credentials), plan, selection, log);
  },
};
