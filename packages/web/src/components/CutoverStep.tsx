import { MigrationJob } from "../api/types";

export function CutoverStep({ job }: { job: MigrationJob }) {
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
          <p className="muted">Update these at your DNS provider once you've verified the new site works.</p>
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
