import { ensureHistorySchema, sql } from "@/lib/db";

export type HistoryClip = {
  id: number;
  clipIndex: number;
  title: string;
  hookReason: string | null;
  startTime: number;
  endTime: number;
  rawUrl: string | null;
  editedUrl: string | null;
};

export type HistoryProject = {
  id: number;
  jobId: string;
  originalFilename: string | null;
  videoLanguage: string | null;
  captionLanguage: string | null;
  captionColor: string | null;
  numClips: number;
  bgmEnabled: boolean;
  framing: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  clips: HistoryClip[];
};

type CreateProjectArgs = {
  userId: string;
  jobId: string;
};

export async function createProject({
  userId,
  jobId,
}: CreateProjectArgs) {
  await ensureHistorySchema();

  const rows = await sql`
    INSERT INTO captify_projects (
      user_id,
      job_id,
      status
    )
    VALUES (
      ${userId},
      ${jobId},
      'queued'
    )
    RETURNING id
  `;

  return rows[0];
}

type UpdateOptionsArgs = {
  userId: string;
  jobId: string;
  originalFilename?: string;
  videoLanguage?: string;
  captionLanguage?: string;
  captionColor?: string;
  numClips?: number;
  bgmEnabled?: boolean;
  framing?: string;
};

export async function updateProjectOptions({
  userId,
  jobId,
  originalFilename,
  videoLanguage,
  captionLanguage,
  captionColor,
  numClips,
  bgmEnabled,
  framing,
}: UpdateOptionsArgs) {
  await ensureHistorySchema();

  await sql`
    UPDATE captify_projects
    SET
      original_filename = COALESCE(${originalFilename ?? null}, original_filename),
      video_language = COALESCE(${videoLanguage ?? null}, video_language),
      caption_language = COALESCE(${captionLanguage ?? null}, caption_language),
      caption_color = COALESCE(${captionColor ?? null}, caption_color),
      num_clips = COALESCE(${numClips ?? null}, num_clips),
      bgm_enabled = COALESCE(${bgmEnabled ?? null}, bgm_enabled),
      framing = COALESCE(${framing ?? null}, framing)
    WHERE
      user_id = ${userId}
      AND job_id = ${jobId}
  `;
}

type StatusClip = {
  index: number;
  title: string;
  hookReason: string;
  startTime: number;
  endTime: number;
  rawUrl: string;
  editedUrl: string;
};

export async function updateProjectStatus({
  jobId,
  status,
  clips,
}: {
  jobId: string;
  status: string;
  clips?: StatusClip[];
}) {
  await ensureHistorySchema();

  const projects = await sql`
    UPDATE captify_projects
    SET
      status = ${status},
      completed_at = CASE
        WHEN ${status} = 'done' THEN NOW()
        ELSE completed_at
      END
    WHERE job_id = ${jobId}
    RETURNING id
  `;

  if (!projects.length) {
    return;
  }

  const projectId = Number(projects[0].id);

  if (!clips) {
    return;
  }

  for (const clip of clips) {
    await sql`
      INSERT INTO captify_clips (
        project_id,
        clip_index,
        title,
        hook_reason,
        start_time,
        end_time,
        raw_url,
        edited_url
      )
      VALUES (
        ${projectId},
        ${clip.index},
        ${clip.title},
        ${clip.hookReason},
        ${clip.startTime},
        ${clip.endTime},
        ${clip.rawUrl},
        ${clip.editedUrl}
      )
      ON CONFLICT (project_id, clip_index)
      DO UPDATE SET
        title = EXCLUDED.title,
        hook_reason = EXCLUDED.hook_reason,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        raw_url = EXCLUDED.raw_url,
        edited_url = EXCLUDED.edited_url
    `;
  }
}

export async function getUserHistory(
  userId: string
): Promise<HistoryProject[]> {
  await ensureHistorySchema();

  const projects = await sql`
    SELECT
      id,
      job_id,
      original_filename,
      video_language,
      caption_language,
      caption_color,
      num_clips,
      bgm_enabled,
      framing,
      status,
      created_at,
      completed_at
    FROM captify_projects
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  const result: HistoryProject[] = [];

  for (const project of projects) {
    const clips = await sql`
      SELECT
        id,
        clip_index,
        title,
        hook_reason,
        start_time,
        end_time,
        raw_url,
        edited_url
      FROM captify_clips
      WHERE project_id = ${project.id}
      ORDER BY clip_index ASC
    `;

    result.push({
      id: Number(project.id),
      jobId: project.job_id,
      originalFilename: project.original_filename,
      videoLanguage: project.video_language,
      captionLanguage: project.caption_language,
      captionColor: project.caption_color,
      numClips: Number(project.num_clips),
      bgmEnabled: Boolean(project.bgm_enabled),
      framing: project.framing,
      status: project.status,
      createdAt: new Date(project.created_at).toISOString(),
      completedAt: project.completed_at
        ? new Date(project.completed_at).toISOString()
        : null,
      clips: clips.map((clip) => ({
        id: Number(clip.id),
        clipIndex: Number(clip.clip_index),
        title: clip.title,
        hookReason: clip.hook_reason,
        startTime: Number(clip.start_time),
        endTime: Number(clip.end_time),
        rawUrl: clip.raw_url,
        editedUrl: clip.edited_url,
      })),
    });
  }

  return result;
}