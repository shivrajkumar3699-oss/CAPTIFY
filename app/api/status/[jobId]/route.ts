import { NextRequest, NextResponse } from "next/server";
import { getJobStatus } from "@/lib/jobStore";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return NextResponse.json(
        { error: "Invalid jobId" },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    // Prefer the worker's live in-memory status while the job is active.
    // This makes progress independent of callback timing/database lag.
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (workerUrl && workerSecret) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const workerResponse = await fetch(
          `${workerUrl.replace(/\/+$/, "")}/status/${encodeURIComponent(jobId)}`,
          {
            headers: {
              "x-worker-secret": workerSecret,
            },
            cache: "no-store",
            signal: controller.signal,
          }
        );

        clearTimeout(timeout);

        if (workerResponse.ok) {
          const workerStatus = await workerResponse.json();

          return NextResponse.json(workerStatus, {
            status: 200,
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            },
          });
        }
      } catch (workerError) {
        console.warn("Worker live status unavailable:", workerError);
      }
    }

    // Durable fallback for completed jobs after a worker restart.
    const status = await getJobStatus(jobId);

    if (!status) {
      return NextResponse.json(
        { error: "Job not found" },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    return NextResponse.json(status, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("Status route error:", error);

    return NextResponse.json(
      { error: "Failed to fetch job status" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}
