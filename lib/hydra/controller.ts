import { callModel } from "./openrouter";
import { MODELS } from "./models";

export type Topology = "fast" | "reasoning" | "code" | "creative" | "full";

export interface ExecutionPlan {
  topology: Topology;
  complexity: number;
  reasoning: string;
}

const CLASSIFIER_PROMPT = `You are the Hydra query classifier. Analyze the user's message and output ONLY valid JSON with no markdown fences.

Decide:
- "complexity": 0.0 to 1.0 (how hard is this query?)
- "topology": one of "fast", "reasoning", "code", "creative", "full"
- "reasoning": one sentence explaining why

Rules:
- "fast" (complexity < 0.3): Simple factual questions, greetings, definitions, short answers
- "code" (any complexity): Anything involving writing, debugging, reviewing, or explaining code
- "creative" (any complexity): Creative writing, storytelling, brainstorming, marketing copy
- "reasoning" (complexity 0.3-0.7): Analysis, math, logic, comparisons, explanations
- "full" (complexity > 0.7): PhD-level questions, multi-step reasoning, ambiguous hard problems

Output format: {"topology":"...","complexity":0.X,"reasoning":"..."}`;

export async function classifyQuery(userMessage: string): Promise<ExecutionPlan> {
  try {
    const result = await callModel(
      MODELS.fast.id,
      [
        { role: "system", content: CLASSIFIER_PROMPT },
        { role: "user", content: userMessage },
      ],
      { maxTokens: 150, temperature: 0.1 }
    );

    // Strip markdown fences if present
    const cleaned = result.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      topology: parsed.topology || "fast",
      complexity: parsed.complexity || 0.5,
      reasoning: parsed.reasoning || "",
    };
  } catch {
    return { topology: "reasoning", complexity: 0.5, reasoning: "Classification failed, defaulting to reasoning" };
  }
}
