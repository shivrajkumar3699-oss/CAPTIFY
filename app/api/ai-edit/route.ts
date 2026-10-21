import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { isAuthenticated } = await auth();
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Please sign in to use the editing assistant." }, { status: 401 });
    }

    const body = await req.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 2000) {
      return NextResponse.json({ error: "Enter an editing request of 1–2000 characters." }, { status: 400 });
    }

    const workerUrl = process.env.NODE_ENV === "production"
      ? "https://captify-worker.onrender.com"
      : process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) {
      return NextResponse.json({ error: "Worker configuration is missing." }, { status: 500 });
    }

    const response = await fetch(`${workerUrl.replace(/\/+$/, "")}/ai-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": workerSecret },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error || "Editing assistant is temporarily unavailable." }, { status: response.status === 400 ? 400 : 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("[ai-edit route]", error);
    return NextResponse.json({ error: "Editing assistant is temporarily unavailable." }, { status: 502 });
  }
}
