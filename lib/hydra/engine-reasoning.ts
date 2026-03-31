import { callModel } from "./openrouter";
import { MODELS } from "./models";
import type OpenAI from "openai";

const STRATEGIES = {
  cot: "Think through this step-by-step, showing your reasoning at each stage.",
  tot: "Consider 3 different approaches. Evaluate each, then select the best one.",
  adversarial: "First identify the most obvious answer. Then find flaws in it. Finally give the most defensible answer.",
};

const SYNTHESIS_PROMPT = `You are a synthesis expert. You've been given multiple expert responses to the same question.

Your job:
1. Identify the strongest points from each response
2. Identify and correct any errors or contradictions
3. Produce a single, authoritative answer that combines the best insights
4. Be thorough but concise — don't pad with filler

Do NOT mention that you're synthesizing multiple responses. Just give the best possible answer as if you're a single expert.`;

export async function executeReasoning(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  const userMessage = messages[messages.length - 1].content as string;
  const conversationContext = messages.slice(0, -1);

  const [proposalA, proposalB, proposalC] = await Promise.allSettled([
    callModel(
      MODELS.reasonerA.id,
      [...conversationContext, { role: "user", content: `${STRATEGIES.cot}\n\n${userMessage}` }],
      { maxTokens: 4096, temperature: 0.6 }
    ),
    callModel(
      MODELS.reasonerB.id,
      [...conversationContext, { role: "user", content: `${STRATEGIES.tot}\n\n${userMessage}` }],
      { maxTokens: 4096, temperature: 0.7 }
    ),
    callModel(
      MODELS.generalist.id,
      [...conversationContext, { role: "user", content: `${STRATEGIES.adversarial}\n\n${userMessage}` }],
      { maxTokens: 4096, temperature: 0.5 }
    ),
  ]);

  const proposals: string[] = [];
  if (proposalA.status === "fulfilled") proposals.push(proposalA.value);
  if (proposalB.status === "fulfilled") proposals.push(proposalB.value);
  if (proposalC.status === "fulfilled") proposals.push(proposalC.value);

  if (proposals.length === 0) {
    return callModel(MODELS.fallback.id, messages, { maxTokens: 4096 });
  }

  if (proposals.length === 1) {
    return proposals[0];
  }

  const synthesisInput = proposals
    .map((p, i) => `--- Expert ${i + 1} ---\n${p}`)
    .join("\n\n");

  return callModel(
    MODELS.fast.id,
    [
      { role: "system", content: SYNTHESIS_PROMPT },
      {
        role: "user",
        content: `Question: ${userMessage}\n\n${synthesisInput}\n\nSynthesize the best possible answer.`,
      },
    ],
    { maxTokens: 6144, temperature: 0.3 }
  );
}
