import type { Citation, ExpertId, Utterance } from "./types";
import { getExpertMeta } from "./load";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ensure a model-produced quote actually appears in a retrieved utterance. */
export function verifyQuoteAgainstUtterances(
  quote: string,
  utterances: Utterance[],
): Utterance | null {
  const needle = normalize(quote);
  if (needle.length < 12) return null;

  for (const u of utterances) {
    const hay = normalize(u.text);
    if (hay.includes(needle)) return u;
  }

  // Allow minor truncation: require substantial contiguous overlap
  for (const u of utterances) {
    const hay = normalize(u.text);
    const window = Math.min(needle.length, 40);
    if (window < 20) continue;
    for (let i = 0; i <= needle.length - window; i += 8) {
      const slice = needle.slice(i, i + window);
      if (hay.includes(slice)) return u;
    }
  }

  return null;
}

export function citationFromUtterance(u: Utterance, quote?: string): Citation {
  const meta = getExpertMeta(u.expertId)!;
  return {
    expertId: u.expertId,
    expertName: meta.expertName,
    market: meta.market,
    timestamp: u.timestamp,
    quote: quote ?? u.text,
    utteranceId: u.id,
    verified: true,
  };
}

export function buildVerifiedCitation(
  quote: string,
  timestampHint: string | undefined,
  expertId: ExpertId,
  candidateUtterances: Utterance[],
): Citation | null {
  const scoped = candidateUtterances.filter((u) => u.expertId === expertId);
  const matched = verifyQuoteAgainstUtterances(quote, scoped);
  if (!matched) return null;

  const meta = getExpertMeta(expertId)!;
  return {
    expertId,
    expertName: meta.expertName,
    market: meta.market,
    timestamp: timestampHint && matched.timestamp === timestampHint ? timestampHint : matched.timestamp,
    quote: matched.text.includes(quote.trim()) ? quote.trim() : matched.text,
    utteranceId: matched.id,
    verified: true,
  };
}
