import { generateText, stepCountIs } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { hasLlmKey, MODEL } from "@/lib/openai";
import { getExtractiveCrossAnalysis } from "@/lib/analysis";
import type { CrossAnalysis } from "@/lib/types";
import {
  crossAnalysisFromToolOutputs,
  themesAgentTools,
} from "@/lib/agent/themeTools";

export type ThemesAgentResult = {
  crossAnalysis: CrossAnalysis;
  usedMode: "agent" | "extractive";
};

/**
 * Agent-first themes & disagreements (Vercel AI SDK + Groq tool calling).
 * Falls back to extractive cross-analysis when no key / agent fails.
 */
export async function runThemesAgent(): Promise<ThemesAgentResult> {
  if (!hasLlmKey()) {
    return {
      crossAnalysis: getExtractiveCrossAnalysis(),
      usedMode: "extractive",
    };
  }

  try {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

    const result = await generateText({
      model: groq(MODEL),
      temperature: 0,
      stopWhen: stepCountIs(12),
      tools: themesAgentTools,
      system: `You are CallBrief's themes agent for 3 robotic-surgery expert calls (France, Germany, UK).

Goal: find common themes and clear disagreements across the three experts.

Rules:
- Use tools only. Do not invent quotes, numbers, or facts.
- Preferred tool order:
  1) get_qa_pair / search_transcripts for topics like adoption, barriers, ROI, training, outlook, purchase timeline
  2) Cover all three experts when evidence exists
  3) verify_citation for quotes you will submit
  4) submit_cross_analysis once with 2–3 themes and 1–3 disagreements
- quote fields must be exact transcript text from tool outputs.
- After submit_cross_analysis succeeds, reply with only "done".`,
      prompt:
        "Analyse the three expert transcripts. Identify common themes and disagreements. Submit a verified cross-analysis.",
    });

    const toolOutputs = result.steps.flatMap((step) =>
      (step.toolResults ?? []).map((tr) => ("output" in tr ? tr.output : tr)),
    );

    const submitted = crossAnalysisFromToolOutputs(toolOutputs);
    if (submitted && submitted.themes.length > 0) {
      // Keep only themes/disagreements that still have at least one verified citation
      const crossAnalysis: CrossAnalysis = {
        themes: submitted.themes.filter((t) => t.citations.length > 0),
        disagreements: submitted.disagreements.filter((d) =>
          d.positions.some((p) => p.citations.length > 0),
        ),
      };
      if (crossAnalysis.themes.length > 0) {
        return { crossAnalysis, usedMode: "agent" };
      }
    }

    return {
      crossAnalysis: getExtractiveCrossAnalysis(),
      usedMode: "extractive",
    };
  } catch (error) {
    console.error("Themes agent failed, extractive fallback:", error);
    return {
      crossAnalysis: getExtractiveCrossAnalysis(),
      usedMode: "extractive",
    };
  }
}
