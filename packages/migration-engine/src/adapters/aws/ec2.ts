import {
  AuthorizeSecurityGroupIngressCommand,
  CreateKeyPairCommand,
  CreateSecurityGroupCommand,
  DescribeInstancesCommand,
  DescribeVpcsCommand,
  EC2Client,
  RunInstancesCommand,
  waitUntilInstanceRunning,
} from "@aws-sdk/client-ec2";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { AwsCredentials, LogFn } from "../types.js";

export interface Ec2ProvisionResult {
  host: string;
  username: string;
  privateKey: string;
  instanceId: string;
  vpcId: string;
  securityGroupId: string;
}

function ec2Client(creds: AwsCredentials): EC2Client {
  return new EC2Client({
    region: creds.region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });
}

async function latestUbuntuAmi(creds: AwsCredentials): Promise<string> {
  const ssm = new SSMClient({
    region: creds.region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });
  const { Parameter } = await ssm.send(
    new GetParameterCommand({
      Name: "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id",
    })
  );
  if (!Parameter?.Value) throw new Error("Could not resolve latest Ubuntu 22.04 AMI via SSM");
  return Parameter.Value;
}

/**
 * Launches an EC2 instance in the account's default VPC and opens a
 * security group for the web ports plus MySQL-from-self (so the RDS
 * instance provisioned alongside it, using the same group, is reachable).
 * This is an MVP layout: default VPC, single public subnet, no NAT/private
 * subnet split — fine for a small migrated site, not a hardened prod setup.
 */
export async function provisionEc2Instance(creds: AwsCredentials, jobId: string, log: LogFn): Promise<Ec2ProvisionResult> {
  const ec2 = ec2Client(creds);

  log("Resolving latest Ubuntu 22.04 AMI...");
  const amiId = await latestUbuntuAmi(creds);

  log("Looking up default VPC...");
  const { Vpcs } = await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }));
  const vpcId = Vpcs?.[0]?.VpcId;
  if (!vpcId) throw new Error("No default VPC found in this AWS account/region; a custom VPC target isn't supported yet.");

  const groupName = `c-cloud-${jobId}`;
  log(`Creating security group ${groupName}...`);
  const { GroupId } = await ec2.send(
    new CreateSecurityGroupCommand({ GroupName: groupName, Description: "C-Cloud migrated site", VpcId: vpcId })
  );
  if (!GroupId) throw new Error("Failed to create security group");

  await ec2.send(
    new AuthorizeSecurityGroupIngressCommand({
      GroupId,
      IpPermissions: [
        { IpProtocol: "tcp", FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        { IpProtocol: "tcp", FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        { IpProtocol: "tcp", FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        { IpProtocol: "tcp", FromPort: 3306, ToPort: 3306, UserIdGroupPairs: [{ GroupId }] },
      ],
    })
  );

  const keyName = `c-cloud-${jobId}`;
  log(`Creating EC2 key pair ${keyName}...`);
  const keyPair = await ec2.send(new CreateKeyPairCommand({ KeyName: keyName }));
  if (!keyPair.KeyMaterial) throw new Error("EC2 did not return a private key");

  log(`Launching EC2 instance (${creds.instanceType})...`);
  const { Instances } = await ec2.send(
    new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: creds.instanceType as never,
      KeyName: keyName,
      MinCount: 1,
      MaxCount: 1,
      SecurityGroupIds: [GroupId],
      TagSpecifications: [{ ResourceType: "instance", Tags: [{ Key: "Name", Value: `c-cloud-${jobId}` }] }],
    })
  );
  const instanceId = Instances?.[0]?.InstanceId;
  if (!instanceId) throw new Error("Failed to launch EC2 instance");

  log("Waiting for instance to reach 'running' state...");
  await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [instanceId] });

  const { Reservations } = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
  const publicIp = Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;
  if (!publicIp) throw new Error(`Instance ${instanceId} has no public IP (is auto-assign public IP enabled for the default VPC's subnets?)`);

  return { host: publicIp, username: "ubuntu", privateKey: keyPair.KeyMaterial, instanceId, vpcId, securityGroupId: GroupId };
}
