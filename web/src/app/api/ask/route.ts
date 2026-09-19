import { NextResponse } from "next/server";
import { askAcrossTranscripts } from "@/lib/analysis";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string };
    const question = body.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
    const result = await askAcrossTranscripts(question);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ask failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
