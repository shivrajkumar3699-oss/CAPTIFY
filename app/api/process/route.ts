import { NextRequest, NextResponse } from "next/server";
import { setJobStatus } from "@/lib/jobStore";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const jobId = String(body?.jobId || "").trim();
    const ext = String(body?.ext || "").trim().toLowerCase();
    const options = body?.options || {};

    if (!jobId || !ext) {
      return NextResponse.json(
        { error: "jobId and ext required" },
        { status: 400 }
      );
    }

    // Basic job ID safety check
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return NextResponse.json(
        { error: "Invalid jobId" },
        { status: 400 }
      );
    }

    // Only CAPTIFY-supported formats
    const allowedExtensions = new Set(["mp3", "wav", "mp4", "mkv"]);

    if (!allowedExtensions.has(ext)) {
      return NextResponse.json(
        {
          error: "Unsupported file type. Use MP3, WAV, MP4, or MKV.",
        },
        { status: 400 }
      );
    }

    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (!workerUrl) {
      console.error("WORKER_URL is not configured");

      setJobStatus(jobId, {
        status: "error",
        progress: 0,
        message: "Worker is not configured on the server",
      });

      return NextResponse.json(
        { error: "Worker is not configured" },
        { status: 500 }
      );
    }

    if (!workerSecret) {
      console.error("WORKER_SECRET is not configured");

      setJobStatus(jobId, {
        status: "error",
        progress: 0,
        message: "Worker authentication is not configured",
      });

      return NextResponse.json(
        { error: "Worker authentication is not configured" },
        { status: 500 }
      );
    }

    // Tell the frontend immediately that the job is queued.
    setJobStatus(jobId, {
      status: "queued",
      progress: 0,
      message: "Job queued, waiting for worker to pick it up",
    });

    // Start worker request without blocking the API response.
    fetch(`${workerUrl.replace(/\/+$/, "")}/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": workerSecret,
      },
      body: JSON.stringify({
        jobId,
        ext,
        options,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text().catch(() => "");

          console.error(
            `Worker returned ${response.status}:`,
            text
          );

          setJobStatus(jobId, {
            status: "error",
            progress: 0,
            message: `Worker failed to start processing (${response.status})`,
          });

          return;
        }

        console.log(`Worker accepted job ${jobId}`);
      })
      .catch((err) => {
        console.error("Failed to reach worker:", err);

        setJobStatus(jobId, {
          status: "error",
          progress: 0,
          message: "Could not connect to the CAPTIFY worker",
        });
      });

    return NextResponse.json(
      {
        jobId,
        status: "queued",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Process route error:", err);

    return NextResponse.json(
      {
        error: "Failed to start processing",
      },
      { status: 500 }
    );
  }
}