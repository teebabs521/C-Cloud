import {
  CreateInstancesCommand,
  CreateKeyPairCommand,
  GetInstanceCommand,
  LightsailClient,
  PutInstancePublicPortsCommand,
} from "@aws-sdk/client-lightsail";
import { AwsCredentials, LogFn } from "../types.js";

export interface LightsailProvisionResult {
  host: string;
  username: string;
  privateKey: string;
  instanceName: string;
}

function client(creds: AwsCredentials): LightsailClient {
  return new LightsailClient({
    region: creds.region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });
}

/**
 * Creates an Ubuntu Lightsail instance and returns its public IP plus a
 * freshly generated SSH key pair. Docker itself is installed afterwards by
 * `provisionDockerStack` over SSH, same as the generic VM path.
 */
export async function provisionLightsailInstance(
  creds: AwsCredentials,
  jobId: string,
  log: LogFn
): Promise<LightsailProvisionResult> {
  const ls = client(creds);
  const instanceName = `c-cloud-${jobId}`;
  const keyPairName = `${creds.keyPairName}-${jobId}`;

  log(`Creating Lightsail key pair ${keyPairName}...`);
  const keyPair = await ls.send(new CreateKeyPairCommand({ keyPairName }));
  if (!keyPair.privateKeyBase64) throw new Error("Lightsail did not return a private key");

  log(`Creating Lightsail instance ${instanceName} (${creds.instanceType}) in ${creds.region}...`);
  await ls.send(
    new CreateInstancesCommand({
      instanceNames: [instanceName],
      availabilityZone: `${creds.region}a`,
      blueprintId: "ubuntu_22_04",
      bundleId: creds.instanceType,
      keyPairName,
    })
  );

  log("Waiting for instance to reach 'running' state...");
  let publicIp: string | undefined;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const { instance } = await ls.send(new GetInstanceCommand({ instanceName }));
    if (instance?.state?.name === "running" && instance.publicIpAddress) {
      publicIp = instance.publicIpAddress;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!publicIp) throw new Error(`Timed out waiting for Lightsail instance ${instanceName} to boot`);

  log("Opening ports 22, 80, 443...");
  await ls.send(
    new PutInstancePublicPortsCommand({
      instanceName,
      portInfos: [
        { fromPort: 22, toPort: 22, protocol: "tcp" },
        { fromPort: 80, toPort: 80, protocol: "tcp" },
        { fromPort: 443, toPort: 443, protocol: "tcp" },
      ],
    })
  );

  return { host: publicIp, username: "ubuntu", privateKey: keyPair.privateKeyBase64, instanceName };
}
