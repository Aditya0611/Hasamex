# CallBrief — Hasamex AI Engineer Technical Case

Analyses **3 expert-call transcripts** (France, Germany, UK): interview-guide answers, exact quotes with timestamps, themes/disagreements, and ask-across-calls — **without inventing information**.

## Run locally

```bash
git clone https://github.com/Aditya0611/Hasamex.git
cd Hasamex/web
npm install
cp .env.example .env.local
# optional: GROQ_API_KEY from https://console.groq.com/keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## What it does

| Requirement | In the app |
|-------------|------------|
| Read 3 transcripts | `web/case-pack/` |
| Interview guide per expert | **Interview guide** tab |
| Exact quotes + timestamps | Citations (e.g. `01:20`) |
| Themes & disagreements | After Ask: compare retrieved quotes only |
| Ask across transcripts | **Ask across calls** tab |
| Traceable / no invention | RAG retrieve → verify; click quote → transcript |

## Stack & approach

- **Next.js** + **React** + TypeScript + Tailwind  
- **RAG:** parse → retrieve (keywords + embeddings) → answer from evidence → verify quotes  
- **Ask:** Vercel AI SDK + Groq tool-calling agent (extractive fallback without API key)  
- **Model:** Groq `openai/gpt-oss-20b`

## Scale (3 → 30+)

Same pipeline per call; store structured answers; synthesise themes over summaries + citation pointers; use Postgres + pgvector for multi-user / many transcripts.
