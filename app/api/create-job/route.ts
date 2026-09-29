import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { setJobStatus } from "@/lib/jobStore";

export const runtime = "nodejs";

export async function POST() {
  try {
    const jobId = uuid();

    setJobStatus(jobId, {
      status: "queued",
      progress: 0,
      message: "Job created. Waiting for upload.",
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
        error: "Failed to create job",
      },
      { status: 500 }
    );
  }
}