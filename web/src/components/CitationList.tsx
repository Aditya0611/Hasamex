"use client";

import type { Citation } from "@/lib/types";

export function CitationList({
  citations,
  onJump,
}: {
  citations: Citation[];
  onJump?: (citation: Citation) => void;
}) {
  if (!citations.length) {
    return <p className="muted text-sm">No verified citations.</p>;
  }

  return (
    <ul className="citation-list">
      {citations.map((c) => (
        <li key={`${c.utteranceId}-${c.timestamp}-${c.quote.slice(0, 24)}`}>
          <button
            type="button"
            className="citation-card"
            onClick={() => onJump?.(c)}
          >
            <div className="citation-meta">
              <span className="market-tag">{c.market}</span>
              <span className="timestamp">{c.timestamp}</span>
              {c.verified ? <span className="verified">verified</span> : null}
            </div>
            <p className="quote">“{c.quote}”</p>
            <p className="speaker">{c.expertName}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}
