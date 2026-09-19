import type { ExpertId, InterviewQuestion, TranscriptMeta, Utterance } from "./types";

export const TRANSCRIPT_META: TranscriptMeta[] = [
  {
    id: "france",
    filename: "Transcript_1_France.txt",
    expertName: "Dr. Jean Martin",
    role: "Head of Urology",
    market: "France",
  },
  {
    id: "germany",
    filename: "Transcript_2_Germany.txt",
    expertName: "Anna Keller",
    role: "Former Hospital Procurement Director",
    market: "Germany",
  },
  {
    id: "uk",
    filename: "Transcript_3_UK.txt",
    expertName: "Dr. Emily Carter",
    role: "Consultant Urologist",
    market: "United Kingdom",
  },
];

const EXPERT_SPEAKER_HINTS: Record<ExpertId, string[]> = {
  france: ["dr. martin", "dr martin", "martin"],
  germany: ["anna keller", "keller", "anna"],
  uk: ["dr. carter", "dr carter", "carter"],
};

export function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.trim().split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function isExpertSpeaker(speaker: string, expertId: ExpertId): boolean {
  const normalized = speaker.toLowerCase();
  if (normalized.includes("interviewer")) return false;
  return EXPERT_SPEAKER_HINTS[expertId].some((hint) => normalized.includes(hint));
}

/**
 * Parse a timestamped transcript into atomic utterances.
 * Expected format blocks:
 *   MM:SS
 *   Speaker: text
 */
export function parseTranscript(raw: string, meta: TranscriptMeta): Utterance[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const utterances: Utterance[] = [];
  let currentTimestamp: string | null = null;
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line)) {
      currentTimestamp = line;
      continue;
    }

    const speakerMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (speakerMatch && currentTimestamp) {
      const speaker = speakerMatch[1].trim();
      let text = speakerMatch[2].trim();

      // Capture continuation lines until next timestamp or blank+timestamp pattern
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextTrim = next.trim();
        if (!nextTrim) break;
        if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(nextTrim)) break;
        if (/^[^:]+:\s*/.test(nextTrim)) break;
        text = `${text} ${nextTrim}`.trim();
        i += 1;
      }

      if (!text) continue;

      utterances.push({
        id: `${meta.id}-${index}`,
        expertId: meta.id,
        timestamp: currentTimestamp,
        seconds: timestampToSeconds(currentTimestamp),
        speaker,
        text,
        isExpert: isExpertSpeaker(speaker, meta.id),
      });
      index += 1;
    }
  }

  return utterances;
}

export function parseInterviewGuide(raw: string): InterviewQuestion[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const questions: InterviewQuestion[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\.\s+(.+)$/);
    if (!match) continue;
    questions.push({
      id: `q${match[1]}`,
      number: Number(match[1]),
      text: match[2].trim(),
    });
  }

  return questions;
}
