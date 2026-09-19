import { z } from "zod";
import fs from "fs";
import path from "path";
import { getExpertMeta, loadCaseData } from "./load";
import { getLlmClient, hasLlmKey, MODEL } from "./openai";
import { retrieveRelevant, retrieveRelevantHybrid, hasSearchableQuestion } from "./retrieve";
import type {
  AnalysisBundle,
  AskResponse,
  Citation,
  CrossAnalysis,
  ExpertId,
  GuidedAnswer,
  InterviewQuestion,
  Utterance,
} from "./types";
import { buildVerifiedCitation, citationFromUtterance } from "./verify";

const ExpertGuideSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      answer: z.string(),
      evidenceFound: z.boolean(),
      confidence: z.enum(["high", "medium", "low"]),
      citations: z.array(
        z.object({
          timestamp: z.string(),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

const CrossSchema = z.object({
  themes: z.array(
    z.object({
      theme: z.string(),
      summary: z.string(),
      supportingExperts: z.array(z.enum(["france", "germany", "uk"])),
      quoteRefs: z.array(
        z.object({
          expertId: z.enum(["france", "germany", "uk"]),
          timestamp: z.string(),
          quote: z.string(),
        }),
      ),
    }),
  ),
  disagreements: z.array(
    z.object({
      topic: z.string(),
      summary: z.string(),
      positions: z.array(
        z.object({
          expertId: z.enum(["france", "germany", "uk"]),
          stance: z.string(),
          timestamp: z.string(),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

const AskSchema = z.object({
  answer: z.string(),
  evidenceFound: z.boolean(),
  citations: z.array(
    z.object({
      expertId: z.enum(["france", "germany", "uk"]),
      timestamp: z.string(),
      quote: z.string(),
    }),
  ),
});

function formatEvidence(utterances: Utterance[]): string {
  return utterances
    .map(
      (u) =>
        `[${u.expertId} | ${u.timestamp} | ${u.speaker} | id=${u.id}] ${u.text}`,
    )
    .join("\n");
}

function cachePath(): string {
  return path.join(process.cwd(), ".cache", "analysis.json");
}

function seedPath(): string {
  return path.join(process.cwd(), "src", "data", "seed-analysis.json");
}

function readSeedOrCache(): AnalysisBundle | null {
  for (const p of [cachePath(), seedPath()]) {
    try {
      if (!fs.existsSync(p)) continue;
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as AnalysisBundle;
      if (parsed?.guideAnswers?.length) return parsed;
    } catch {
      // try next
    }
  }
  return null;
}

function writeCache(bundle: AnalysisBundle) {
  try {
    const dir = path.dirname(cachePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(bundle, null, 2), "utf8");
  } catch {
    // non-fatal
  }
}

async function llmJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const client = getLlmClient();

  const tryOnce = async (forceJsonObject: boolean) => {
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      ...(forceJsonObject
        ? { response_format: { type: "json_object" as const } }
        : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("Empty model response");
    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return schema.parse(JSON.parse(cleaned));
  };

  try {
    return await tryOnce(true);
  } catch {
    return await tryOnce(false);
  }
}

function extractiveAnswer(
  question: InterviewQuestion,
  expertId: ExpertId,
  utterances: Utterance[],
): GuidedAnswer {
  const meta = getExpertMeta(expertId)!;
  const hits = retrieveRelevant(utterances, question.text, {
    expertId,
    topK: 2,
    expertOnly: true,
    minScore: 0.08,
  });

  if (hits.length === 0) {
    return {
      questionId: question.id,
      question: question.text,
      expertId,
      expertName: meta.expertName,
      market: meta.market,
      answer: "No supporting evidence found in this transcript.",
      citations: [],
      confidence: "low",
      evidenceFound: false,
    };
  }

  const citations = hits.map((u) => citationFromUtterance(u));
  return {
    questionId: question.id,
    question: question.text,
    expertId,
    expertName: meta.expertName,
    market: meta.market,
    answer: hits[0].text,
    citations,
    confidence: hits.length > 1 ? "medium" : "low",
    evidenceFound: true,
  };
}

function buildExtractiveGuideAnswers(): GuidedAnswer[] {
  const data = loadCaseData();
  const guideAnswers: GuidedAnswer[] = [];
  for (const question of data.questions) {
    for (const transcript of data.transcripts) {
      guideAnswers.push(extractiveAnswer(question, transcript.id, data.utterances));
    }
  }
  return guideAnswers;
}

function extractiveCross(guideAnswers: GuidedAnswer[]): CrossAnalysis {
  const themes: CrossAnalysis["themes"] = [
    {
      theme: "Uneven adoption across hospital types",
      summary:
        "All three experts describe growth that is concentrated in larger/academic or better-funded centres, with smaller hospitals lagging.",
      supportingExperts: ["france", "germany", "uk"],
      citations: guideAnswers
        .filter((a) => a.questionId === "q1" && a.citations[0])
        .map((a) => a.citations[0]),
    },
    {
      theme: "Utilisation and training underpin economics",
      summary:
        "Experts link sustainable programmes to training enough surgeons/staff and achieving sufficient procedure volume.",
      supportingExperts: ["france", "germany", "uk"],
      citations: guideAnswers
        .filter(
          (a) =>
            (a.questionId === "q4" || a.questionId === "q2") && a.citations[0],
        )
        .slice(0, 3)
        .map((a) => a.citations[0]),
    },
  ];

  const roiAnswers = guideAnswers.filter(
    (a) => a.questionId === "q3" && a.evidenceFound,
  );
  const growthAnswers = guideAnswers.filter(
    (a) => a.questionId === "q5" && a.evidenceFound,
  );
  const timelineAnswers = guideAnswers.filter(
    (a) => a.questionId === "q6" && a.evidenceFound,
  );

  return {
    themes,
    disagreements: [
      {
        topic: "Weight of economics vs clinical strategy in purchase decisions",
        summary:
          "France and Germany emphasise finance/ROI as decisive; the UK expert describes a more balanced economics + clinical-strategy decision.",
        positions: roiAnswers.map((a) => ({
          expertId: a.expertId,
          expertName: a.expertName,
          market: a.market,
          stance: a.answer,
          citations: a.citations.slice(0, 1),
        })),
      },
      {
        topic: "Expected growth over 3–5 years",
        summary:
          "France cites ~15–20% procedure growth in stronger centres; Germany expects high-single/low-double digits market-wide; UK is more bullish if training and cost improve.",
        positions: growthAnswers.map((a) => ({
          expertId: a.expertId,
          expertName: a.expertName,
          market: a.market,
          stance: a.answer,
          citations: a.citations.slice(0, 1),
        })),
      },
      {
        topic: "Purchase decision timeline",
        summary:
          "Reported timelines differ: UK ~6–9 months when funding exists; France ~6–12 months; Germany commonly ~9–18 months.",
        positions: timelineAnswers.map((a) => ({
          expertId: a.expertId,
          expertName: a.expertName,
          market: a.market,
          stance: a.answer,
          citations: a.citations.slice(0, 1),
        })),
      },
    ],
  };
}

/** Three parallel Groq calls (one per expert) instead of 18 sequential. */
async function llmBatchedGuideAnswers(): Promise<GuidedAnswer[]> {
  const data = loadCaseData();

  const perExpert: GuidedAnswer[][] = [];
  for (const transcript of data.transcripts) {
    const scoped = data.utterances.filter(
      (u) => u.expertId === transcript.id && u.isExpert,
    );

    const system = `You answer interview-guide questions for ONE expert using ONLY the provided transcript evidence.
Rules:
- Do not invent facts, numbers, or opinions.
- Produce exactly one answer object per questionId listed.
- citations.quote must be an exact contiguous substring from the evidence.
- citations.timestamp must match the evidence timestamp.
- Keep each answer concise (2-4 sentences).
Return JSON only.`;

    const user = `Expert: ${transcript.expertName} (${transcript.market}) [id=${transcript.id}]

Questions:
${JSON.stringify(
  data.questions.map((q) => ({ questionId: q.id, question: q.text })),
  null,
  2,
)}

Evidence:
${formatEvidence(scoped)}

Return JSON:
{
  "answers": [
    {
      "questionId": "q1",
      "answer": "string",
      "evidenceFound": true,
      "confidence": "high",
      "citations": [{"timestamp":"00:00","quote":"exact quote"}]
    }
  ]
}`;

    try {
      const raw = await llmJson(system, user, ExpertGuideSchema);
      const byQ = new Map(raw.answers.map((a) => [a.questionId, a]));
      perExpert.push(
        data.questions.map((question) => {
          const item = byQ.get(question.id);
          if (!item) {
            return extractiveAnswer(question, transcript.id, data.utterances);
          }

          const citations: Citation[] = [];
          for (const c of item.citations) {
            const verified = buildVerifiedCitation(
              c.quote,
              c.timestamp,
              transcript.id,
              scoped,
            );
            if (verified) citations.push(verified);
          }

          if (item.evidenceFound && citations.length === 0) {
            return extractiveAnswer(question, transcript.id, data.utterances);
          }

          return {
            questionId: question.id,
            question: question.text,
            expertId: transcript.id,
            expertName: transcript.expertName,
            market: transcript.market,
            answer: item.evidenceFound
              ? item.answer
              : "No supporting evidence found in this transcript.",
            citations,
            confidence: citations.length ? item.confidence : "low",
            evidenceFound: citations.length > 0,
          } satisfies GuidedAnswer;
        }),
      );
    } catch (error) {
      console.error(`LLM guide failed for ${transcript.id}:`, error);
      perExpert.push(
        data.questions.map((q) =>
          extractiveAnswer(q, transcript.id, data.utterances),
        ),
      );
    }
  }

  const flat = perExpert.flat();
  const guideAnswers: GuidedAnswer[] = [];
  for (const question of data.questions) {
    for (const transcript of data.transcripts) {
      const found = flat.find(
        (a) => a.questionId === question.id && a.expertId === transcript.id,
      );
      if (found) guideAnswers.push(found);
    }
  }
  return guideAnswers;
}

async function llmCross(
  guideAnswers: GuidedAnswer[],
  utterances: Utterance[],
): Promise<CrossAnalysis> {
  const compact = guideAnswers.map((a) => ({
    questionId: a.questionId,
    question: a.question,
    expertId: a.expertId,
    market: a.market,
    answer: a.answer,
    citations: a.citations.map((c) => ({
      timestamp: c.timestamp,
      quote: c.quote,
    })),
  }));

  const system = `You synthesize cross-call themes and disagreements for expert interviews.
Rules:
- Only use provided answers/citations.
- Do not invent quotes.
- quote fields must be exact quotes from the provided citations.
- Prefer clear disagreements on economics emphasis, growth rates, and timelines.
Return JSON only.`;

  const user = `Guided answers JSON:
${JSON.stringify(compact, null, 2)}

Return JSON with keys themes and disagreements.`;

  const raw = await llmJson(system, user, CrossSchema);
  return {
    themes: raw.themes.map((t) => ({
      theme: t.theme,
      summary: t.summary,
      supportingExperts: t.supportingExperts as ExpertId[],
      citations: t.quoteRefs
        .map((r) =>
          buildVerifiedCitation(r.quote, r.timestamp, r.expertId, utterances),
        )
        .filter((c): c is Citation => Boolean(c)),
    })),
    disagreements: raw.disagreements.map((d) => ({
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
}

export async function runFullAnalysis(opts?: {
  force?: boolean;
}): Promise<AnalysisBundle> {
  // Instant path for demo reliability (avoid Groq rate-limit hangs)
  if (!opts?.force) {
    const ready = readSeedOrCache();
    if (ready) return ready;

    const guideAnswers = buildExtractiveGuideAnswers();
    const bundle: AnalysisBundle = {
      generatedAt: new Date().toISOString(),
      mode: "extractive",
      guideAnswers,
      crossAnalysis: extractiveCross(guideAnswers),
    };
    writeCache(bundle);
    return bundle;
  }

  const data = loadCaseData();

  if (!hasLlmKey()) {
    const guideAnswers = buildExtractiveGuideAnswers();
    const bundle: AnalysisBundle = {
      generatedAt: new Date().toISOString(),
      mode: "extractive",
      guideAnswers,
      crossAnalysis: extractiveCross(guideAnswers),
    };
    writeCache(bundle);
    return bundle;
  }

  try {
    const guideAnswers = await llmBatchedGuideAnswers();
    const crossAnalysis = await llmCross(guideAnswers, data.utterances).catch(
      () => extractiveCross(guideAnswers),
    );
    const bundle: AnalysisBundle = {
      generatedAt: new Date().toISOString(),
      mode: "llm",
      guideAnswers,
      crossAnalysis,
    };
    writeCache(bundle);
    return bundle;
  } catch (error) {
    const guideAnswers = buildExtractiveGuideAnswers();
    const bundle: AnalysisBundle = {
      generatedAt: new Date().toISOString(),
      mode: "extractive",
      guideAnswers,
      crossAnalysis: extractiveCross(guideAnswers),
    };
    writeCache(bundle);
    console.error("LLM analysis failed, returned extractive fallback:", error);
    return bundle;
  }
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?“”"']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const at = new Set(a.split(" ").filter((t) => t.length > 2));
  const bt = b.split(" ").filter((t) => t.length > 2);
  if (at.size === 0) return 0;
  let hit = 0;
  for (const t of bt) if (at.has(t)) hit += 1;
  return hit / at.size;
}

/** Interviewer phrasings that map to each interview-guide question. */
const GUIDE_INTERVIEWER_HINTS: Record<string, RegExp[]> = {
  q1: [/adoption.*(today|market|france|germany|uk|nhs)/i, /describe.*adoption/i],
  q2: [/barrier/i, /holding .{0,40}back/i, /holding adoption/i],
  q3: [/\broi\b/i, /economic/i, /pay for itself/i, /procurement focus/i],
  q4: [/training/i, /utilisation|utilization/i],
  q5: [/three to five|3.?5 year|outlook|accelerate/i, /expect.*adoption/i],
  q6: [/timeline/i, /decision.?making|how long.*decid/i, /purchase timeline/i],
};

function bestGuideQuestion(
  question: string,
  questions: InterviewQuestion[],
): InterviewQuestion | null {
  const qNorm = normalizeQuestion(question);
  let best: { q: InterviewQuestion; score: number } | null = null;
  for (const g of questions) {
    const score = tokenOverlapScore(qNorm, normalizeQuestion(g.text));
    if (!best || score > best.score) best = { q: g, score };
  }
  return best && best.score >= 0.45 ? best.q : null;
}

/** Match user ask to interviewer questions, then take the expert reply that follows. */
export function findInterviewFollowUps(
  utterances: Utterance[],
  question: string,
): { score: number; answer: Utterance }[] {
  const qNorm = normalizeQuestion(question);
  if (!qNorm) return [];

  const data = loadCaseData();
  const guide = bestGuideQuestion(question, data.questions);
  const guideNorm = guide ? normalizeQuestion(guide.text) : "";
  const hints = guide ? GUIDE_INTERVIEWER_HINTS[guide.id] ?? [] : [];

  const pairs: { score: number; answer: Utterance }[] = [];

  for (let i = 0; i < utterances.length; i++) {
    const turn = utterances[i];
    if (turn.isExpert) continue;

    const iNorm = normalizeQuestion(turn.text);
    let score = Math.max(
      tokenOverlapScore(qNorm, iNorm),
      guideNorm ? tokenOverlapScore(guideNorm, iNorm) : 0,
    );

    // Transcript wording often differs from the guide (e.g. France barriers).
    if (hints.some((re) => re.test(turn.text))) {
      score = Math.max(score, 0.9);
    }

    if (score < 0.55) continue;

    const next = utterances[i + 1];
    if (!next || !next.isExpert || next.expertId !== turn.expertId) continue;
    pairs.push({ score, answer: next });
  }

  pairs.sort((a, b) => b.score - a.score || a.answer.seconds - b.answer.seconds);
  return pairs;
}

function pickTopPerExpert(evidence: Utterance[]): Utterance[] {
  const seen = new Set<string>();
  const top: Utterance[] = [];
  for (const u of evidence) {
    if (seen.has(u.expertId)) continue;
    seen.add(u.expertId);
    top.push(u);
    if (top.length >= 3) break;
  }
  return top;
}

const ASK_EXPERT_ORDER: ExpertId[] = ["france", "germany", "uk"];

/**
 * Prefer transcript Q→A pairs: show each expert's verbatim reply (up to 3),
 * never a blended paraphrase.
 */
function answerFromQaPairs(
  _question: string,
  pairs: { score: number; answer: Utterance }[],
): AskResponse | null {
  if (pairs.length === 0) return null;

  // Keep only solid matches, then one reply per expert (France / Germany / UK).
  const strong = pairs.filter((p) => p.score >= 0.75);
  const pool = strong.length ? strong : [];
  if (pool.length === 0) return null;
  const byExpert = pickTopPerExpert(
    ASK_EXPERT_ORDER.flatMap((id) =>
      pool.filter((p) => p.answer.expertId === id).map((p) => p.answer),
    ),
  );

  if (byExpert.length === 0) return null;

  const citations = byExpert.map((u) => citationFromUtterance(u));
  const answer = byExpert
    .map((u) => {
      const meta = getExpertMeta(u.expertId)!;
      return `${meta.market} (${meta.expertName}) · ${u.timestamp}\n${u.text}`;
    })
    .join("\n\n");

  return {
    answer,
    citations,
    evidenceFound: true,
    usedMode: "extractive",
  };
}

function groundedFallbackAsk(question: string, evidence: Utterance[]): AskResponse {
  const top = pickTopPerExpert(
    ASK_EXPERT_ORDER.flatMap((id) => evidence.filter((u) => u.expertId === id)),
  );
  if (top.length === 0) {
    return {
      answer: "No supporting evidence found across the transcripts.",
      citations: [],
      evidenceFound: false,
      usedMode: "extractive",
    };
  }

  const citations = top.map((u) => citationFromUtterance(u));
  const answer = top
    .map((u) => {
      const meta = getExpertMeta(u.expertId)!;
      return `${meta.market} (${meta.expertName}) · ${u.timestamp}\n${u.text}`;
    })
    .join("\n\n");

  return {
    answer,
    citations,
    evidenceFound: true,
    usedMode: "extractive",
  };
}

/**
 * Ask: first resolve interviewer Q → expert A pairs; otherwise retrieve.
 * Answer text is the transcript expert reply, not an LLM blend.
 * If the question is gibberish or evidence is weak, say so — never force a match.
 */
export async function askAcrossTranscripts(
  question: string,
): Promise<AskResponse> {
  const data = loadCaseData();
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      answer: "Please enter a question.",
      citations: [],
      evidenceFound: false,
      usedMode: "extractive",
    };
  }

  if (!hasSearchableQuestion(trimmed)) {
    return {
      answer:
        "No supporting evidence found across the transcripts. Try a clearer question about the calls.",
      citations: [],
      evidenceFound: false,
      usedMode: "extractive",
    };
  }

  // 1) Prefer exact/near-exact interviewer question → following expert answer
  const qaPairs = findInterviewFollowUps(data.utterances, trimmed);
  const qaAnswer = answerFromQaPairs(trimmed, qaPairs);
  if (qaAnswer) return qaAnswer;

  // 2) Hybrid lexical + semantic retrieval
  const retrieved = await retrieveRelevantHybrid(data.utterances, trimmed, {
    topK: 12,
    expertOnly: true,
    minScore: 0.28,
  });
  const evidence = pickTopPerExpert(retrieved);
  if (evidence.length === 0) {
    return {
      answer: "No supporting evidence found across the transcripts.",
      citations: [],
      evidenceFound: false,
      usedMode: "extractive",
    };
  }

  return groundedFallbackAsk(trimmed, evidence);
}

export function getCaseOverview() {
  return loadCaseData();
}
