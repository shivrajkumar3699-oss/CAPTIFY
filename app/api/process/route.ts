import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { setJobStatus } from "@/lib/jobStore";
import { updateProjectOptions } from "@/lib/history";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { isAuthenticated, userId } = await auth();
    if (!isAuthenticated || !userId) return NextResponse.json({ error: "Please sign in before processing a project." }, { status: 401 });

    const { jobId, ext, sourcePathname, options } = await req.json();
    if (!jobId || !ext || !sourcePathname) return NextResponse.json({ error: "jobId, ext, and sourcePathname are required" }, { status: 400 });

    if (typeof sourcePathname !== "string" || !/^uploads\/[a-zA-Z0-9_-]+\/source\.(mp3|wav|mp4|mkv)$/i.test(sourcePathname))
      return NextResponse.json({ error: "Invalid sourcePathname." }, { status: 400 });

    const signedToken = await issueSignedToken({ pathname: sourcePathname, operations: ["get"], validUntil: Date.now() + 60 * 60 * 1000 });
    const { presignedUrl: workerSourceUrl } = await presignUrl(signedToken, {
      pathname: sourcePathname, operation: "get", access: "private",
      validUntil: Date.now() + 60 * 60 * 1000,
    });

    const safeOptions = options || {};
    await updateProjectOptions({
      userId, jobId,
      videoLanguage: safeOptions.audioLanguage || "auto",
      captionLanguage: safeOptions.captionLanguage || "same",
      captionColor: safeOptions.captionColor || "#FFE600",
      numClips: Number(safeOptions.numClips) || 6,
      bgmEnabled: Boolean(safeOptions.bgm ?? safeOptions.useBgm),
      framing: safeOptions.framing || "fit",
    });

    await setJobStatus(jobId, { status: "queued", progress: 0, message: "Job queued, waiting for worker to pick it up" });

    const workerUrl = process.env.WORKER_URL;
    if (!workerUrl) return NextResponse.json({ error: "WORKER_URL is not configured." }, { status: 500 });

    const statusUrl = req.nextUrl.origin.replace(/\/+$/, "") + "/api/internal/status";

    const workerResponse = await fetch(workerUrl.replace(/\/+$/, "") + "/process", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": process.env.WORKER_SECRET || "" },
      body: JSON.stringify({ jobId, ext, sourceUrl: workerSourceUrl, options: safeOptions, statusUrl }),
    });

    if (!workerResponse.ok) {
      const workerText = await workerResponse.text().catch(() => "");
      await setJobStatus(jobId, { status: "error", progress: 0, message: "Worker could not start the job", error: workerText || ("Worker returned HTTP " + workerResponse.status) });
      return NextResponse.json({ error: "Worker could not start the processing job." }, { status: 502 });
    }

    return NextResponse.json({ jobId, status: "queued" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start processing" }, { status: 500 });
  }
}