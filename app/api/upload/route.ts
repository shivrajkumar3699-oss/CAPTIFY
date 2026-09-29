import { auth } from "@clerk/nextjs/server";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_UPLOAD_SIZE = 3 * 1024 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "mp4",
  "mkv",
]);

const ALLOWED_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/x-matroska",
];

export async function POST(request: Request) {
  try {
    const { isAuthenticated } = await auth();

    if (!isAuthenticated) {
      return NextResponse.json(
        { error: "Please sign in before uploading a file." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const jobId = String(body?.jobId || "").trim();
    const ext = String(body?.ext || "")
      .trim()
      .toLowerCase()
      .replace(/^\./, "");

    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return NextResponse.json(
        { error: "Invalid jobId." },
        { status: 400 }
      );
    }

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Allowed: MP3, WAV, MP4, MKV.",
        },
        { status: 400 }
      );
    }

    const pathname = `uploads/${jobId}/source.${ext}`;

    const signedToken = await issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil: Date.now() + 60 * 60 * 1000,
      maximumSizeInBytes: MAX_UPLOAD_SIZE,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
    });

    const { presignedUrl } = await presignUrl(signedToken, {
      pathname,
      operation: "put",
      access: "private",
      validUntil: Date.now() + 60 * 60 * 1000,
      maximumSizeInBytes: MAX_UPLOAD_SIZE,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({
      ok: true,
      pathname,
      presignedUrl,
    });
  } catch (error) {
    console.error("[upload] Presigned upload setup failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare the upload.",
      },
      { status: 500 }
    );
  }
}
