import { neon } from "@neondatabase/serverless";

export const sql = neon(
  process.env.DATABASE_URL ||
    "postgresql://placeholder:placeholder@localhost:5432/placeholder"
);

let schemaReady: Promise<void> | null = null;

export function ensureJobSchema() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Add DATABASE_URL before using job storage."
    );
  }

  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS captify_jobs (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          job_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'queued',
          progress INTEGER NOT NULL DEFAULT 0,
          message TEXT,
          error TEXT,
          clips JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS captify_jobs_user_id_idx
        ON captify_jobs(user_id)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS captify_jobs_created_at_idx
        ON captify_jobs(created_at DESC)
      `;
    })();
  }

  return schemaReady;
}