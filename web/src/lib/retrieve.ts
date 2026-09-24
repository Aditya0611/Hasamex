import type { ExpertId, Utterance } from "./types";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "can",
  "how",
  "what",
  "when",
  "where",
  "who",
  "which",
  "why",
  "your",
  "you",
  "we",
  "they",
  "their",
  "our",
  "my",
  "me",
  "i",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "as",
  "by",
  "about",
  "into",
  "over",
  "after",
  "before",
  "than",
  "then",
  "also",
  "just",
  "very",
  "more",
  "most",
  "some",
  "any",
  "not",
  "no",
  "yes",
  "am",
]);

const BARRIER_TERMS = [
  "barrier",
  "barriers",
  "holding",
  "hold",
  "back",
  "cost",
  "costs",
  "funding",
  "budget",
  "capital",
  "approval",
  "training",
  "capacity",
  "pressure",
  "issue",
  "stalls",
  "stall",
];

const ROI_TERMS = [
  "roi",
  "return",
  "economics",
  "economic",
  "finance",
  "financial",
  "budget",
  "cost",
  "pay",
  "ownership",
  "utilisation",
  "utilization",
];

const TIMELINE_TERMS = [
  "timeline",
  "months",
  "purchase",
  "decision",
  "process",
  "cycle",
  "longer",
];

const TREND_TERMS = [
  "trend",
  "expect",
  "outlook",
  "years",
  "accelerate",
  "growth",
  "percent",
  "gradually",
];

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const CASE_TERMS = new Set([
  "adoption",
  "adopt",
  "robotic",
  "robot",
  "surgery",
  "surgical",
  "hospital",
  "hospitals",
  "surgeon",
  "surgeons",
  "barrier",
  "barriers",
  "budget",
  "budgets",
  "roi",
  "training",
  "outcome",
  "outcomes",
  "clinical",
  "timeline",
  "purchase",
  "procurement",
  "economic",
  "economics",
  "cost",
  "costs",
  "capital",
  "nhs",
  "france",
  "germany",
  "uk",
  "market",
  "expert",
  "transcript",
  "utilisation",
  "utilization",
  "trend",
  "outlook",
  "theme",
  "themes",
  "disagreement",
  "disagreements",
  "disagree",
  "differ",
  "difference",
  "differences",
  "consensus",
  "common",
  "agree",
]);

const SMALLTALK =
  /^(hi|hello|hey|yo|sup|thanks|thank you|how are you|how r you|how're you|what's up|whats up|who are you|good morning|good evening|good night|ok|okay|test)[\s!.?]*$/i;

/** True when the question has enough real content words to search safely. */
export function hasSearchableQuestion(question: string): boolean {
  const tokens = tokenize(question);
  if (tokens.length >= 2) return true;
  // Allow a single strong topic word (e.g. "barriers", "ROI", "timeline")
  return tokens.length === 1 && tokens[0].length >= 5;
}

/** False for greetings / off-topic asks that must not retrieve random quotes. */
export function isCaseRelevantQuestion(question: string): boolean {
  const q = question.trim();
  if (!q || SMALLTALK.test(q)) return false;
  if (!hasSearchableQuestion(q)) return false;
  const tokens = tokenize(q);
  return tokens.some((t) =>
    [...CASE_TERMS].some((term) => t === term || (t.length >= 5 && (term.startsWith(t) || t.startsWith(term)))),
  );
}

function detectIntent(
  query: string,
): "barrier" | "roi" | "timeline" | "trend" | "general" {
  const lower = query.toLowerCase();
  if (
    lower.includes("holding") ||
    lower.includes("barrier") ||
    lower.includes("hold back") ||
    lower.includes("holding back") ||
    lower.includes("prevent") ||
    lower.includes("challenge")
  ) {
    return "barrier";
  }
  if (
    lower.includes("roi") ||
    lower.includes("return on") ||
    lower.includes("econom")
  ) {
    return "roi";
  }
  if (
    lower.includes("timeline") ||
    lower.includes("how long") ||
    lower.includes("purchase") ||
    lower.includes("decision")
  ) {
    return "timeline";
  }
  if (
    (lower.includes("3") && lower.includes("5")) ||
    lower.includes("outlook") ||
    lower.includes("expect") ||
    lower.includes("trend") ||
    lower.includes("next")
  ) {
    return "trend";
  }
  return "general";
}

function expandQueryTokens(query: string): string[] {
  const base = tokenize(query);
  const expanded = new Set(base);
  const intent = detectIntent(query);

  if (intent === "barrier") {
    BARRIER_TERMS.forEach((t) => expanded.add(t));
    expanded.delete("adoption");
    expanded.delete("growing");
    expanded.delete("growth");
    expanded.delete("increasing");
  } else if (intent === "roi") {
    ROI_TERMS.forEach((t) => expanded.add(t));
  } else if (intent === "timeline") {
    TIMELINE_TERMS.forEach((t) => expanded.add(t));
  } else if (intent === "trend") {
    TREND_TERMS.forEach((t) => expanded.add(t));
  }

  return [...expanded];
}

function tokenOverlapScore(qTokens: string[], text: string): number {
  if (qTokens.length === 0) return 0;
  const textTokens = tokenize(text);
  const textSet = new Set(textTokens);
  let overlap = 0;
  for (const token of qTokens) {
    if (textSet.has(token)) overlap += 1;
    else if (textTokens.some((t) => t.startsWith(token) || token.startsWith(t))) {
      overlap += 0.5;
    }
  }
  return overlap / qTokens.length;
}

export function scoreUtterance(query: string, utterance: Utterance): number {
  const qTokens = expandQueryTokens(query);
  // Overlap only — no flat expert bonus (that caused junk queries to match).
  let score = tokenOverlapScore(qTokens, `${utterance.speaker} ${utterance.text}`);

  const intent = detectIntent(query);
  const lower = utterance.text.toLowerCase();
  if (intent === "barrier") {
    if (
      lower.includes("barrier") ||
      lower.includes("budget") ||
      lower.includes("capital") ||
      lower.includes("cost") ||
      lower.includes("funding") ||
      lower.includes("training")
    ) {
      score += 0.35;
    }
    if (
      (lower.includes("adoption is growing") ||
        lower.includes("it is growing") ||
        lower.includes("adoption is increasing")) &&
      !lower.includes("barrier") &&
      !lower.includes("budget") &&
      !lower.includes("cost") &&
      !lower.includes("funding") &&
      !lower.includes("training")
    ) {
      score -= 0.4;
    }
  }

  return score;
}

export function retrieveRelevant(
  utterances: Utterance[],
  query: string,
  opts?: {
    expertId?: ExpertId;
    topK?: number;
    expertOnly?: boolean;
    minScore?: number;
  },
): Utterance[] {
  const topK = opts?.topK ?? 4;
  const minScore = opts?.minScore ?? 0.28;
  const qTokens = expandQueryTokens(query);
  if (qTokens.length === 0) return [];

  const boosted = new Map<string, number>();
  for (let i = 0; i < utterances.length; i++) {
    const u = utterances[i];
    if (opts?.expertId && u.expertId !== opts.expertId) continue;
    if (u.isExpert) continue;
    const interviewerScore = tokenOverlapScore(qTokens, u.text);
    if (interviewerScore < 0.25) continue;
    const next = utterances[i + 1];
    if (next && next.isExpert && next.expertId === u.expertId) {
      boosted.set(next.id, (boosted.get(next.id) ?? 0) + 0.55 + interviewerScore);
    }
  }

  return utterances
    .filter((u) => (opts?.expertId ? u.expertId === opts.expertId : true))
    .filter((u) => (opts?.expertOnly === false ? true : u.isExpert))
    .map((u) => ({
      u,
      score: scoreUtterance(query, u) + (boosted.get(u.id) ?? 0),
    }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || a.u.seconds - b.u.seconds)
    .slice(0, topK)
    .map((x) => x.u);
}

/**
 * Hybrid retrieval: lexical + semantic (MiniLM embeddings).
 * Falls back to lexical-only if the embedding model is unavailable.
 */
export async function retrieveRelevantHybrid(
  utterances: Utterance[],
  query: string,
  opts?: {
    expertId?: ExpertId;
    topK?: number;
    expertOnly?: boolean;
    minScore?: number;
    semanticWeight?: number;
  },
): Promise<Utterance[]> {
  const topK = opts?.topK ?? 4;
  const minScore = opts?.minScore ?? 0.28;
  const semanticWeight = opts?.semanticWeight ?? 0.6;
  const lexicalWeight = 1 - semanticWeight;

  const qTokens = expandQueryTokens(query);
  if (qTokens.length === 0) return [];

  const scoped = utterances
    .filter((u) => (opts?.expertId ? u.expertId === opts.expertId : true))
    .filter((u) => (opts?.expertOnly === false ? true : u.isExpert));

  const boosted = new Map<string, number>();
  for (let i = 0; i < utterances.length; i++) {
    const u = utterances[i];
    if (opts?.expertId && u.expertId !== opts.expertId) continue;
    if (u.isExpert) continue;
    const interviewerScore = tokenOverlapScore(qTokens, u.text);
    if (interviewerScore < 0.25) continue;
    const next = utterances[i + 1];
    if (next && next.isExpert && next.expertId === u.expertId) {
      boosted.set(next.id, (boosted.get(next.id) ?? 0) + 0.55 + interviewerScore);
    }
  }

  let sem = new Map<string, number>();
  try {
    const { semanticScores } = await import("./semantic");
    sem = await semanticScores(query, scoped);
  } catch {
    // lexical only
  }

  const scored = scoped.map((u) => {
    const lexical = scoreUtterance(query, u) + (boosted.get(u.id) ?? 0);
    // Normalize lexical roughly into 0..1-ish for blending
    const lexNorm = Math.min(1, lexical / 1.2);
    const semScore = sem.get(u.id) ?? 0;
    const hasSemantic = sem.size > 0;
    const score = hasSemantic
      ? semanticWeight * semScore + lexicalWeight * lexNorm
      : lexical;
    return { u, score, semScore, lexical };
  });

  return scored
    .filter((x) => {
      if (sem.size === 0) return x.score >= minScore;
      // Require either decent semantic match or strong lexical match
      return x.semScore >= 0.35 || x.lexical >= minScore;
    })
    .sort((a, b) => b.score - a.score || a.u.seconds - b.u.seconds)
    .slice(0, topK)
    .map((x) => x.u);
}
