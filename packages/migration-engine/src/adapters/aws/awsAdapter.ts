import { randomUUID } from "node:crypto";
import {
  DatabaseCredentialsOut,
  AwsCredentials,
  DockerVmCredentials,
  ProvisionedTarget,
  TargetAdapter,
  TargetCredentials,
} from "../types.js";
import {
  importDatabasesOverSsh,
  importDatabasesToExternalMysql,
  provisionDockerStack,
  setupCronJobsOverSsh,
  setupEmailOverSsh,
  transferFilesOverSsh,
} from "../dockerVm/deploy.js";
import { waitForSsh } from "../dockerVm/ssh.js";
import { provisionLightsailInstance } from "./lightsail.js";
import { provisionEc2Instance } from "./ec2.js";
import { provisionRdsInstance } from "./rds.js";

function asAws(creds: TargetCredentials): AwsCredentials {
  if (creds.kind !== "aws") throw new Error("AwsAdapter received non-aws credentials");
  return creds;
}

const REMOTE_BASE_DIR = "/srv/site";

/** Rebuilds the SSH connection details from what provision() stashed on the target. */
function sshTargetFrom(target: ProvisionedTarget): DockerVmCredentials {
  return {
    kind: "docker-vm",
    host: target.address,
    port: 22,
    username: target.details.sshUser,
    privateKey: target.details.privateKey,
    remoteBaseDir: target.details.remoteBaseDir ?? REMOTE_BASE_DIR,
  };
}

/**
 * Provisions compute (+ managed DB, for the ec2-rds mode) on AWS, then
 * reuses the same Docker-Compose-over-SSH deployment steps as the generic
 * VM adapter. A fresh SSH key pair is created per migration job so C-Cloud
 * never needs the user to hand over long-lived AWS SSH credentials.
 */
export const awsAdapter: TargetAdapter = {
  kind: "aws",

  async provision(credentials, plan, log): Promise<ProvisionedTarget> {
    const creds = asAws(credentials);
    const jobId = randomUUID().slice(0, 8);

    if (creds.computeMode === "lightsail") {
      const instance = await provisionLightsailInstance(creds, jobId, log);
      const ssh: DockerVmCredentials = {
        kind: "docker-vm",
        host: instance.host,
        port: 22,
        username: instance.username,
        privateKey: instance.privateKey,
        remoteBaseDir: REMOTE_BASE_DIR,
      };
      await waitForSsh(ssh, log);
      const details = await provisionDockerStack(ssh, plan, log, { includeLocalMysql: true });

      return {
        address: instance.host,
        details: {
          ...details,
          computeMode: "lightsail",
          sshUser: instance.username,
          privateKey: instance.privateKey,
          instanceName: instance.instanceName,
        },
      };
    }

    // ec2-rds
    const ec2 = await provisionEc2Instance(creds, jobId, log);
    const rds = await provisionRdsInstance(creds, jobId, ec2.securityGroupId, log);
    const ssh: DockerVmCredentials = {
      kind: "docker-vm",
      host: ec2.host,
      port: 22,
      username: ec2.username,
      privateKey: ec2.privateKey,
      remoteBaseDir: REMOTE_BASE_DIR,
    };
    await waitForSsh(ssh, log);
    const details = await provisionDockerStack(ssh, plan, log, { includeLocalMysql: false });

    return {
      address: ec2.host,
      details: {
        ...details,
        computeMode: "ec2-rds",
        sshUser: ec2.username,
        privateKey: ec2.privateKey,
        instanceId: ec2.instanceId,
        rdsHost: rds.host,
        rdsPort: String(rds.port),
        rdsMasterUser: rds.masterUser,
        rdsMasterPassword: rds.masterPassword,
      },
    };
  },

  async transferFiles(credentials, target, plan, selection, log): Promise<void> {
    await transferFilesOverSsh(sshTargetFrom(target), plan, selection, log);
  },

  async importDatabases(credentials, target, plan, selection, log): Promise<DatabaseCredentialsOut[]> {
    const ssh = sshTargetFrom(target);
    if (target.details.computeMode === "ec2-rds") {
      return importDatabasesToExternalMysql(
        ssh,
        {
          host: target.details.rdsHost,
          port: Number(target.details.rdsPort),
          masterUser: target.details.rdsMasterUser,
          masterPassword: target.details.rdsMasterPassword,
        },
        plan,
        selection,
        log
      );
    }
    return importDatabasesOverSsh(ssh, plan, selection, log);
  },

  async setupCronJobs(credentials, target, plan, selection, log): Promise<void> {
    await setupCronJobsOverSsh(sshTargetFrom(target), plan, selection, log);
  },

  async setupEmail(credentials, target, plan, selection, log): Promise<string[]> {
    const guidance = await setupEmailOverSsh(sshTargetFrom(target), plan, selection, log);
    if (target.details.computeMode === "ec2-rds") {
      guidance.push(
        "Consider Amazon WorkMail or Amazon SES (inbound) if you'd rather not self-host mail alongside this EC2 instance."
      );
    }
    return guidance;
  },
};
