import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserHistory } from "@/lib/history";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { isAuthenticated, userId } =
      await auth();

    if (!isAuthenticated || !userId) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        { status: 401 }
      );
    }

    const projects =
      await getUserHistory(userId);

    return NextResponse.json({
      projects,
    });
  } catch (error) {
    console.error(
      "History API error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to load history",
      },
      { status: 500 }
    );
  }
}