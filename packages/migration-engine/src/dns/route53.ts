import { ChangeResourceRecordSetsCommand, Route53Client } from "@aws-sdk/client-route-53";
import { DnsInstruction, DnsProviderAdapter, DnsProviderCredentials } from "./types.js";

function asRoute53(creds: DnsProviderCredentials) {
  if (creds.kind !== "route53") throw new Error("Route53DnsAdapter received non-route53 credentials");
  return creds;
}

function fqdn(instruction: DnsInstruction): string {
  const name = instruction.name === "@" ? instruction.domain : `${instruction.name}.${instruction.domain}`;
  return name.endsWith(".") ? name : `${name}.`;
}

function resourceRecordValue(instruction: DnsInstruction): string {
  if (instruction.recordType === "CNAME") {
    return instruction.value.endsWith(".") ? instruction.value : `${instruction.value}.`;
  }
  return instruction.value;
}

/** Pushes DNS cutover instructions to Route53 as a single UPSERT change batch. */
export const route53DnsAdapter: DnsProviderAdapter = {
  kind: "route53",

  async applyRecords(credentials, instructions, log): Promise<void> {
    const creds = asRoute53(credentials);
    const client = new Route53Client({
      region: creds.region,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    });

    log(`Applying ${instructions.length} record(s) to hosted zone ${creds.hostedZoneId}...`);
    await client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: creds.hostedZoneId,
        ChangeBatch: {
          Changes: instructions.map((instruction) => ({
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: fqdn(instruction),
              Type: instruction.recordType,
              TTL: 300,
              ResourceRecords: [{ Value: resourceRecordValue(instruction) }],
            },
          })),
        },
      })
    );
    log("Route53 change batch submitted (records propagate within seconds to a few minutes).");
  },
};
