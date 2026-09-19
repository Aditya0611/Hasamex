import { tool } from "ai";
import { z } from "zod";
import {
  askAcrossTranscripts,
  findInterviewFollowUps,
} from "@/lib/analysis";
import { loadCaseData } from "@/lib/load";
import { retrieveRelevantHybrid } from "@/lib/retrieve";
import { citationFromUtterance, buildVerifiedCitation } from "@/lib/verify";
import type { Citation, ExpertId } from "@/lib/types";
import { getExpertMeta } from "@/lib/load";

/**
 * Grounded tools for the CallBrief orchestrator agent.
 * The model may only answer using tool outputs.
 */
export const transcriptAgentTools = {
  get_qa_pair: tool({
    description:
      "Match the user question to an interviewer question in the transcripts and return the expert reply that follows (best for questions that appear in the calls).",
    inputSchema: z.object({
      question: z.string().describe("The user question to match"),
    }),
    execute: async ({ question }) => {
      const data = loadCaseData();
      const pairs = findInterviewFollowUps(data.utterances, question);
      if (pairs.length === 0) {
        return { found: false, pairs: [] as const };
      }
      // One best reply per expert (France, Germany, UK)
      const seen = new Set<string>();
      const top: typeof pairs = [];
      for (const p of pairs) {
        if (seen.has(p.answer.expertId)) continue;
        seen.add(p.answer.expertId);
        top.push(p);
        if (top.length >= 3) break;
      }
      return {
        found: true,
        pairs: top.map((p) => {
          const meta = getExpertMeta(p.answer.expertId)!;
          return {
            score: p.score,
            expertId: p.answer.expertId,
            expertName: meta.expertName,
            market: meta.market,
            timestamp: p.answer.timestamp,
            utteranceId: p.answer.id,
            quote: p.answer.text,
          };
        }),
      };
    },
  }),

  search_transcripts: tool({
    description:
      "Semantic + keyword search over expert utterances across transcripts. Use for open questions; optionally filter by expertId.",
    inputSchema: z.object({
      query: z.string(),
      expertId: z.enum(["france", "germany", "uk"]).optional(),
      topK: z.number().min(1).max(8).optional(),
    }),
    execute: async ({ query, expertId, topK }) => {
      const data = loadCaseData();
      const hits = await retrieveRelevantHybrid(data.utterances, query, {
        expertId: expertId as ExpertId | undefined,
        topK: topK ?? 5,
        expertOnly: true,
        minScore: 0.28,
      });
      return {
        found: hits.length > 0,
        mode: "hybrid_semantic",
        hits: hits.map((u) => {
          const meta = getExpertMeta(u.expertId)!;
          return {
            expertId: u.expertId,
            expertName: meta.expertName,
            market: meta.market,
            timestamp: u.timestamp,
            utteranceId: u.id,
            quote: u.text,
          };
        }),
      };
    },
  }),

  verify_citation: tool({
    description:
      "Verify that a quote exists in an expert transcript. Always call before trusting a quote.",
    inputSchema: z.object({
      expertId: z.enum(["france", "germany", "uk"]),
      quote: z.string(),
      timestamp: z.string().optional(),
    }),
    execute: async ({ expertId, quote, timestamp }) => {
      const data = loadCaseData();
      const scoped = data.utterances.filter((u) => u.expertId === expertId);
      const verified = buildVerifiedCitation(
        quote,
        timestamp,
        expertId as ExpertId,
        scoped,
      );
      return {
        verified: Boolean(verified),
        citation: verified,
      };
    },
  }),

  grounded_ask: tool({
    description:
      "Deterministic grounded ask (Q→A pair or retrieval). Use when you need a safe transcript-faithful answer quickly.",
    inputSchema: z.object({
      question: z.string(),
    }),
    execute: async ({ question }) => {
      const result = await askAcrossTranscripts(question);
      return result;
    },
  }),
};

export type AgentToolName = keyof typeof transcriptAgentTools;

/** Flatten tool-produced citation-like objects into Citation[]. */
export function citationsFromUnknown(value: unknown): Citation[] {
  const out: Citation[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (
      typeof obj.quote === "string" &&
      typeof obj.timestamp === "string" &&
      typeof obj.expertId === "string" &&
      typeof obj.utteranceId === "string"
    ) {
      const meta = getExpertMeta(String(obj.expertId));
      if (meta) {
        out.push({
          expertId: meta.id,
          expertName:
            typeof obj.expertName === "string" ? obj.expertName : meta.expertName,
          market: typeof obj.market === "string" ? obj.market : meta.market,
          timestamp: obj.timestamp,
          quote: obj.quote,
          utteranceId: obj.utteranceId,
          verified: obj.verified === false ? false : true,
        });
      }
      return;
    }
    if (obj.citation) visit(obj.citation);
    if (obj.citations) visit(obj.citations);
    if (obj.pairs) visit(obj.pairs);
    if (obj.hits) visit(obj.hits);
  };
  visit(value);
  // de-dupe
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.utteranceId}:${c.quote.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function citationFromHit(hit: {
  expertId: string;
  timestamp: string;
  quote: string;
  utteranceId: string;
}): Citation | null {
  const data = loadCaseData();
  const u = data.utterances.find((x) => x.id === hit.utteranceId);
  if (u) return citationFromUtterance(u, hit.quote);
  return null;
}
