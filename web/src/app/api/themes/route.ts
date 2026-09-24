import { NextResponse } from "next/server";
import { runThemesAgent } from "@/lib/agent/runThemesAgent";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  try {
    const result = await runThemesAgent();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Themes agent failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
