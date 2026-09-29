import { auth } from "@clerk/nextjs/server";
import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_UPLOAD_SIZE = 3 * 1024 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "mp4",
  "mkv",
]);

export async function POST(request: Request) {
  try {
    const { isAuthenticated, userId } = await auth();

    if (!isAuthenticated || !userId) {
      return NextResponse.json(
        {
          error:
            "Please sign in before uploading a file.",
        },
        { status: 401 }
      );
    }

    const body = (await request.json()) as HandleUploadBody;

    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (
        pathname,
        clientPayload
      ) => {
        let payload: {
          jobId?: string;
          ext?: string;
        } = {};

        try {
          payload = clientPayload
            ? JSON.parse(clientPayload)
            : {};
        } catch {
          throw new Error(
            "Invalid upload payload."
          );
        }

        const jobId = String(
          payload.jobId || ""
        ).trim();

        const ext = String(
          payload.ext || ""
        )
          .trim()
          .toLowerCase()
          .replace(/^\./, "");

        if (
          !jobId ||
          !/^[a-zA-Z0-9_-]+$/.test(jobId)
        ) {
          throw new Error("Invalid jobId.");
        }

        if (!ALLOWED_EXTENSIONS.has(ext)) {
          throw new Error(
            "Unsupported file type. Allowed: MP3, WAV, MP4, MKV."
          );
        }

        if (
          !pathname.startsWith(
            `uploads/${jobId}/source.`
          )
        ) {
          throw new Error(
            "Invalid upload path."
          );
        }

        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/wav",
            "audio/x-wav",
            "video/mp4",
            "video/x-matroska",
          ],
          maximumSizeInBytes:
            MAX_UPLOAD_SIZE,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({
            userId,
            jobId,
            ext,
          }),
        };
      },
      onUploadCompleted: async () => {
        // The worker downloads the Blob directly after
        // the processing request is created.
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "[upload] Client upload setup failed:",
      error
    );

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
