import { NextRequest, NextResponse } from "next/server";
import { setJobStatus } from "@/lib/jobStore";
import { updateProjectStatus } from "@/lib/history";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (
    req.headers.get("x-worker-secret") !==
    process.env.WORKER_SECRET
  ) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 }
    );
  }

  try {
    const patch = await req.json();

    if (!patch.jobId) {
      return NextResponse.json(
        { error: "jobId required" },
        { status: 400 }
      );
    }

    const updated = setJobStatus(
      patch.jobId,
      patch
    );

    if (
      patch.status === "done" ||
      patch.status === "error"
    ) {
      await updateProjectStatus({
        jobId: patch.jobId,
        status: patch.status,
        clips: patch.clips,
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error(
      "Internal status error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to update status",
      },
      { status: 500 }
    );
  }
}