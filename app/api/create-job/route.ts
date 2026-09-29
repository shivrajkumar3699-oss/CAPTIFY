import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { setJobStatus } from "@/lib/jobStore";
import { createProject } from "@/lib/history";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { isAuthenticated, userId } = await auth();

    if (!isAuthenticated || !userId) {
      return NextResponse.json(
        { ok: false, error: "Please sign in before creating a CAPTIFYY project." },
        { status: 401 }
      );
    }

    const jobId = uuid();

    await createProject({ userId, jobId });

    setJobStatus(jobId, {
      status: "queued",
      progress: 0,
      message: "Job created. Waiting for upload.",
    });

    return NextResponse.json(
      { ok: true, jobId, status: "queued" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Create job error:", error);

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to create processing job";

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to create processing job: " + message,
      },
      { status: 500 }
    );
  }
}