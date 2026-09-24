import { generateText, stepCountIs } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { hasLlmKey, MODEL } from "@/lib/openai";
import { askAcrossTranscripts } from "@/lib/analysis";
import { isCaseRelevantQuestion } from "@/lib/retrieve";
import type { AskResponse, Citation, ExpertId } from "@/lib/types";
import { citationsFromUnknown, transcriptAgentTools } from "@/lib/agent/tools";
import { deriveCrossFromCitations } from "@/lib/agent/deriveCrossFromEvidence";

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

function withDerivedCross(
  citations: Citation[],
  mode: AskResponse["usedMode"],
  question: string,
): AskResponse {
  const top = pickTopCitations(citations);
  const n = top.length;
  return {
    // Short line only — full quotes live in Citations (shown once)
    answer:
      n === 0
        ? "No supporting evidence found across the transcripts."
        : `Found ${n} transcript quote${n === 1 ? "" : "s"} across the expert calls.`,
    citations: top,
    evidenceFound: top.length > 0,
    usedMode: mode,
    crossAnalysis: deriveCrossFromCitations(top, question),
  };
}

function emptyAsk(message: string): AskResponse {
  return {
    answer: message,
    citations: [],
    evidenceFound: false,
    usedMode: "agent",
    crossAnalysis: null,
  };
}

/**
 * Ask flow:
 * 1) Retrieve transcript evidence (agent tools or grounded ask)
 * 2) Show exact quotes as the answer (do not invent)
 * 3) Derive themes / disagreements from those quotes only
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
    if (!grounded.evidenceFound) {
      return emptyAsk("No supporting evidence found across the transcripts.");
    }
    return withDerivedCross(grounded.citations, grounded.usedMode, trimmed);
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
1) get_qa_pair — use the USER question verbatim
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
        return withDerivedCross(
          (out as AskResponse).citations,
          "agent",
          trimmed,
        );
      }
    }

    const citations = citationsFromUnknown(toolOutputs);
    if (citations.length > 0) {
      return withDerivedCross(citations, "agent", trimmed);
    }

    const grounded = await askAcrossTranscripts(trimmed);
    if (grounded.evidenceFound) {
      return withDerivedCross(grounded.citations, grounded.usedMode, trimmed);
    }

    return emptyAsk("No supporting evidence found across the transcripts.");
  } catch (error) {
    console.error("Agent failed, falling back to grounded ask:", error);
    const grounded = await askAcrossTranscripts(trimmed);
    return grounded.evidenceFound
      ? withDerivedCross(grounded.citations, grounded.usedMode, trimmed)
      : emptyAsk("No supporting evidence found across the transcripts.");
  }
}
