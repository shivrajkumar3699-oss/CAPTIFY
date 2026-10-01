import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { isAuthenticated, userId } = await auth();

    if (!isAuthenticated || !userId) {
      return NextResponse.json(
        { error: "Please sign in before processing a project." },
        { status: 401 }
      );
    }

    const body = await req.json();

    const jobId = String(body?.jobId || "").trim();
    const videoDuration = Number(body?.videoDuration || 0);
    const options = body?.options || {};

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
      return NextResponse.json(
        { error: "A valid video duration is required." },
        { status: 400 }
      );
    }

    const workerUrl =
      process.env.NODE_ENV === "production"
        ? "https://captify-worker.onrender.com"
        : process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (!workerUrl || !workerSecret) {
      return NextResponse.json(
        { error: "Worker configuration is missing." },
        { status: 500 }
      );
    }

    const statusUrl = req.nextUrl.origin.replace(/\/+$/, "");

    const response = await fetch(
      `${workerUrl.replace(/\/+$/, "")}/analyze`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": workerSecret,
        },
        body: JSON.stringify({
          jobId,
          videoDuration,
          options,
          statusUrl,
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");

      return NextResponse.json(
        {
          error:
            text ||
            `Worker returned HTTP ${response.status}.`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      jobId,
      status: "queued",
    });
  } catch (error) {
    console.error("[analyze]", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start analysis.",
      },
      { status: 500 }
    );
  }
}