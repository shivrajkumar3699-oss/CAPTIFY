import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

export const runtime = "nodejs";

const MAX_UPLOAD_SIZE = 3 * 1024 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "mp4",
  "mkv",
]);

export async function PUT(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  const rawExt =
    req.nextUrl.searchParams.get("ext") || "mp4";

  const ext = rawExt
    .toLowerCase()
    .replace(/^\./, "");

  if (!jobId) {
    return NextResponse.json(
      { error: "jobId required" },
      { status: 400 }
    );
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json(
      { error: "Invalid jobId" },
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

  if (!req.body) {
    return NextResponse.json(
      { error: "No file received" },
      { status: 400 }
    );
  }

  const contentLength =
    req.headers.get("content-length");

  if (contentLength) {
    const size = Number(contentLength);

    if (
      Number.isFinite(size) &&
      size > MAX_UPLOAD_SIZE
    ) {
      return NextResponse.json(
        {
          error:
            "File is too large. CAPTIFY supports files up to 3 GB.",
        },
        { status: 413 }
      );
    }
  }

  const storageDir =
    process.env.STORAGE_DIR;

  if (!storageDir) {
    return NextResponse.json(
      {
        error:
          "STORAGE_DIR is not configured.",
      },
      { status: 500 }
    );
  }

  const dir = path.join(
    storageDir,
    "uploads",
    jobId
  );

  fs.mkdirSync(dir, {
    recursive: true,
  });

  const filePath = path.join(
    dir,
    `source.${ext}`
  );

  let receivedBytes = 0;

  /*
   * Bridge the Next.js Web ReadableStream directly
   * into a Node-compatible async iterable.
   *
   * This avoids the ReadableStream type mismatch
   * between DOM/Web Streams and Node stream/web.
   */
  const bodyStream = req.body;

  const limitedStream = async function* () {
    const reader = bodyStream.getReader();

    try {
      while (true) {
        const { done, value } =
          await reader.read();

        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        const buffer = Buffer.from(value);

        receivedBytes += buffer.length;

        if (
          receivedBytes >
          MAX_UPLOAD_SIZE
        ) {
          throw new Error(
            "UPLOAD_SIZE_LIMIT_EXCEEDED"
          );
        }

        yield buffer;
      }
    } finally {
      reader.releaseLock();
    }
  };

  try {
    await pipeline(
      limitedStream(),
      fs.createWriteStream(filePath)
    );
  } catch (error) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}

    if (
      error instanceof Error &&
      error.message ===
        "UPLOAD_SIZE_LIMIT_EXCEEDED"
    ) {
      return NextResponse.json(
        {
          error:
            "File is too large. CAPTIFY supports files up to 3 GB.",
        },
        { status: 413 }
      );
    }

    console.error(
      "[upload] Upload failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Upload failed while saving the file.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    ext,
    size: receivedBytes,
  });
}