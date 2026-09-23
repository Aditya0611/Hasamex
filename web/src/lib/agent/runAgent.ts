import { generateText, stepCountIs } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { hasLlmKey, MODEL } from "@/lib/openai";
import { askAcrossTranscripts } from "@/lib/analysis";
import { isCaseRelevantQuestion } from "@/lib/retrieve";
import type { AskResponse, Citation, ExpertId } from "@/lib/types";
import { citationsFromUnknown, transcriptAgentTools } from "@/lib/agent/tools";

const EXPERT_ORDER: ExpertId[] = ["france", "germany", "uk"];

/** Keep at most one citation per expert (France → Germany → UK), max 3. */
function pickTopCitations(citations: Citation[]): Citation[] {
  const byExpert = new Map<ExpertId, Citation>();
  for (const c of citations) {
    if (!byExpert.has(c.expertId)) byExpert.set(c.expertId, c);
  }
  return EXPERT_ORDER.map((id) => byExpert.get(id)).filter(
    (c): c is Citation => Boolean(c),
  );
}

/** Build the visible answer only from verified transcript quotes (never model prose). */
function answerFromCitations(citations: Citation[]): string {
  return pickTopCitations(citations)
    .map((c) => `${c.market} (${c.expertName}) · ${c.timestamp}\n${c.quote}`)
    .join("\n\n");
}

function groundedResponse(citations: Citation[], mode: AskResponse["usedMode"]): AskResponse {
  const top = pickTopCitations(citations);
  return {
    answer: answerFromCitations(top),
    citations: top,
    evidenceFound: top.length > 0,
    usedMode: mode,
  };
}

function emptyAsk(message: string): AskResponse {
  return {
    answer: message,
    citations: [],
    evidenceFound: false,
    usedMode: "agent",
  };
}

/**
 * Agent-first Ask (Vercel AI SDK + Groq tool calling).
 * Extractive / grounded path is fallback only when the agent cannot run or finds nothing.
 */
export async function runTranscriptAgent(question: string): Promise<AskResponse> {
  const trimmed = question.trim();
  if (!trimmed) {
    return emptyAsk("Please enter a question.");
  }

  if (!isCaseRelevantQuestion(trimmed)) {
    return emptyAsk(
      "No supporting evidence found across the transcripts. Ask something about the expert calls — for example adoption, barriers, ROI, or training.",
    );
  }

  if (!hasLlmKey()) {
    const grounded = await askAcrossTranscripts(trimmed);
    return { ...grounded, usedMode: grounded.usedMode };
  }

  try {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

    const result = await generateText({
      model: groq(MODEL),
      temperature: 0,
      stopWhen: stepCountIs(8),
      tools: transcriptAgentTools,
      system: `You are CallBrief, a tool-calling transcript agent.
You MUST use tools to gather evidence. Do not invent facts, numbers, or quotes.
If the user question is small talk or unrelated to robotic-surgery expert calls, do not search. Reply "no evidence".

Always start with tools — preferred order:
1) get_qa_pair — use the USER question verbatim (do not rewrite it into a guide question)
2) search_transcripts — semantic/keyword search with the USER question verbatim
3) verify_citation — for any quote you rely on
4) grounded_ask — only if the other tools return nothing useful

Cover all three experts when evidence exists.
After tools finish, reply with only "done" or "no evidence".
Never write your own summary of what experts said.`,
      prompt: trimmed,
    });

    const toolOutputs = result.steps.flatMap((step) =>
      (step.toolResults ?? []).map((tr) => ("output" in tr ? tr.output : tr)),
    );

    // Prefer grounded_ask tool payload if the agent used it
    for (const out of toolOutputs) {
      if (
        out &&
        typeof out === "object" &&
        "evidenceFound" in out &&
        "citations" in out &&
        (out as AskResponse).evidenceFound &&
        Array.isArray((out as AskResponse).citations) &&
        (out as AskResponse).citations.length > 0
      ) {
        const g = out as AskResponse;
        return groundedResponse(g.citations, "agent");
      }
    }

    const citations = citationsFromUnknown(toolOutputs);
    if (citations.length > 0) {
      return groundedResponse(citations, "agent");
    }

    // Agent ran but found nothing — last-resort grounded fallback
    const grounded = await askAcrossTranscripts(trimmed);
    if (grounded.evidenceFound) {
      return groundedResponse(grounded.citations, "agent");
    }

    return emptyAsk("No supporting evidence found across the transcripts.");
  } catch (error) {
    console.error("Agent failed, falling back to grounded ask:", error);
    const grounded = await askAcrossTranscripts(trimmed);
    return grounded.evidenceFound
      ? groundedResponse(grounded.citations, grounded.usedMode)
      : emptyAsk("No supporting evidence found across the transcripts.");
  }
}
