import { NextResponse } from "next/server";
import { getCaseOverview } from "@/lib/analysis";

export const runtime = "nodejs";

export function GET() {
  const data = getCaseOverview();
  return NextResponse.json({
    questions: data.questions,
    transcripts: data.transcripts,
    utterances: data.utterances,
  });
}
