# CallBrief — Hasamex AI Engineer Technical Case

Simple app that analyses **3 expert-call transcripts** (France, Germany, UK) for a European robotic-surgery project.

Built for the Hasamex technical case: grounded answers, exact quotes, timestamps, themes, and ask-across-calls — **without inventing information**.

## Requirements covered

| Case requirement | How CallBrief handles it |
|------------------|--------------------------|
| Read the 3 transcripts | Loads files from `web/case-pack/` |
| Answer interview-guide questions per expert | **Interview guide** tab (France / Germany / UK) |
| Extract exact quotes | Supporting quotes under every answer |
| Show source timestamps | Each citation includes the transcript time (e.g. `00:18`) |
| Common themes & disagreements | **Themes & disagreements** tab |
| Ask across all transcripts | **Ask across calls** tab |
| Do not invent / stay traceable | RAG retrieve → generate → verify; click quote → jump to transcript line |

## Run locally

```bash
git clone https://github.com/Aditya0611/Hasamex.git
cd Hasamex/web
npm install
cp .env.example .env.local
# optional: set GROQ_API_KEY (https://console.groq.com/keys)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

| Mode | When | Behaviour |
|------|------|-----------|
| `extractive` | No `GROQ_API_KEY` | Best matching expert quotes only |
| `llm` / `agent` | Key present | Groq synthesis + verified citations; Ask uses a tool-calling agent |

## Architecture (short)

```text
case-pack transcripts
        │
        ▼
 PARSE → timestamped utterances
        │
        ▼
 RETRIEVE (RAG: keywords + embeddings)
        │
        ├── Guide + Themes  →  Groq  →  VERIFY quotes
        └── Ask             →  Vercel AI SDK agent + tools  →  VERIFY
                │
                ▼
              UI (answer → citation → transcript)
```

- **RAG:** retrieve relevant lines first, then generate, then verify.
- **Path A (guide / themes):** `/api/analyze` — retrieve → Groq JSON → verify.
- **Path B (Ask):** `/api/agent` — Vercel AI SDK + Groq tools (`get_qa_pair`, `search_transcripts`, `verify_citation`, `grounded_ask`).
- Both paths share the same parse / retrieve / verify layer.

## Model choice

- **Groq** — `openai/gpt-oss-20b` (override with `GROQ_MODEL`)
- Fast enough for a live demo; OpenAI-compatible API
- Without a key, the app still runs in extractive mode

## Citations & timestamps

Transcripts are split into utterances that keep **speaker + timestamp**. Citations store market, expert, timestamp, quote, and utterance id. Clicking a citation jumps to that line in **Transcripts**.

## Reducing hallucinations

1. Model only sees **retrieved** transcript text (RAG grounding)
2. Quotes must **match** source text or they are dropped
3. No / weak evidence → refuse or extractive quotes only (no invention)
4. Off-topic Ask queries (e.g. greetings) are refused

## Scaling 3 → 30+ transcripts

Keep the same RAG loop per call: parse → index → structured guide answers. Run cross-call themes over **summaries + citation pointers**, not full raw text every time. For multi-user / many files: object storage for uploads, **Postgres + pgvector** for chunks, embeddings, users, and answers. Add evals for citation span membership.

## Project layout

```text
Hasamex/
├── README.md                 ← this file (submission README)
└── web/                      ← Next.js app
    ├── case-pack/            ← 3 transcripts + interview guide
    ├── src/app/              ← UI + API routes
    ├── src/lib/              ← parse, retrieve, verify, analysis, agent
    └── README.md             ← extra architecture notes
```

## Demo talking points

- Architecture: parse → retrieve → generate → verify (RAG)
- Model: Groq for speed; extractive fallback without a key
- Citations: timestamps + jump-to-source
- Hallucinations: grounding + quote verification + refuse when no evidence
- Scale: per-call index, summary-level themes, Postgres + pgvector later

## Submit checklist

- [x] Working app (run instructions above)
- [x] Source repo: https://github.com/Aditya0611/Hasamex
- [x] Short README (this file)
