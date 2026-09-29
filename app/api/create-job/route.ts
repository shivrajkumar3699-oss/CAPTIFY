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
        {
          ok: false,
          error: "Please sign in before creating a CAPTIFY project.",
        },
        { status: 401 }
      );
    }

    const jobId = uuid();

    setJobStatus(jobId, {
      status: "queued",
      progress: 0,
      message: "Job created. Waiting for upload.",
    });

    await createProject({
      userId,
      jobId,
    });

    return NextResponse.json(
      {
        ok: true,
        jobId,
        status: "queued",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Create job error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to create processing job",
      },
      { status: 500 }
    );
  }
}