import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

export const sql = neon(process.env.DATABASE_URL);

let schemaReady: Promise<void> | null = null;

export function ensureHistorySchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS captify_projects (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          job_id TEXT NOT NULL UNIQUE,
          original_filename TEXT,
          video_language TEXT,
          caption_language TEXT,
          caption_color TEXT,
          num_clips INTEGER NOT NULL DEFAULT 6,
          bgm_enabled BOOLEAN NOT NULL DEFAULT false,
          framing TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS captify_clips (
          id BIGSERIAL PRIMARY KEY,
          project_id BIGINT NOT NULL REFERENCES captify_projects(id) ON DELETE CASCADE,
          clip_index INTEGER NOT NULL,
          title TEXT NOT NULL,
          hook_reason TEXT,
          start_time DOUBLE PRECISION NOT NULL,
          end_time DOUBLE PRECISION NOT NULL,
          raw_url TEXT,
          edited_url TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, clip_index)
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS captify_projects_user_id_idx
        ON captify_projects(user_id)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS captify_projects_created_at_idx
        ON captify_projects(created_at DESC)
      `;
    })();
  }

  return schemaReady;
}