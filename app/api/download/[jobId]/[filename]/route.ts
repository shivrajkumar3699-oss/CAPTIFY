import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string; filename: string }> }
) {
  const { jobId, filename } = await params;

  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  if (!/^clip-\d+-(raw|edited)\.mp4$/i.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerUrl || !workerSecret) {
    return NextResponse.json(
      { error: "Worker download configuration is missing." },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `${workerUrl.replace(/\/+$/, "")}/download/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`,
      {
        headers: {
          "x-worker-secret": workerSecret,
        },
        cache: "no-store",
      }
    );

    if (!response.ok || !response.body) {
      return NextResponse.json(
        { error: response.status === 404 ? "File not found" : "Worker download failed" },
        { status: response.status === 404 ? 404 : 502 }
      );
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      response.headers.get("content-type") || "video/mp4"
    );
    const contentLength = response.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set(
      "Content-Disposition",
      response.headers.get("content-disposition") || `attachment; filename="${filename}"`
    );
    headers.set("Cache-Control", "private, no-store");

    return new NextResponse(response.body, { status: 200, headers });
  } catch (error) {
    console.error("Worker download proxy error:", error);
    return NextResponse.json(
      { error: "Unable to download the generated clip." },
      { status: 502 }
    );
  }
}
