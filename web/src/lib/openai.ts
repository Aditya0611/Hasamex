import OpenAI from "openai";

/**
 * Groq exposes an OpenAI-compatible chat API.
 * Docs: https://console.groq.com/docs/openai
 */
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-20b";

export function hasLlmKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function getLlmClient(): OpenAI {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw new Error("GROQ_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: key,
    baseURL: GROQ_BASE_URL,
  });
}

export const MODEL = process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;

/** @deprecated use hasLlmKey */
export const hasOpenAIKey = hasLlmKey;
/** @deprecated use getLlmClient */
export const getOpenAI = getLlmClient;
