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

type Tab = "guide" | "ask" | "transcripts";

const EXPERT_ORDER: ExpertId[] = ["france", "germany", "uk"];

export function AppShell() {
  const [tab, setTab] = useState<Tab>("ask");
  const [caseData, setCaseData] = useState<CasePayload | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisBundle | null>(null);
  const [loadingCase, setLoadingCase] = useState(true);
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

  async function runAsk(question?: string) {
    const q = (question ?? askInput).trim();
    if (!q) return;
    if (question) setAskInput(question);
    setAsking(true);
    setError(null);
    setAskResult(null);
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
        </aside>
      </header>

      <nav className="tabs" aria-label="Primary">
        {(
          [
            ["ask", "Ask across calls"],
            ["guide", "Interview guide"],
            ["transcripts", "Transcripts"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "tab active" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === "ask" ? (
          <section className="panel ask-panel">
            <h3>Ask across all transcripts</h3>
            <p className="muted">
              Ask any question in one box. The agent retrieves transcript quotes first,
              then shows what experts share or where they differ — only from those quotes.
            </p>
            <textarea
              value={askInput}
              onChange={(e) => {
                setAskInput(e.target.value);
                setAskResult(null);
              }}
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
              <p className="muted">Retrieving transcript evidence…</p>
            ) : null}
            {askResult ? (
              <article className="answer-block">
                <h4>Transcript evidence</h4>
                <p className="muted">{askResult.answer}</p>
                {askResult.citations.length > 0 ? (
                  <CitationList
                    citations={askResult.citations}
                    onJump={jumpToCitation}
                  />
                ) : null}
                {askResult.crossAnalysis ? (
                  <div className="stack-gap" style={{ marginTop: "1.25rem" }}>
                    <h4>What they agree on</h4>
                    <p className="muted">
                      Shared themes found in the retrieved quotes (not invented).
                    </p>
                    {askResult.crossAnalysis.themes.map((theme) => (
                      <p
                        key={theme.theme}
                        className="answer-text"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {theme.summary}
                      </p>
                    ))}
                    <h4>Where they differ</h4>
                    <p className="muted">
                      Each point is from that expert’s own quote above.
                    </p>
                    <ul className="stance-list">
                      {askResult.crossAnalysis.disagreements.flatMap((d) =>
                        d.positions.map((p) => {
                          const cite = p.citations[0];
                          return (
                            <li key={`${d.topic}-${p.expertId}`}>
                              <strong>{p.market}</strong>
                              {cite ? (
                                <>
                                  {" "}
                                  <button
                                    type="button"
                                    className="chip"
                                    style={{
                                      display: "inline",
                                      padding: "0.1rem 0.45rem",
                                      fontSize: "0.8rem",
                                    }}
                                    onClick={() => jumpToCitation(cite)}
                                  >
                                    {cite.timestamp}
                                  </button>
                                </>
                              ) : null}
                              {": "}
                              {p.stance.replace(/^\d{1,2}:\d{2}\s*—\s*/, "")}
                            </li>
                          );
                        }),
                      )}
                    </ul>
                    <p className="muted">
                      Full quotes are listed once under Transcript evidence. Click a
                      timestamp to jump into the call.
                    </p>
                  </div>
                ) : askResult.evidenceFound ? (
                  <p className="muted" style={{ marginTop: "1rem" }}>
                    Need quotes from at least two experts to compare agree / differ.
                  </p>
                ) : null}
              </article>
            ) : null}
          </section>
        ) : null}

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
