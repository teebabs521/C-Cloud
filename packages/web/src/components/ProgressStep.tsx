import { useEffect, useRef, useState } from "react";
import { streamLogs } from "../api/client";
import { JobLogEntry, JobStatus } from "../api/types";

const STEP_LABELS: Partial<Record<JobStatus, string>> = {
  provisioning: "Provisioning the destination",
  transferring_files: "Transferring site files",
  importing_databases: "Importing databases",
  configuring_cron: "Setting up cron jobs",
  configuring_email: "Preserving email data",
};

export function ProgressStep({ jobId, status, onDone }: { jobId: string; status: JobStatus; onDone: () => void }) {
  const [logs, setLogs] = useState<JobLogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = streamLogs(
      jobId,
      (entry) => setLogs((prev) => [...prev, entry]),
      () => onDone()
    );
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="card">
      <h2>4. Migrating...</h2>
      <p className="muted">{STEP_LABELS[status] ?? "Working..."}</p>
      <div className="log-panel">
        {logs.map((entry, i) => (
          <div key={i} className="log-line">
            <span className="log-ts">{new Date(entry.timestamp).toLocaleTimeString()}</span> {entry.message}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
