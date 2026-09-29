import { NextRequest, NextResponse } from "next/server";
import { getJobStatus } from "@/lib/jobStore";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const status = getJobStatus(jobId);

  if (!status) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(status);
}