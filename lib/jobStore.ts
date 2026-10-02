import { ensureJobSchema, sql } from "@/lib/db";

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

const norm = (v: unknown) => {
  const n = Number(v);

  return Number.isFinite(n)
    ? Math.min(100, Math.max(0, Math.round(n)))
    : 0;
};

export async function createJob({
  userId,
  jobId,
}: {
  userId: string;
  jobId: string;
}): Promise<JobStatus> {
  const id = String(jobId || "").trim();

  if (!id) {
    throw new Error("jobId is required");
  }

  await ensureJobSchema();

  const rows = await sql`
    INSERT INTO captify_jobs (
      user_id,
      job_id,
      status,
      progress,
      message
    )
    VALUES (
      ${userId},
      ${id},
      'queued',
      0,
      'Job created. Waiting for upload.'
    )
    ON CONFLICT (job_id) DO NOTHING
    RETURNING
      job_id,
      status,
      progress,
      message,
      error,
      clips
  `;

  if (!rows.length) {
    throw new Error("Failed to create job");
  }

  const r = rows[0];

  return {
    jobId: r.job_id,
    status: r.status,
    progress: norm(r.progress),
    message: r.message || undefined,
    error: r.error || undefined,
    clips: r.clips || undefined,
  };
}

export async function setJobStatus(
  jobId: string,
  patch: Partial<JobStatus>
): Promise<JobStatus> {
  const id = String(jobId || "").trim();

  if (!id) {
    throw new Error("jobId is required");
  }

  await ensureJobSchema();

  const incomingStatus = patch.status || "queued";
  const incomingProgress = norm(patch.progress);
  const message = patch.message ?? null;
  const error = patch.error ?? null;

  // Neon/Postgres JSONB needs the array/object serialized explicitly.
  const clips =
    patch.clips !== undefined
      ? JSON.stringify(patch.clips)
      : null;

  /*
   * Status callbacks can arrive out of order because FFmpeg progress
   * callbacks are intentionally non-blocking. Never allow an older
   * rendering update to move a job backwards after it has reached a
   * higher progress value or DONE.
   */
  const rows = await sql`
    UPDATE captify_jobs
    SET
      status = CASE
        WHEN status = 'done' THEN 'done'
        ELSE ${incomingStatus}
      END,
      progress = CASE
        WHEN ${incomingStatus} = 'done' THEN 100
        WHEN status = 'done' THEN 100
        ELSE GREATEST(progress, ${incomingProgress})
      END,
      message = CASE
        WHEN status = 'done' THEN message
        ELSE ${message}
      END,
      error = CASE
        WHEN status = 'done' THEN error
        ELSE ${error}
      END,
      clips = CASE
        WHEN status = 'done' THEN clips
        ELSE COALESCE(${clips}::jsonb, clips)
      END,
      completed_at = CASE
        WHEN ${incomingStatus} = 'done'
          OR status = 'done'
        THEN COALESCE(completed_at, NOW())
        ELSE completed_at
      END
    WHERE job_id = ${id}
    RETURNING
      job_id,
      status,
      progress,
      message,
      error,
      clips
  `;

  if (!rows.length) {
    throw new Error("Job not found");
  }

  const r = rows[0];

  return {
    jobId: r.job_id,
    status: r.status,
    progress: norm(r.progress),
    message: r.message || undefined,
    error: r.error || undefined,
    clips: r.clips || undefined,
  };
}

export async function getJobStatus(
  jobId: string
): Promise<JobStatus | null> {
  const id = String(jobId || "").trim();

  if (!id) {
    return null;
  }

  await ensureJobSchema();

  const rows = await sql`
    SELECT
      job_id,
      status,
      progress,
      message,
      error,
      clips
    FROM captify_jobs
    WHERE job_id = ${id}
    LIMIT 1
  `;

  if (!rows.length) {
    return null;
  }

  const r = rows[0];

  return {
    jobId: r.job_id,
    status: r.status,
    progress: norm(r.progress),
    message: r.message || undefined,
    error: r.error || undefined,
    clips: r.clips || undefined,
  };
}

export async function deleteJobStatus(
  jobId: string
) {
  const id = String(jobId || "").trim();

  if (!id) {
    return false;
  }

  await ensureJobSchema();

  const rows = await sql`
    DELETE FROM captify_jobs
    WHERE job_id = ${id}
    RETURNING job_id
  `;

  return rows.length > 0;
}

export async function hasJobStatus(
  jobId: string
) {
  return (await getJobStatus(jobId)) !== null;
}
