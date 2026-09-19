import { NextResponse } from "next/server";
import { runFullAnalysis } from "@/lib/analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const analysis = await runFullAnalysis({ force });
    return NextResponse.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
