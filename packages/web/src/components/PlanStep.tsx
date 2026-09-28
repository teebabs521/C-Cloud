import { useState } from "react";
import { CpanelBackupPlan, MigrationSelection } from "../api/types";

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function PlanStep({
  plan,
  onContinue,
}: {
  plan: CpanelBackupPlan;
  onContinue: (selection: MigrationSelection) => void;
}) {
  const [domains, setDomains] = useState(new Set(plan.domains.map((d) => d.domain)));
  const [databases, setDatabases] = useState(new Set(plan.databases.map((d) => d.name)));
  const [emailAccounts, setEmailAccounts] = useState(new Set(plan.emailAccounts.map((a) => a.address)));
  const [emailForwarders, setEmailForwarders] = useState(true);
  const [cronJobs, setCronJobs] = useState(true);

  function toggle<T>(set: Set<T>, setter: (s: Set<T>) => void, value: T) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  return (
    <div className="card">
      <h2>2. Review what we found</h2>
      {plan.warnings.length > 0 && (
        <ul className="warnings">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <section>
        <h3>Domains ({plan.domains.length})</h3>
        {plan.domains.map((d) => (
          <label key={d.domain} className="row">
            <input type="checkbox" checked={domains.has(d.domain)} onChange={() => toggle(domains, setDomains, d.domain)} />
            {d.domain} {d.isPrimary && <span className="badge">primary</span>}
          </label>
        ))}
      </section>

      <section>
        <h3>Databases ({plan.databases.length})</h3>
        {plan.databases.map((d) => (
          <label key={d.name} className="row">
            <input type="checkbox" checked={databases.has(d.name)} onChange={() => toggle(databases, setDatabases, d.name)} />
            {d.name} <span className="muted">({bytesToHuman(d.sizeBytes)})</span>
          </label>
        ))}
        {plan.databases.length === 0 && <p className="muted">None found.</p>}
      </section>

      <section>
        <h3>Email accounts ({plan.emailAccounts.length})</h3>
        {plan.emailAccounts.map((a) => (
          <label key={a.address} className="row">
            <input
              type="checkbox"
              checked={emailAccounts.has(a.address)}
              onChange={() => toggle(emailAccounts, setEmailAccounts, a.address)}
            />
            {a.address} <span className="muted">({bytesToHuman(a.sizeBytes)})</span>
          </label>
        ))}
        {plan.emailAccounts.length === 0 && <p className="muted">None found.</p>}
        {plan.emailForwarders.length > 0 && (
          <label className="row">
            <input type="checkbox" checked={emailForwarders} onChange={() => setEmailForwarders((v) => !v)} />
            Migrate {plan.emailForwarders.length} email forwarder(s)
          </label>
        )}
      </section>

      <section>
        <h3>Cron jobs ({plan.cronJobs.length})</h3>
        {plan.cronJobs.length > 0 ? (
          <>
            <label className="row">
              <input type="checkbox" checked={cronJobs} onChange={() => setCronJobs((v) => !v)} />
              Migrate all cron jobs
            </label>
            <ul className="mono-list">
              {plan.cronJobs.map((c) => (
                <li key={c.raw}>{c.raw}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">None found.</p>
        )}
      </section>

      <button
        className="primary"
        onClick={() =>
          onContinue({
            domains: [...domains],
            databases: [...databases],
            emailAccounts: [...emailAccounts],
            emailForwarders,
            cronJobs,
            dnsZones: true,
          })
        }
      >
        Continue &rarr;
      </button>
    </div>
  );
}
