import { useState } from "react";
import { AwsCredentials, DockerVmCredentials, TargetCredentials } from "../api/types";

export function TargetStep({ onContinue }: { onContinue: (target: TargetCredentials) => void }) {
  const [kind, setKind] = useState<"docker-vm" | "aws">("docker-vm");

  const [vm, setVm] = useState<DockerVmCredentials>({
    kind: "docker-vm",
    host: "",
    port: 22,
    username: "root",
    privateKey: "",
    remoteBaseDir: "/srv/site",
  });

  const [aws, setAws] = useState<AwsCredentials>({
    kind: "aws",
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    computeMode: "lightsail",
    instanceType: "medium_2_0",
    keyPairName: "c-cloud",
  });

  return (
    <div className="card">
      <h2>3. Where should this go?</h2>
      <div className="tabs">
        <button className={kind === "docker-vm" ? "tab active" : "tab"} onClick={() => setKind("docker-vm")}>
          Docker / VM (SSH)
        </button>
        <button className={kind === "aws" ? "tab active" : "tab"} onClick={() => setKind("aws")}>
          AWS
        </button>
      </div>

      {kind === "docker-vm" ? (
        <div className="form">
          <p className="muted">Any Linux box you can SSH into — DigitalOcean, Linode, Hetzner, a bare EC2 instance, etc.</p>
          <label>
            Host / IP
            <input value={vm.host} onChange={(e) => setVm({ ...vm, host: e.target.value })} placeholder="203.0.113.20" />
          </label>
          <label>
            SSH port
            <input type="number" value={vm.port} onChange={(e) => setVm({ ...vm, port: Number(e.target.value) })} />
          </label>
          <label>
            SSH username
            <input value={vm.username} onChange={(e) => setVm({ ...vm, username: e.target.value })} />
          </label>
          <label>
            SSH private key (PEM)
            <textarea
              rows={6}
              value={vm.privateKey}
              onChange={(e) => setVm({ ...vm, privateKey: e.target.value })}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </label>
          <label>
            Remote directory
            <input value={vm.remoteBaseDir} onChange={(e) => setVm({ ...vm, remoteBaseDir: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="form">
          <p className="muted">
            C-Cloud will create a fresh SSH key pair for the new instance itself, so you only need to provide AWS API
            credentials with permission to create the relevant resources.
          </p>
          <label>
            Compute mode
            <select value={aws.computeMode} onChange={(e) => setAws({ ...aws, computeMode: e.target.value as "lightsail" | "ec2-rds" })}>
              <option value="lightsail">Lightsail (simplest)</option>
              <option value="ec2-rds">EC2 + RDS (managed database)</option>
            </select>
          </label>
          <label>
            Region
            <input value={aws.region} onChange={(e) => setAws({ ...aws, region: e.target.value })} placeholder="us-east-1" />
          </label>
          <label>
            Instance type / bundle
            <input
              value={aws.instanceType}
              onChange={(e) => setAws({ ...aws, instanceType: e.target.value })}
              placeholder={aws.computeMode === "lightsail" ? "medium_2_0" : "t3.small"}
            />
          </label>
          <label>
            Access key ID
            <input value={aws.accessKeyId} onChange={(e) => setAws({ ...aws, accessKeyId: e.target.value })} />
          </label>
          <label>
            Secret access key
            <input
              type="password"
              value={aws.secretAccessKey}
              onChange={(e) => setAws({ ...aws, secretAccessKey: e.target.value })}
            />
          </label>
        </div>
      )}

      <button className="primary" onClick={() => onContinue(kind === "docker-vm" ? vm : aws)}>
        Continue &rarr;
      </button>
    </div>
  );
}
