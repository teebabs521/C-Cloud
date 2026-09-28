import { useRef, useState } from "react";
import { uploadBackup } from "../api/client";
import { MigrationJob } from "../api/types";

export function UploadStep({ onUploaded }: { onUploaded: (job: MigrationJob) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const job = await uploadBackup(file, setProgress);
      onUploaded(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>1. Upload your cPanel backup</h2>
      <p className="muted">
        In cPanel, go to <strong>Backup Wizard &rarr; Full Account Backup</strong> and generate one, then upload the
        resulting <code>.tar.gz</code> here.
      </p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? `Uploading... ${progress}%` : "Drag a .tar.gz here, or click to choose a file"}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".tar.gz,.tgz,.tar"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
