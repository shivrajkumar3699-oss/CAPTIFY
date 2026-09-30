import { NextRequest, NextResponse } from "next/server";
import { setJobStatus } from "@/lib/jobStore";

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

    const updated = await setJobStatus(
      patch.jobId,
      patch
    );

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
