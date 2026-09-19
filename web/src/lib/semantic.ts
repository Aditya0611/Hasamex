import fs from "fs";
import path from "path";
import type { Utterance } from "./types";

type EmbeddingIndex = {
  model: string;
  fingerprint: string;
  vectors: Record<string, number[]>;
};

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const CACHE_FILE = path.join(process.cwd(), "src", "data", "utterance-embeddings.json");

let extractorPromise: Promise<
  (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array | number[] }>
> | null = null;

let memoryIndex: EmbeddingIndex | null = null;

function fingerprintUtterances(utterances: Utterance[]): string {
  return `${utterances.length}:${utterances.map((u) => u.id).join(",")}`;
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
      }) as Promise<
        (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{
          data: Float32Array | number[];
        }>
      >;
    })();
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const result = await extractor(text.slice(0, 1500), {
    pooling: "mean",
    normalize: true,
  });
  const data = result.data;
  return Array.from(data);
}

function readCache(): EmbeddingIndex | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as EmbeddingIndex;
  } catch {
    return null;
  }
}

function writeCache(index: EmbeddingIndex) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(index));
  } catch (error) {
    console.error("Failed to write embedding cache:", error);
  }
}

/** Build or load embedding vectors for utterances (expert lines preferred). */
export async function ensureUtteranceEmbeddings(
  utterances: Utterance[],
): Promise<EmbeddingIndex | null> {
  const fp = fingerprintUtterances(utterances);
  if (memoryIndex && memoryIndex.fingerprint === fp) return memoryIndex;

  const cached = readCache();
  if (cached && cached.fingerprint === fp && cached.model === MODEL_ID) {
    memoryIndex = cached;
    return cached;
  }

  try {
    const targets = utterances.filter((u) => u.isExpert);
    const vectors: Record<string, number[]> = {};
    // Batch in small groups to keep memory stable
    for (const u of targets) {
      vectors[u.id] = await embedText(`${u.speaker}: ${u.text}`);
    }
    const index: EmbeddingIndex = {
      model: MODEL_ID,
      fingerprint: fp,
      vectors,
    };
    memoryIndex = index;
    writeCache(index);
    return index;
  } catch (error) {
    console.error("Semantic embeddings unavailable, lexical only:", error);
    return null;
  }
}

export async function semanticScores(
  query: string,
  utterances: Utterance[],
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const index = await ensureUtteranceEmbeddings(utterances);
  if (!index) return scores;

  const qVec = await embedText(query);
  for (const u of utterances) {
    const vec = index.vectors[u.id];
    if (!vec) continue;
    scores.set(u.id, cosine(qVec, vec));
  }
  return scores;
}

export { cosine };
