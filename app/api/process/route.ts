import { NextRequest, NextResponse } from "next/server";
import { setJobStatus } from "@/lib/jobStore";

export async function POST(req: NextRequest) {
  try {
    const { jobId, ext, options } = await req.json();

    if (!jobId || !ext) {
      return NextResponse.json({ error: "jobId and ext required" }, { status: 400 });
    }

    setJobStatus(jobId, {
      status: "queued",
      progress: 0,
      message: "Job queued, waiting for worker to pick it up",
    });

    fetch(process.env.WORKER_URL + "/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": process.env.WORKER_SECRET!,
      },
      body: JSON.stringify({ jobId: jobId, ext: ext, options: options }),
    }).catch((err) => console.error("Failed to reach worker:", err));

    return NextResponse.json({ jobId: jobId, status: "queued" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to start processing" }, { status: 500 });
  }
}