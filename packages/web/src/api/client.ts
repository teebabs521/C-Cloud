import { DnsProviderCredentials, JobLogEntry, MigrationJob, MigrationSelection, TargetCredentials } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function uploadBackup(file: File, onProgress?: (pct: number) => void): Promise<MigrationJob> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("backup", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/migrations");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(xhr.responseText || `Upload failed with ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(form);
  });
}

export async function getJob(id: string): Promise<MigrationJob> {
  return json(await fetch(`/api/migrations/${id}`));
}

export async function putSelection(id: string, selection: MigrationSelection): Promise<MigrationJob> {
  return json(
    await fetch(`/api/migrations/${id}/selection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    })
  );
}

export async function putTarget(id: string, target: TargetCredentials): Promise<MigrationJob> {
  return json(
    await fetch(`/api/migrations/${id}/target`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    })
  );
}

export async function startMigration(id: string): Promise<MigrationJob> {
  return json(await fetch(`/api/migrations/${id}/start`, { method: "POST" }));
}

export async function putDnsProvider(id: string, credentials: DnsProviderCredentials): Promise<MigrationJob> {
  return json(
    await fetch(`/api/migrations/${id}/dns-provider`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    })
  );
}

export async function applyDnsCutover(id: string): Promise<MigrationJob> {
  return json(await fetch(`/api/migrations/${id}/dns/apply`, { method: "POST" }));
}

export function streamLogs(id: string, onEntry: (entry: JobLogEntry) => void, onDone: (status: string) => void): () => void {
  const source = new EventSource(`/api/migrations/${id}/logs`);
  source.onmessage = (event) => onEntry(JSON.parse(event.data));
  source.addEventListener("done", (event) => {
    onDone((event as MessageEvent).data);
    source.close();
  });
  source.onerror = () => {
    // EventSource retries on its own; nothing to do here beyond leaving it be.
  };
  return () => source.close();
}
