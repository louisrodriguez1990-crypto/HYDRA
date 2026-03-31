import { call, parseJSON } from "./openrouter";
import { MODELS } from "./models";

export type Topology = "fast" | "think" | "discover";

export interface Plan {
  topology: Topology;
  complexity: number;
}

export function quickClassify(msg: string): Topology | null {
  const m = msg.toLowerCase().trim();
  if (m.length < 30 && !m.includes("?")) return "fast";
  if (/^(hi|hello|hey|thanks|ok|cool|got it|sure)\b/i.test(m)) return "fast";
  if (/```|def |function |const |import |class |\.(py|js|ts|tsx|rs|go)\b/.test(msg)) return "think";
  if (/\b(novel|new approach|no one|nobody|first principles|unconventional|outside the box|rethink|reimagine|invent|breakthrough|paradigm|innovative|what if we)\b/i.test(m)) return "discover";
  return null;
}

const CLASSIFY_PROMPT = `Classify this query. Output ONLY JSON, no fences.
- "fast": simple factual, greetings, short answers
- "think": analysis, reasoning, code, math, explanations, comparisons, hard questions
- "discover": novel solutions, new approaches, creative problem-solving, first-principles rethinking, "how might we" questions
Output: {"topology":"fast|think|discover","complexity":0.X}`;

export async function classify(msg: string): Promise<Plan> {
  const quick = quickClassify(msg);
  if (quick) return { topology: quick, complexity: quick === "fast" ? 0.1 : 0.6 };

  const res = await call(
    MODELS.fast.id,
    [{ role: "system", content: CLASSIFY_PROMPT }, { role: "user", content: msg }],
    { maxTokens: 60, temperature: 0.1 }
  );

  return parseJSON<Plan>(res, { topology: "think", complexity: 0.5 });
}
