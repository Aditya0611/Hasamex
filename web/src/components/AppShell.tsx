"use client";

import { useEffect, useMemo, useState } from "react";
import { CitationList } from "@/components/CitationList";
import type {
  AnalysisBundle,
  AskResponse,
  Citation,
  ExpertId,
  InterviewQuestion,
  TranscriptMeta,
  Utterance,
} from "@/lib/types";

type CasePayload = {
  questions: InterviewQuestion[];
  transcripts: TranscriptMeta[];
  utterances: Utterance[];
};

type Tab = "guide" | "themes" | "ask" | "transcripts";

const EXPERT_ORDER: ExpertId[] = ["france", "germany", "uk"];

export function AppShell() {
  const [tab, setTab] = useState<Tab>("guide");
  const [caseData, setCaseData] = useState<CasePayload | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisBundle | null>(null);
  const [loadingCase, setLoadingCase] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpert, setSelectedExpert] = useState<ExpertId>("france");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>("q1");
  const [activeUtteranceId, setActiveUtteranceId] = useState<string | null>(null);
  const [askInput, setAskInput] = useState(
    "What are the main barriers to adoption?",
  );
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [caseRes, analysisRes] = await Promise.all([
          fetch("/api/case"),
          fetch("/api/analyze", { method: "POST" }),
        ]);
        const caseJson = (await caseRes.json()) as CasePayload;
        const analysisJson = await analysisRes.json();

        if (cancelled) return;
        setCaseData(caseJson);
        setSelectedQuestionId(caseJson.questions[0]?.id ?? "q1");
        if (analysisRes.ok && analysisJson.guideAnswers?.length) {
          setAnalysis(analysisJson as AnalysisBundle);
        }
      } catch {
        if (!cancelled) setError("Failed to load case pack.");
      } finally {
        if (!cancelled) setLoadingCase(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAnswer = useMemo(() => {
    if (!analysis) return null;
    return (
      analysis.guideAnswers.find(
        (a) => a.questionId === selectedQuestionId && a.expertId === selectedExpert,
      ) ?? null
    );
  }, [analysis, selectedExpert, selectedQuestionId]);

  const transcriptUtterances = useMemo(() => {
    if (!caseData) return [];
    return caseData.utterances.filter((u) => u.expertId === selectedExpert);
  }, [caseData, selectedExpert]);

  async function runAnalysis(force = false) {
    // Instant seed/cache reload should never lock the UI
    if (!force) {
      setError(null);
      try {
        const res = await fetch("/api/analyze", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        setAnalysis(data as AnalysisBundle);
        setTab("guide");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      }
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze?force=1", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysis(data as AnalysisBundle);
      setTab("guide");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function runAsk() {
    const q = askInput.trim();
    if (!q) return;
    setAsking(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ask failed");
      setAskResult(data as AskResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  function openTab(next: Tab) {
    setTab(next);
    if (next === "ask" && !askResult && !asking) {
      void runAsk();
    }
  }

  function jumpToCitation(citation: Citation) {
    setSelectedExpert(citation.expertId);
    setActiveUtteranceId(citation.utteranceId);
    setTab("transcripts");
    requestAnimationFrame(() => {
      const el = document.getElementById(`utt-${citation.utteranceId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  if (loadingCase) {
    return (
      <div className="boot">
        <p>Loading case pack…</p>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="boot">
        <p>{error || "Case pack unavailable."}</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Hasamex technical case</p>
          <h1>CallBrief</h1>
          <p className="lede">
            Analyse 3 expert calls: guide answers, quotes with timestamps, themes, and
            ask-across-transcripts.
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => runAnalysis(false)}
              disabled={analyzing}
            >
              {analysis ? "Results ready" : "Load results"}
            </button>
            {analysis ? (
              <span className="mode-pill">ready</span>
            ) : (
              <span className="mode-pill soft">Loading analysis…</span>
            )}
          </div>
          {error ? <p className="error">{error}</p> : null}
        </div>
        <aside className="hero-panel" aria-label="Case overview">
          <h2>Case pack</h2>
          <ul>
            {caseData.transcripts.map((t) => (
              <li key={t.id}>
                <strong>{t.market}</strong>
                <span>
                  {t.expertName} · {t.role}
                </span>
              </li>
            ))}
          </ul>
          <p className="panel-note">
            {caseData.questions.length} interview questions ·{" "}
            {caseData.utterances.length} timestamped utterances
          </p>
        </aside>
      </header>

      <nav className="tabs" aria-label="Primary">
        {(
          [
            ["guide", "Interview guide"],
            ["themes", "Themes & disagreements"],
            ["ask", "Ask across calls"],
            ["transcripts", "Transcripts"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "tab active" : "tab"}
            onClick={() => openTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === "guide" ? (
          <section className="panel">
            {!analysis ? (
              <EmptyState text="Loading interview-guide answers…" />
            ) : (
              <div className="guide-layout">
                <div className="side-list">
                  <h3>Questions</h3>
                  {caseData.questions.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      className={
                        selectedQuestionId === q.id ? "side-item active" : "side-item"
                      }
                      onClick={() => setSelectedQuestionId(q.id)}
                    >
                      <span className="num">{q.number}</span>
                      <span>{q.text}</span>
                    </button>
                  ))}
                </div>
                <div className="guide-content">
                  <div className="expert-switch">
                    {EXPERT_ORDER.map((id) => {
                      const meta = caseData.transcripts.find((t) => t.id === id)!;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={selectedExpert === id ? "chip active" : "chip"}
                          onClick={() => setSelectedExpert(id)}
                        >
                          {meta.market}
                        </button>
                      );
                    })}
                  </div>
                  {selectedAnswer ? (
                    <article className="answer-block">
                      <h3>
                        {selectedAnswer.expertName} · {selectedAnswer.market}
                      </h3>
                      <p className="answer-text">{selectedAnswer.answer}</p>
                      <h4>Supporting quotes</h4>
                      <CitationList
                        citations={selectedAnswer.citations}
                        onJump={jumpToCitation}
                      />
                    </article>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {tab === "themes" ? (
          <section className="panel stack-gap">
            {!analysis ? (
              <EmptyState text="Loading themes…" />
            ) : (
              <>
                <p className="muted">What experts share, and where they differ.</p>
                <div>
                  <h3>Common themes</h3>
                  <div className="simple-list">
                    {analysis.crossAnalysis.themes.map((theme) => (
                      <article key={theme.theme} className="simple-item">
                        <h4>{theme.theme}</h4>
                        <p>{theme.summary}</p>
                        <CitationList
                          citations={theme.citations.slice(0, 2)}
                          onJump={jumpToCitation}
                        />
                      </article>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>Disagreements</h3>
                  <div className="simple-list">
                    {analysis.crossAnalysis.disagreements.map((d) => (
                      <article key={d.topic} className="simple-item">
                        <h4>{d.topic}</h4>
                        <p>{d.summary}</p>
                        <ul className="stance-list">
                          {d.positions.map((p) => (
                            <li key={`${d.topic}-${p.expertId}`}>
                              <strong>{p.market}:</strong> {trimText(p.stance, 120)}
                            </li>
                          ))}
                        </ul>
                        <CitationList
                          citations={d.positions.flatMap((p) => p.citations).slice(0, 3)}
                          onJump={jumpToCitation}
                        />
                      </article>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        ) : null}

        {tab === "ask" ? (
          <section className="panel ask-panel">
            <h3>Ask across all transcripts</h3>
            <p className="muted">
              Agent searches the 3 transcripts with tools, then shows exact quotes.
            </p>
            <textarea
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              rows={3}
              placeholder="Ask a question across France, Germany, and UK calls…"
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => void runAsk()}
              disabled={asking || !askInput.trim()}
            >
              {asking ? "Searching…" : "Ask"}
            </button>
            {asking && !askResult ? (
              <p className="muted">Searching transcripts…</p>
            ) : null}
            {askResult ? (
              <article className="answer-block">
                <p className="answer-text">{askResult.answer}</p>
                <h4>Citations</h4>
                <CitationList citations={askResult.citations} onJump={jumpToCitation} />
              </article>
            ) : null}
          </section>
        ) : null}

        {tab === "transcripts" ? (
          <section className="panel">
            <div className="expert-switch">
              {EXPERT_ORDER.map((id) => {
                const meta = caseData.transcripts.find((t) => t.id === id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    className={selectedExpert === id ? "chip active" : "chip"}
                    onClick={() => setSelectedExpert(id)}
                  >
                    {meta.market}
                  </button>
                );
              })}
            </div>
            <div className="transcript-stream">
              {transcriptUtterances.map((u) => (
                <article
                  key={u.id}
                  id={`utt-${u.id}`}
                  className={
                    activeUtteranceId === u.id
                      ? "utterance active"
                      : u.isExpert
                        ? "utterance expert"
                        : "utterance"
                  }
                >
                  <div className="utt-meta">
                    <span className="timestamp">{u.timestamp}</span>
                    <span className="speaker">{u.speaker}</span>
                  </div>
                  <p>{u.text}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

function trimText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
