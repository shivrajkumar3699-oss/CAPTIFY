import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "mp4", "mkv"]);

export async function POST(request: Request) {
  try {
    const { isAuthenticated } = await auth();
    if (!isAuthenticated) return NextResponse.json({ error: "Please sign in before uploading a file." }, { status: 401 });

    const body = await request.json();
    const jobId = String(body?.jobId || "").trim();
    const ext = String(body?.ext || "").trim().toLowerCase().replace(/^\./, "");

    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    if (!ALLOWED_EXTENSIONS.has(ext)) return NextResponse.json({ error: "Unsupported file type. Allowed: MP3, WAV, MP4, MKV." }, { status: 400 });

    const workerUrl = process.env.WORKER_URL;
    if (!workerUrl) return NextResponse.json({ error: "WORKER_URL is not configured." }, { status: 500 });

    const pathname = `uploads/${jobId}/source.${ext}`;
    return NextResponse.json({
      ok: true,
      provider: "render-worker",
      pathname,
      uploadUrl: `${workerUrl.replace(/\/+$/, "")}/upload/${encodeURIComponent(jobId)}/${ext}`,
    });
  } catch (error) {
    console.error("[upload] Upload setup failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare the upload." }, { status: 500 });
  }
}
