# CallBrief — Hasamex AI Engineer Technical Case

Grounded analysis app for three European robotic-surgery expert-call transcripts.

## What it does

1. Loads the 3 case-pack transcripts + interview guide
2. Answers each interview-guide question **per expert**
3. Extracts **exact quotes** with **timestamps**
4. Surfaces **common themes** and **disagreements**
5. Lets you **ask questions across all transcripts**

## Design principles

- **Do not invent information** — answers are grounded in retrieved utterances
- **Citations are verified** — model quotes must match source text or they are dropped
- **Ask uses an agent** — Vercel AI SDK + Groq tool-calling over grounded transcript tools
- **Extractive fallback** — if Groq is unavailable, still return transcript-bound answers
- **Simple UI** — guide answers, themes, ask, and transcript browser with jump-to-citation

## Architecture

```
case-pack transcripts
        │
        ▼
   parse → timestamped utterances
        │
        ▼
  Ask agent (Vercel AI SDK + Groq)
   tools: get_qa_pair / search / verify / grounded_ask
        │
        ▼
   citation-backed answer in UI
```

Guide/themes analysis still uses retrieve → (optional Groq) → verify.

### Scaling notes (3 → 30+ calls)

- Keep utterance parsing + embeddings/BM25 index per transcript
- Store per-call guided answers as structured records
- Run cross-call theme/disagreement synthesis over summaries + citation pointers
- Add evals that check citation span membership and answer entailment

## Quick start

```bash
cd web
npm install
cp .env.example .env.local
# optional: set GROQ_API_KEY in .env.local (https://console.groq.com)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Modes

| Mode | When | Behavior |
|------|------|----------|
| `extractive` | No `GROQ_API_KEY` | Top matching expert quotes returned as answers |
| `llm` | Key present | Concise synthesis via Groq + verified citations (`GROQ_MODEL`, default `openai/gpt-oss-20b`) |

### Why Groq

- OpenAI-compatible API (same client code path)
- Fast inference, suitable for a live demo
- Free tier available for case-study usage

## Case pack

Located in `case-pack/`:

- `README_CASE.md`
- `Interview_Guide.txt`
- `Transcript_1_France.txt`
- `Transcript_2_Germany.txt`
- `Transcript_3_UK.txt`

## Demo talking points

- Architecture: parse → retrieve → generate → verify
- Model choice: Groq (`openai/gpt-oss-20b`) for fast grounded JSON synthesis
- Hallucination control: retrieval grounding + quote verification + refuse when no evidence
- Product: analyst can jump from answer → citation → transcript locus

## Scripts

```bash
npm run dev
npm run build
npm run start
```
