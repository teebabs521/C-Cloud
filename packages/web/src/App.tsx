import { useEffect, useRef, useState } from "react";
import { getJob, putSelection, putTarget, startMigration } from "./api/client";
import { MigrationJob, MigrationSelection, TargetCredentials } from "./api/types";
import { UploadStep } from "./components/UploadStep";
import { PlanStep } from "./components/PlanStep";
import { TargetStep } from "./components/TargetStep";
import { ProgressStep } from "./components/ProgressStep";
import { CutoverStep } from "./components/CutoverStep";

type UiStep = "upload" | "parsing" | "plan" | "target" | "progress" | "done";

export default function App() {
  const [job, setJob] = useState<MigrationJob | null>(null);
  const [step, setStep] = useState<UiStep>("upload");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function onUploaded(newJob: MigrationJob) {
    setJob(newJob);
    setStep("parsing");
    pollRef.current = setInterval(async () => {
      try {
        const updated = await getJob(newJob.id);
        setJob(updated);
        if (updated.status === "parsed") {
          stopPolling();
          setStep("plan");
        } else if (updated.status === "failed") {
          stopPolling();
          setStep("done");
        }
      } catch (err) {
        stopPolling();
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);
  }

  async function onSelectionChosen(selection: MigrationSelection) {
    if (!job) return;
    try {
      const updated = await putSelection(job.id, selection);
      setJob(updated);
      setStep("target");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onTargetChosen(target: TargetCredentials) {
    if (!job) return;
    try {
      await putTarget(job.id, target);
      const updated = await startMigration(job.id);
      setJob(updated);
      setStep("progress");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onProgressDone() {
    if (!job) return;
    const updated = await getJob(job.id);
    setJob(updated);
    setStep("done");
  }

  return (
    <div className="app">
      <header>
        <h1>C-Cloud</h1>
        <p className="tagline">Migrate a cPanel-hosted site to the cloud, step by step.</p>
      </header>

      {error && <p className="error">{error}</p>}

      {step === "upload" && <UploadStep onUploaded={onUploaded} />}

      {step === "parsing" && (
        <div className="card">
          <h2>Reading your backup...</h2>
          <p className="muted">This can take a minute for large accounts.</p>
        </div>
      )}

      {step === "plan" && job?.plan && <PlanStep plan={job.plan} onContinue={onSelectionChosen} />}

      {step === "target" && <TargetStep onContinue={onTargetChosen} />}

      {step === "progress" && job && (
        <ProgressStep jobId={job.id} status={job.status} onDone={onProgressDone} />
      )}

      {step === "done" && job && <CutoverStep job={job} onJobUpdate={setJob} />}
    </div>
  );
}
