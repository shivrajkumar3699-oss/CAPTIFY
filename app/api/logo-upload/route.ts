import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_LOGO_BYTES = 100 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function PUT(req: NextRequest) {
  try {
    const { isAuthenticated } = await auth();
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Please sign in to upload a logo." }, { status: 401 });
    }

    const contentType = String(req.headers.get("content-type") || "").toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return NextResponse.json({ error: "Use a PNG, JPEG, or WebP image." }, { status: 415 });
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo images must be 100 MB or smaller." }, { status: 413 });
    }

    const logoId = String(req.headers.get("x-logo-id") || "").trim();
    if (!/^[a-f0-9-]{16,80}$/i.test(logoId)) {
      return NextResponse.json({ error: "Invalid upload reference." }, { status: 400 });
    }

    const workerUrl = process.env.NODE_ENV === "production"
      ? "https://captify-worker.onrender.com"
      : process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) {
      return NextResponse.json({ error: "Worker configuration is missing." }, { status: 500 });
    }

    if (!req.body) {
      return NextResponse.json({ error: "The image upload was empty." }, { status: 400 });
    }

    const response = await fetch(
      `${workerUrl.replace(/\/+$/, "")}/upload-logo/${encodeURIComponent(logoId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "x-worker-secret": workerSecret,
        },
        body: req.body,
        duplex: "half",
        signal: AbortSignal.timeout(120000),
      } as RequestInit
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Logo upload failed." },
        { status: response.status }
      );
    }

    return NextResponse.json({ ok: true, logoId });
  } catch (error) {
    console.error("[logo-upload route]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Logo upload failed. Please try again." }, { status: 502 });
  }
}
