import { describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CreateInstancesCommand,
  CreateKeyPairCommand as LightsailCreateKeyPairCommand,
  GetInstanceCommand,
  LightsailClient,
  PutInstancePublicPortsCommand,
} from "@aws-sdk/client-lightsail";
import {
  AuthorizeSecurityGroupIngressCommand,
  CreateKeyPairCommand as Ec2CreateKeyPairCommand,
  CreateSecurityGroupCommand,
  DescribeInstancesCommand,
  DescribeVpcsCommand,
  EC2Client,
  RunInstancesCommand,
} from "@aws-sdk/client-ec2";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { CreateDBInstanceCommand, DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { provisionLightsailInstance } from "../src/adapters/aws/lightsail.js";
import { provisionEc2Instance } from "../src/adapters/aws/ec2.js";
import { provisionRdsInstance } from "../src/adapters/aws/rds.js";
import { AwsCredentials } from "../src/adapters/types.js";

const baseCreds: AwsCredentials = {
  kind: "aws",
  region: "us-east-1",
  accessKeyId: "AKIAFAKE",
  secretAccessKey: "fake-secret",
  computeMode: "lightsail",
  instanceType: "medium_2_0",
  keyPairName: "c-cloud",
};

describe("provisionLightsailInstance", () => {
  it("creates a key pair + instance, waits for it to run, opens ports, and returns connection info", async () => {
    const ls = mockClient(LightsailClient);
    ls.on(LightsailCreateKeyPairCommand).resolves({ privateKeyBase64: "FAKE-LIGHTSAIL-KEY" });
    ls.on(CreateInstancesCommand).resolves({});
    ls.on(GetInstanceCommand).resolves({ instance: { state: { name: "running" }, publicIpAddress: "203.0.113.5" } });
    ls.on(PutInstancePublicPortsCommand).resolves({});

    const result = await provisionLightsailInstance(baseCreds, "job123", vi.fn());

    expect(result).toEqual({
      host: "203.0.113.5",
      username: "ubuntu",
      privateKey: "FAKE-LIGHTSAIL-KEY",
      instanceName: "c-cloud-job123",
    });
    expect(ls.commandCalls(PutInstancePublicPortsCommand)).toHaveLength(1);
    const ports = ls.commandCalls(PutInstancePublicPortsCommand)[0].args[0].input.portInfos;
    expect(ports?.map((p) => p.fromPort)).toEqual([22, 80, 443]);

    ls.restore();
  });

  it("throws if Lightsail doesn't return a private key", async () => {
    const ls = mockClient(LightsailClient);
    ls.on(LightsailCreateKeyPairCommand).resolves({});

    await expect(provisionLightsailInstance(baseCreds, "job123", vi.fn())).rejects.toThrow(/private key/i);

    ls.restore();
  });

  it("throws if the instance never reaches running state before the deadline", async () => {
    vi.useFakeTimers();
    const ls = mockClient(LightsailClient);
    ls.on(LightsailCreateKeyPairCommand).resolves({ privateKeyBase64: "FAKE-KEY" });
    ls.on(CreateInstancesCommand).resolves({});
    ls.on(GetInstanceCommand).resolves({ instance: { state: { name: "pending" } } });
    ls.on(PutInstancePublicPortsCommand).resolves({});

    const promise = provisionLightsailInstance(baseCreds, "job123", vi.fn());
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.runAllTimersAsync();
    await assertion;

    ls.restore();
    vi.useRealTimers();
  });
});

describe("provisionEc2Instance", () => {
  it("resolves the AMI, sets up networking, launches the instance, and returns its public IP", async () => {
    const ssm = mockClient(SSMClient);
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "ami-0123456789" } });

    const ec2 = mockClient(EC2Client);
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-1" }] });
    ec2.on(CreateSecurityGroupCommand).resolves({ GroupId: "sg-1" });
    ec2.on(AuthorizeSecurityGroupIngressCommand).resolves({});
    ec2.on(Ec2CreateKeyPairCommand).resolves({ KeyMaterial: "FAKE-EC2-KEY" });
    ec2.on(RunInstancesCommand).resolves({ Instances: [{ InstanceId: "i-abc123" }] });
    ec2.on(DescribeInstancesCommand).resolves({
      Reservations: [{ Instances: [{ InstanceId: "i-abc123", State: { Name: "running" }, PublicIpAddress: "203.0.113.9" }] }],
    });

    const result = await provisionEc2Instance({ ...baseCreds, computeMode: "ec2-rds", instanceType: "t3.small" }, "job456", vi.fn());

    expect(result).toEqual({
      host: "203.0.113.9",
      username: "ubuntu",
      privateKey: "FAKE-EC2-KEY",
      instanceId: "i-abc123",
      vpcId: "vpc-1",
      securityGroupId: "sg-1",
    });

    const ingress = ec2.commandCalls(AuthorizeSecurityGroupIngressCommand)[0].args[0].input.IpPermissions;
    expect(ingress?.map((p) => p.FromPort)).toEqual(expect.arrayContaining([22, 80, 443, 3306]));

    ssm.restore();
    ec2.restore();
  });

  it("throws clearly when there's no default VPC", async () => {
    const ssm = mockClient(SSMClient);
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "ami-0123456789" } });
    const ec2 = mockClient(EC2Client);
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [] });

    await expect(
      provisionEc2Instance({ ...baseCreds, computeMode: "ec2-rds" }, "job456", vi.fn())
    ).rejects.toThrow(/default VPC/i);

    ssm.restore();
    ec2.restore();
  });
});

describe("provisionRdsInstance", () => {
  it("creates a db.t3.micro MySQL instance, waits for it, and returns its endpoint", async () => {
    const rds = mockClient(RDSClient);
    rds.on(CreateDBInstanceCommand).resolves({});
    rds.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceStatus: "available", Endpoint: { Address: "db.example.internal", Port: 3306 } }],
    });

    const result = await provisionRdsInstance({ ...baseCreds, computeMode: "ec2-rds" }, "job789", "sg-1", vi.fn());

    expect(result.host).toBe("db.example.internal");
    expect(result.port).toBe(3306);
    expect(result.masterUser).toBe("ccloud_admin");
    expect(result.masterPassword).toHaveLength(24);

    const createInput = rds.commandCalls(CreateDBInstanceCommand)[0].args[0].input;
    expect(createInput.DBInstanceClass).toBe("db.t3.micro");
    expect(createInput.PubliclyAccessible).toBe(false);
    expect(createInput.VpcSecurityGroupIds).toEqual(["sg-1"]);

    rds.restore();
  });
});
