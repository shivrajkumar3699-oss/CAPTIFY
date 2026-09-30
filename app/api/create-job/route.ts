import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { createJob } from "@/lib/jobStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { isAuthenticated, userId } = await auth();

    if (!isAuthenticated || !userId) {
      return NextResponse.json(
        { ok: false, error: "Please sign in before creating a CAPTIFYY project." },
        { status: 401 }
      );
    }

    let requestedJobId = "";

    try {
      const body = await req.json();
      requestedJobId =
        typeof body?.jobId === "string"
          ? body.jobId.trim()
          : "";
    } catch {
      // Empty body is allowed; generate the ID on the server.
    }

    const jobId =
      /^[a-zA-Z0-9_-]+$/.test(requestedJobId)
        ? requestedJobId
        : uuid();

    await createJob({ userId, jobId });

    const workerUrl = process.env.WORKER_URL;

    if (!workerUrl) {
      return NextResponse.json(
        { ok: false, error: "WORKER_URL is not configured." },
        { status: 500 }
      );
    }

    // Return the direct worker upload target with job creation so the browser
    // does not need a second Vercel request before the upload can start.
    const cleanWorkerUrl = workerUrl.replace(/\/+$/, "");

    return NextResponse.json(
      {
        ok: true,
        jobId,
        status: "queued",
        pathname: `uploads/${jobId}/source.`,
        uploadUrlBase: `${cleanWorkerUrl}/upload/${encodeURIComponent(jobId)}`,
      },
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