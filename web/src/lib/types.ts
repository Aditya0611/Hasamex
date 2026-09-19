export type ExpertId = "france" | "germany" | "uk";

export type TranscriptMeta = {
  id: ExpertId;
  filename: string;
  expertName: string;
  role: string;
  market: string;
};

export type Utterance = {
  id: string;
  expertId: ExpertId;
  timestamp: string;
  seconds: number;
  speaker: string;
  text: string;
  isExpert: boolean;
};

export type InterviewQuestion = {
  id: string;
  number: number;
  text: string;
};

export type Citation = {
  expertId: ExpertId;
  expertName: string;
  market: string;
  timestamp: string;
  quote: string;
  utteranceId: string;
  verified: boolean;
};

export type GuidedAnswer = {
  questionId: string;
  question: string;
  expertId: ExpertId;
  expertName: string;
  market: string;
  answer: string;
  citations: Citation[];
  confidence: "high" | "medium" | "low";
  evidenceFound: boolean;
};

export type ThemePoint = {
  theme: string;
  summary: string;
  supportingExperts: ExpertId[];
  citations: Citation[];
};

export type Disagreement = {
  topic: string;
  summary: string;
  positions: {
    expertId: ExpertId;
    expertName: string;
    market: string;
    stance: string;
    citations: Citation[];
  }[];
};

export type CrossAnalysis = {
  themes: ThemePoint[];
  disagreements: Disagreement[];
};

export type AskResponse = {
  answer: string;
  citations: Citation[];
  evidenceFound: boolean;
  usedMode: "rag" | "extractive" | "agent";
};

export type AnalysisBundle = {
  generatedAt: string;
  mode: "llm" | "extractive";
  guideAnswers: GuidedAnswer[];
  crossAnalysis: CrossAnalysis;
};
