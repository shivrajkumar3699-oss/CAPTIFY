import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  const ext = req.nextUrl.searchParams.get("ext") || "mp4";

  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }

  const storageDir = process.env.STORAGE_DIR!;
  const dir = path.join(storageDir, "uploads", jobId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `source.${ext}`);

  const nodeStream = Readable.fromWeb(req.body as any);
  await pipeline(nodeStream, fs.createWriteStream(filePath));

  return NextResponse.json({ ok: true, path: filePath, ext });
}