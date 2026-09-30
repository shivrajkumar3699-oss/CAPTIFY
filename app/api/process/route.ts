import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { setJobStatus } from "@/lib/jobStore";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { isAuthenticated, userId } = await auth();
    if (!isAuthenticated || !userId) return NextResponse.json({ error: "Please sign in before processing a project." }, { status: 401 });

    const { jobId, ext, sourcePathname, options } = await req.json();
    if (!jobId || !ext || !sourcePathname) return NextResponse.json({ error: "jobId, ext, and sourcePathname are required" }, { status: 400 });

    if (typeof sourcePathname !== "string" || !/^uploads\/[a-zA-Z0-9_-]+\/source\.(mp3|wav|mp4|mkv)$/i.test(sourcePathname)) {
      return NextResponse.json({ error: "Invalid sourcePathname." }, { status: 400 });
    }

    await setJobStatus(jobId, { status: "queued", progress: 0, message: "Job queued, waiting for worker to pick it up" });

    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) return NextResponse.json({ error: "Worker configuration is missing." }, { status: 500 });

    const statusUrl = req.nextUrl.origin.replace(/\/+$/, "");
    const workerResponse = await fetch(workerUrl.replace(/\/+$/, "") + "/process", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": workerSecret },
      body: JSON.stringify({ jobId, ext, sourcePath: sourcePathname, options: options || {}, statusUrl }),
    });

    if (!workerResponse.ok) {
      const workerText = await workerResponse.text().catch(() => "");
      await setJobStatus(jobId, { status: "error", progress: 0, message: "Worker could not start the job", error: workerText || "Worker returned HTTP " + workerResponse.status });
      return NextResponse.json({ error: "Worker could not start the processing job." }, { status: 502 });
    }

    return NextResponse.json({ jobId, status: "queued" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start processing" }, { status: 500 });
  }
}
