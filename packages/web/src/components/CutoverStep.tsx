import { useState } from "react";
import { applyDnsCutover, putDnsProvider } from "../api/client";
import { CloudflareDnsCredentials, DnsProviderCredentials, MigrationJob, Route53DnsCredentials } from "../api/types";

function DnsCutoverPanel({ job, onJobUpdate }: { job: MigrationJob; onJobUpdate: (job: MigrationJob) => void }) {
  const [kind, setKind] = useState<"cloudflare" | "route53">("cloudflare");
  const [cloudflare, setCloudflare] = useState<CloudflareDnsCredentials>({ kind: "cloudflare", apiToken: "", zoneId: "" });
  const [route53, setRoute53] = useState<Route53DnsCredentials>({
    kind: "route53",
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    hostedZoneId: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  async function handleConfigure() {
    setBusy(true);
    setError(null);
    try {
      const credentials: DnsProviderCredentials = kind === "cloudflare" ? cloudflare : route53;
      const updated = await putDnsProvider(job.id, credentials);
      onJobUpdate(updated);
      setConfigured(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      const updated = await applyDnsCutover(job.id);
      onJobUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (job.dnsCutoverAppliedAt) {
    return (
      <p className="muted">
        DNS cutover applied automatically at {new Date(job.dnsCutoverAppliedAt).toLocaleString()}. Records may take a
        few minutes to propagate.
      </p>
    );
  }

  return (
    <div className="form">
      <p className="muted">
        Once you've verified the new site works, C-Cloud can push these records for you instead of you doing it by
        hand.
      </p>
      <div className="tabs">
        <button className={kind === "cloudflare" ? "tab active" : "tab"} onClick={() => setKind("cloudflare")}>
          Cloudflare
        </button>
        <button className={kind === "route53" ? "tab active" : "tab"} onClick={() => setKind("route53")}>
          Route53
        </button>
      </div>

      {kind === "cloudflare" ? (
        <>
          <label>
            API token
            <input
              type="password"
              value={cloudflare.apiToken}
              onChange={(e) => setCloudflare({ ...cloudflare, apiToken: e.target.value })}
            />
          </label>
          <label>
            Zone ID
            <input value={cloudflare.zoneId} onChange={(e) => setCloudflare({ ...cloudflare, zoneId: e.target.value })} />
          </label>
        </>
      ) : (
        <>
          <label>
            Region
            <input value={route53.region} onChange={(e) => setRoute53({ ...route53, region: e.target.value })} />
          </label>
          <label>
            Hosted zone ID
            <input value={route53.hostedZoneId} onChange={(e) => setRoute53({ ...route53, hostedZoneId: e.target.value })} />
          </label>
          <label>
            Access key ID
            <input value={route53.accessKeyId} onChange={(e) => setRoute53({ ...route53, accessKeyId: e.target.value })} />
          </label>
          <label>
            Secret access key
            <input
              type="password"
              value={route53.secretAccessKey}
              onChange={(e) => setRoute53({ ...route53, secretAccessKey: e.target.value })}
            />
          </label>
        </>
      )}

      {error && <p className="error">{error}</p>}

      {!configured ? (
        <button className="primary" disabled={busy} onClick={handleConfigure}>
          {busy ? "Saving..." : "Save DNS provider"}
        </button>
      ) : (
        <button className="primary" disabled={busy} onClick={handleApply}>
          {busy ? "Applying..." : "Apply DNS cutover now"}
        </button>
      )}
    </div>
  );
}

export function CutoverStep({ job, onJobUpdate }: { job: MigrationJob; onJobUpdate: (job: MigrationJob) => void }) {
  const failed = job.status === "failed";

  return (
    <div className="card">
      <h2>{failed ? "Migration failed" : "5. Verify, then cut over"}</h2>

      {failed && <p className="error">{job.error}</p>}

      {!failed && job.provisionedTarget && (
        <section>
          <h3>New site</h3>
          <p>
            Reachable at <code>{job.provisionedTarget.address}</code> right now (before you update DNS) &mdash; test it
            with a hosts-file override or an IP-based request with the right <code>Host</code> header first.
          </p>
          <ul className="mono-list">
            {Object.entries(job.provisionedTarget.details).map(([k, v]) => (
              <li key={k}>
                <strong>{k}:</strong> {v}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!failed && job.databaseCredentials.length > 0 && (
        <section>
          <h3>Database credentials</h3>
          <p className="muted">Update your app's config (e.g. wp-config.php) with these before cutover.</p>
          <table className="creds-table">
            <thead>
              <tr>
                <th>Database</th>
                <th>Host</th>
                <th>Port</th>
                <th>User</th>
                <th>Password</th>
              </tr>
            </thead>
            <tbody>
              {job.databaseCredentials.map((c) => (
                <tr key={c.database}>
                  <td>{c.database}</td>
                  <td>{c.host}</td>
                  <td>{c.port}</td>
                  <td>{c.user}</td>
                  <td>
                    <code>{c.password}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!failed && job.dnsInstructions.length > 0 && (
        <section>
          <h3>DNS cutover checklist</h3>
          <table className="creds-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Type</th>
                <th>Name</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {job.dnsInstructions.map((d, i) => (
                <tr key={i}>
                  <td>{d.domain}</td>
                  <td>{d.recordType}</td>
                  <td>{d.name}</td>
                  <td>{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Update these by hand at your DNS provider, or let C-Cloud push them below.</p>
          <DnsCutoverPanel job={job} onJobUpdate={onJobUpdate} />
        </section>
      )}

      {!failed && job.emailGuidance.length > 0 && (
        <section>
          <h3>Email</h3>
          <ul>
            {job.emailGuidance.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
