import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { setJobStatus } from "@/lib/jobStore";

export async function POST() {
  const jobId = uuid();
  setJobStatus(jobId, { status: "queued", progress: 0, message: "Job created" });
  return NextResponse.json({ jobId });
}