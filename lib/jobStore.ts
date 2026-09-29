export type ClipResult = {
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
  status:
    | "queued"
    | "transcribing"
    | "detecting_hooks"
    | "rendering"
    | "done"
    | "error";
  progress: number;
  message?: string;
  clips?: ClipResult[];
  error?: string;
};

// Simple in-memory store for local development/testing.
// This resets when the Next.js server restarts.
// We can replace this with Redis/database storage before production.
const jobs = new Map<string, JobStatus>();

function normalizeProgress(progress: unknown): number {
  const value = Number(progress);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

export function setJobStatus(
  jobId: string,
  patch: Partial<JobStatus>
): JobStatus {
  const cleanJobId = String(jobId || "").trim();

  if (!cleanJobId) {
    throw new Error("jobId is required");
  }

  const existing: JobStatus = jobs.get(cleanJobId) || {
    jobId: cleanJobId,
    status: "queued",
    progress: 0,
  };

  const updated: JobStatus = {
    ...existing,
    ...patch,
    jobId: cleanJobId,
    progress:
      patch.progress !== undefined
        ? normalizeProgress(patch.progress)
        : existing.progress,
  };

  jobs.set(cleanJobId, updated);

  return updated;
}

export function getJobStatus(jobId: string): JobStatus | null {
  const cleanJobId = String(jobId || "").trim();

  if (!cleanJobId) {
    return null;
  }

  return jobs.get(cleanJobId) || null;
}

export function deleteJobStatus(jobId: string): boolean {
  const cleanJobId = String(jobId || "").trim();

  if (!cleanJobId) {
    return false;
  }

  return jobs.delete(cleanJobId);
}

export function hasJobStatus(jobId: string): boolean {
  const cleanJobId = String(jobId || "").trim();

  if (!cleanJobId) {
    return false;
  }

  return jobs.has(cleanJobId);
}