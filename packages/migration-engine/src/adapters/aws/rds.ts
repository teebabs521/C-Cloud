import { randomBytes } from "node:crypto";
import {
  CreateDBInstanceCommand,
  DescribeDBInstancesCommand,
  RDSClient,
  waitUntilDBInstanceAvailable,
} from "@aws-sdk/client-rds";
import { AwsCredentials, LogFn } from "../types.js";

export interface RdsProvisionResult {
  host: string;
  port: number;
  masterUser: string;
  masterPassword: string;
}

/**
 * Creates a small MySQL RDS instance reachable only from the security group
 * shared with the EC2 instance (see ec2.ts). MVP defaults: single-AZ,
 * db.t3.micro, 20GB gp2, not publicly accessible. Bump instance class /
 * enable Multi-AZ for anything beyond a small/medium site.
 */
export async function provisionRdsInstance(
  creds: AwsCredentials,
  jobId: string,
  securityGroupId: string,
  log: LogFn
): Promise<RdsProvisionResult> {
  const rds = new RDSClient({
    region: creds.region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });

  const dbInstanceIdentifier = `c-cloud-${jobId}`;
  const masterUser = "ccloud_admin";
  const masterPassword = randomBytes(18).toString("base64url");

  log(`Creating RDS MySQL instance ${dbInstanceIdentifier}...`);
  await rds.send(
    new CreateDBInstanceCommand({
      DBInstanceIdentifier: dbInstanceIdentifier,
      Engine: "mysql",
      DBInstanceClass: "db.t3.micro",
      AllocatedStorage: 20,
      MasterUsername: masterUser,
      MasterUserPassword: masterPassword,
      VpcSecurityGroupIds: [securityGroupId],
      PubliclyAccessible: false,
      BackupRetentionPeriod: 1,
    })
  );

  log("Waiting for RDS instance to become available (this typically takes 5-10 minutes)...");
  await waitUntilDBInstanceAvailable({ client: rds, maxWaitTime: 900 }, { DBInstanceIdentifier: dbInstanceIdentifier });

  const { DBInstances } = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceIdentifier }));
  const endpoint = DBInstances?.[0]?.Endpoint;
  if (!endpoint?.Address || !endpoint.Port) throw new Error(`RDS instance ${dbInstanceIdentifier} has no endpoint`);

  return { host: endpoint.Address, port: endpoint.Port, masterUser, masterPassword };
}
