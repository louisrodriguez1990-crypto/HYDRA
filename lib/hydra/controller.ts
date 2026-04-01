import { call, parseJSON } from "./openrouter";
import { MODELS } from "./models";
import type { Plan, Rigor, Topology } from "./types";

export function normalizeRigor(input: unknown): Rigor {
  return input === "rigorous" ? "rigorous" : "balanced";
}

export function quickClassify(msg: string, rigor: Rigor = "balanced"): Topology | null {
  const m = msg.toLowerCase().trim();
  if (m.length < 30 && !m.includes("?") && rigor === "balanced") return "fast";
  if (/^(hi|hello|hey|thanks|ok|cool|got it|sure)\b/i.test(m)) return "fast";
  if (/```|def |function |const |import |class |\.(py|js|ts|tsx|rs|go)\b/.test(msg)) return "think";
  if (/\b(novel|new approach|no one|nobody|first principles|unconventional|outside the box|rethink|reimagine|invent|breakthrough|paradigm|innovative|what if we)\b/i.test(m)) return "discover";
  return null;
}

const CLASSIFY_PROMPT = `Classify this query. Output ONLY JSON, no fences.
- "fast": simple factual, greetings, short answers
- "think": analysis, reasoning, code, math, explanations, comparisons, hard questions
- "discover": novel solutions, new approaches, creative problem-solving, first-principles rethinking, "how might we" questions
Rigor is a separate control. Do not use it to change topology.
Output: {"topology":"fast|think|discover","complexity":0.X}`;

export async function classify(msg: string, rigor: Rigor = "balanced"): Promise<Plan> {
  const quick = quickClassify(msg, rigor);
  if (quick) {
    return {
      topology: quick,
      complexity: quick === "fast" ? 0.1 : rigor === "rigorous" ? 0.7 : 0.6,
    };
  }

  const res = await call(
    MODELS.fast.id,
    [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: `Rigor: ${rigor}\n\nQuery:\n${msg}` },
    ],
    { maxTokens: 60, temperature: 0.1, timeoutMs: 2500 }
  );

  return parseJSON<Plan>(res, {
    topology: "think",
    complexity: rigor === "rigorous" ? 0.6 : 0.5,
  });
}
