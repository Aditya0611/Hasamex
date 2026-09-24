import { tool } from "ai";
import { z } from "zod";
import { getExpertMeta, loadCaseData } from "@/lib/load";
import { buildVerifiedCitation } from "@/lib/verify";
import type { CrossAnalysis, ExpertId } from "@/lib/types";
import { transcriptAgentTools } from "@/lib/agent/tools";

const quoteRefSchema = z.object({
  expertId: z.enum(["france", "germany", "uk"]),
  timestamp: z.string(),
  quote: z.string(),
});

/**
 * Themes agent tools: reuse transcript search tools, then submit verified cross-analysis.
 */
export const themesAgentTools = {
  get_qa_pair: transcriptAgentTools.get_qa_pair,
  search_transcripts: transcriptAgentTools.search_transcripts,
  verify_citation: transcriptAgentTools.verify_citation,

  submit_cross_analysis: tool({
    description:
      "Submit common themes and disagreements after gathering transcript evidence. Quotes must be exact transcript text. Call this once when ready.",
    inputSchema: z.object({
      themes: z
        .array(
          z.object({
            theme: z.string(),
            summary: z.string(),
            supportingExperts: z.array(z.enum(["france", "germany", "uk"])),
            quoteRefs: z.array(quoteRefSchema).min(1).max(6),
          }),
        )
        .min(1)
        .max(4),
      disagreements: z
        .array(
          z.object({
            topic: z.string(),
            summary: z.string(),
            positions: z
              .array(
                z.object({
                  expertId: z.enum(["france", "germany", "uk"]),
                  stance: z.string(),
                  timestamp: z.string(),
                  quote: z.string(),
                }),
              )
              .min(2)
              .max(3),
          }),
        )
        .min(1)
        .max(4),
    }),
    execute: async ({ themes, disagreements }): Promise<CrossAnalysis> => {
      const data = loadCaseData();
      const utterances = data.utterances;

      return {
        themes: themes.map((t) => ({
          theme: t.theme,
          summary: t.summary,
          supportingExperts: t.supportingExperts as ExpertId[],
          citations: t.quoteRefs
            .map((r) =>
              buildVerifiedCitation(r.quote, r.timestamp, r.expertId, utterances),
            )
            .filter((c): c is NonNullable<typeof c> => Boolean(c)),
        })),
        disagreements: disagreements.map((d) => ({
          topic: d.topic,
          summary: d.summary,
          positions: d.positions.map((p) => {
            const meta = getExpertMeta(p.expertId)!;
            const citation = buildVerifiedCitation(
              p.quote,
              p.timestamp,
              p.expertId,
              utterances,
            );
            return {
              expertId: p.expertId as ExpertId,
              expertName: meta.expertName,
              market: meta.market,
              stance: p.stance,
              citations: citation ? [citation] : [],
            };
          }),
        })),
      };
    },
  }),
};

/** Pull CrossAnalysis from agent tool results if submit_cross_analysis was used. */
export function crossAnalysisFromToolOutputs(outputs: unknown[]): CrossAnalysis | null {
  for (const out of outputs) {
    if (
      out &&
      typeof out === "object" &&
      "themes" in out &&
      "disagreements" in out &&
      Array.isArray((out as CrossAnalysis).themes) &&
      Array.isArray((out as CrossAnalysis).disagreements) &&
      (out as CrossAnalysis).themes.length > 0
    ) {
      return out as CrossAnalysis;
    }
  }
  return null;
}
