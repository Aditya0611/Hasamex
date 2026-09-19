import fs from "fs";
import path from "path";
import { parseInterviewGuide, parseTranscript, TRANSCRIPT_META } from "./parse";
import type { InterviewQuestion, TranscriptMeta, Utterance } from "./types";

export type CaseData = {
  questions: InterviewQuestion[];
  transcripts: TranscriptMeta[];
  utterances: Utterance[];
  rawByExpert: Record<string, string>;
};

function casePackRoot(): string {
  return path.join(process.cwd(), "case-pack");
}

export function loadCaseData(): CaseData {
  const root = casePackRoot();
  const guideRaw = fs.readFileSync(path.join(root, "Interview_Guide.txt"), "utf8");
  const questions = parseInterviewGuide(guideRaw);

  const utterances: Utterance[] = [];
  const rawByExpert: Record<string, string> = {};

  for (const meta of TRANSCRIPT_META) {
    const raw = fs.readFileSync(path.join(root, meta.filename), "utf8");
    rawByExpert[meta.id] = raw;
    utterances.push(...parseTranscript(raw, meta));
  }

  return {
    questions,
    transcripts: TRANSCRIPT_META,
    utterances,
    rawByExpert,
  };
}

export function getExpertMeta(expertId: string): TranscriptMeta | undefined {
  return TRANSCRIPT_META.find((t) => t.id === expertId);
}
