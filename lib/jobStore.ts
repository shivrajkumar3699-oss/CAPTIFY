type ClipResult = {
  index: number;
  title: string;
  hookReason: string;
  startTime: number;
  endTime: number;
  rawUrl: string;
  editedUrl: string;
};

export type JobStatus = {
  jobId: string;
  status: "queued" | "transcribing" | "detecting_hooks" | "rendering" | "done" | "error";
  progress: number;
  message?: string;
  clips?: ClipResult[];
  error?: string;
};

// Simple in-memory store for local testing.
// This resets when the dev server restarts. That's fine for now —
// we'll upgrade to a proper database once we deploy for real.
const jobs = new Map<string, JobStatus>();

export function setJobStatus(jobId: string, patch: Partial<JobStatus>) {
  const existing = jobs.get(jobId) || { jobId, status: "queued" as const, progress: 0 };
  const updated = { ...existing, ...patch, jobId } as JobStatus;
  jobs.set(jobId, updated);
  return updated;
}

export function getJobStatus(jobId: string): JobStatus | null {
  return jobs.get(jobId) || null;
}