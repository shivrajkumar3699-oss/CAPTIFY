import { NextRequest, NextResponse } from "next/server";
import { setJobStatus } from "@/lib/jobStore";

export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set([
  "queued",
  "transcribing",
  "detecting_hooks",
  "rendering",
  "done",
  "error",
]);

export async function POST(req: NextRequest) {
  try {
    const workerSecret = process.env.WORKER_SECRET;
    const incomingSecret =
      req.headers.get("x-worker-secret");

    if (
      !workerSecret ||
      !incomingSecret ||
      incomingSecret !== workerSecret
    ) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const jobId = String(
      body.jobId || ""
    ).trim();

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId required" },
        { status: 400 }
      );
    }

    if (
      !/^[a-zA-Z0-9_-]+$/.test(jobId)
    ) {
      return NextResponse.json(
        { error: "Invalid jobId" },
        { status: 400 }
      );
    }

    if (
      body.status !== undefined &&
      !ALLOWED_STATUSES.has(
        String(body.status)
      )
    ) {
      return NextResponse.json(
        { error: "Invalid job status" },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {
      jobId,
    };

    if (body.status !== undefined) {
      patch.status = body.status;
    }

    if (body.progress !== undefined) {
      patch.progress = body.progress;
    }

    if (body.message !== undefined) {
      patch.message =
        typeof body.message === "string"
          ? body.message
          : String(body.message);
    }

    if (body.error !== undefined) {
      patch.error =
        typeof body.error === "string"
          ? body.error
          : String(body.error);
    }

    if (body.clips !== undefined) {
      if (!Array.isArray(body.clips)) {
        return NextResponse.json(
          { error: "clips must be an array" },
          { status: 400 }
        );
      }

      patch.clips = body.clips;
    }

    const updated = setJobStatus(
      jobId,
      patch as any
    );

    return NextResponse.json(
      updated,
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "Internal status route error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to update job status",
      },
      { status: 500 }
    );
  }
}