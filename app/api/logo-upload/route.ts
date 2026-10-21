import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 100 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: NextRequest) {
  try {
    const { isAuthenticated, userId } = await auth();
    if (!isAuthenticated || !userId) {
      return NextResponse.json({ error: "Please sign in to upload a logo." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const logoId = String(body?.logoId || "").trim();
    const contentType = String(body?.contentType || "").toLowerCase();
    const size = Number(body?.size);

    if (!/^[a-f0-9-]{16,80}$/i.test(logoId)) {
      return NextResponse.json({ error: "Invalid upload reference." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return NextResponse.json({ error: "Use a PNG, JPEG, or WebP image." }, { status: 415 });
    }
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo images must be larger than 0 bytes and no more than 100 MB." }, { status: 413 });
    }

    const workerUrl = process.env.NODE_ENV === "production"
      ? "https://captify-worker.onrender.com"
      : process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) {
      return NextResponse.json({ error: "Worker configuration is missing." }, { status: 500 });
    }

    const payload = Buffer.from(JSON.stringify({
      logoId,
      userId,
      contentType,
      size,
      maxBytes: MAX_LOGO_BYTES,
      exp: Date.now() + 10 * 60 * 1000,
    })).toString("base64url");
    const signature = createHmac("sha256", workerSecret).update(payload).digest("base64url");

    return NextResponse.json({
      ok: true,
      logoId,
      uploadUrl: `${workerUrl.replace(/\/+$/, "")}/upload-logo/${encodeURIComponent(logoId)}`,
      uploadToken: `${payload}.${signature}`,
      expiresInSeconds: 600,
    });
  } catch (error) {
    console.error("[logo-upload token route]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not prepare the logo upload." }, { status: 500 });
  }
}
