import type { Citation, CrossAnalysis, ExpertId } from "@/lib/types";
import { getExpertMeta } from "@/lib/load";

const EXPERT_ORDER: ExpertId[] = ["france", "germany", "uk"];

/** Map quote words → readable theme buckets (still only from retrieved text). */
const THEME_GROUPS: { id: string; label: string; terms: string[] }[] = [
  {
    id: "money",
    label: "funding / cost / budget",
    terms: [
      "capital",
      "budget",
      "budgets",
      "cost",
      "costs",
      "funding",
      "finance",
      "financial",
      "economic",
      "economics",
      "roi",
      "pay",
    ],
  },
  {
    id: "training",
    label: "training / staffing capacity",
    terms: ["training", "surgeon", "surgeons", "staff", "theatre", "capacity"],
  },
  {
    id: "utilisation",
    label: "utilisation / procedure volume",
    terms: ["utilisation", "utilization", "volume", "used", "enough"],
  },
  {
    id: "approval",
    label: "purchase approval / procurement",
    terms: ["approval", "approving", "procurement", "committee", "committees", "purchasing"],
  },
  {
    id: "clinical",
    label: "clinical outcomes",
    terms: ["clinical", "outcome", "outcomes"],
  },
  {
    id: "timeline",
    label: "decision timeline",
    terms: ["timeline", "months", "year", "years"],
  },
];

/**
 * Derive clear agree / differ points ONLY from retrieved citations.
 * Full quotes stay in the Ask citations list above — this block is a short comparison.
 */
export function deriveCrossFromCitations(
  citations: Citation[],
  _question: string,
): CrossAnalysis | null {
  const byExpert = new Map<ExpertId, Citation>();
  for (const c of citations) {
    if (!byExpert.has(c.expertId)) byExpert.set(c.expertId, c);
  }

  const ordered = EXPERT_ORDER.map((id) => byExpert.get(id)).filter(
    (c): c is Citation => Boolean(c),
  );
  if (ordered.length < 2) return null;

  const perExpert = ordered.map((c) => ({
    citation: c,
    groups: groupsInQuote(c.quote),
  }));

  const shared = sharedGroupLabels(perExpert);
  const agreeLines =
    shared.length > 0
      ? shared.map((label) => `• ${label}`)
      : [
          `• ${ordered.length} experts have transcript evidence on this question (see quotes above)`,
        ];

  return {
    themes: [
      {
        theme: "What they agree on",
        summary: agreeLines.join("\n"),
        supportingExperts: ordered.map((c) => c.expertId),
        citations: [],
      },
    ],
    disagreements: [
      {
        topic: "Where they differ",
        summary: "Each line is grounded in that expert’s retrieved quote above.",
        positions: perExpert.map(({ citation, groups }) => {
          const meta = getExpertMeta(citation.expertId)!;
          const others = new Set(
            perExpert
              .filter((p) => p.citation.expertId !== citation.expertId)
              .flatMap((p) => p.groups.map((g) => g.id)),
          );
          const distinctive = groups.filter((g) => !others.has(g.id));
          const focus =
            distinctive.length > 0
              ? distinctive.map((g) => g.label).slice(0, 2)
              : groups.map((g) => g.label).slice(0, 2);

          const focusText =
            focus.length > 0
              ? `stresses ${focus.join("; ")}`
              : firstClause(citation.quote, 90);

          return {
            expertId: citation.expertId,
            expertName: meta.expertName,
            market: meta.market,
            stance: `${citation.timestamp} — ${focusText}. “${firstClause(citation.quote, 100)}”`,
            citations: [citation],
          };
        }),
      },
    ],
  };
}

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9%\-\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function groupsInQuote(quote: string): { id: string; label: string }[] {
  const words = normalizeWords(quote);
  return THEME_GROUPS.filter((g) => g.terms.some((t) => words.has(t))).map(
    (g) => ({ id: g.id, label: g.label }),
  );
}

function sharedGroupLabels(
  perExpert: { citation: Citation; groups: { id: string; label: string }[] }[],
): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const row of perExpert) {
    for (const g of row.groups) {
      const prev = counts.get(g.id);
      if (prev) prev.n += 1;
      else counts.set(g.id, { label: g.label, n: 1 });
    }
  }
  return [...counts.values()]
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((x) => x.label);
}

function firstClause(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const cut = clean.split(/(?<=[.!;])\s+/)[0] || clean;
  if (cut.length <= max) return cut;
  return `${cut.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
