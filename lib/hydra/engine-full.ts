import { callModel } from "./openrouter";
import { MODELS } from "./models";
import type OpenAI from "openai";

export async function executeFull(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  const userMessage = messages[messages.length - 1].content as string;
  const context = messages.slice(0, -1);

  const [propA, propB, propC, preemptiveCritique] = await Promise.allSettled([
    callModel(
      MODELS.reasonerA.id,
      [...context, { role: "user", content: `Think step-by-step:\n\n${userMessage}` }],
      { maxTokens: 6144, temperature: 0.5 }
    ),
    callModel(
      MODELS.reasonerB.id,
      [...context, { role: "user", content: `Consider multiple approaches and select the best:\n\n${userMessage}` }],
      { maxTokens: 6144, temperature: 0.6 }
    ),
    callModel(
      MODELS.generalist.id,
      [...context, { role: "user", content: `Challenge the obvious answer, then give the most defensible response:\n\n${userMessage}` }],
      { maxTokens: 6144, temperature: 0.5 }
    ),
    callModel(
      MODELS.critic.id,
      [
        {
          role: "user",
          content: `What are the most common mistakes, misconceptions, and pitfalls when answering this question? List the top 5 errors to avoid:\n\n${userMessage}`,
        },
      ],
      { maxTokens: 2048, temperature: 0.3 }
    ),
  ]);

  const proposals: string[] = [];
  if (propA.status === "fulfilled") proposals.push(propA.value);
  if (propB.status === "fulfilled") proposals.push(propB.value);
  if (propC.status === "fulfilled") proposals.push(propC.value);
  const critique = preemptiveCritique.status === "fulfilled" ? preemptiveCritique.value : "";

  if (proposals.length === 0) {
    return callModel(MODELS.fallback.id, messages, { maxTokens: 4096 });
  }

  const proposalText = proposals.map((p, i) => `--- Expert ${i + 1} ---\n${p}`).join("\n\n");

  return callModel(
    MODELS.reasonerA.id,
    [
      {
        role: "system",
        content: `You are a world-class analyst. Synthesize the best answer from multiple expert opinions.
Do NOT mention that there were multiple experts or drafts. Present a single authoritative answer.
Incorporate valid points, correct errors, resolve contradictions. Be thorough and precise.`,
      },
      {
        role: "user",
        content: `Question: ${userMessage}\n\n${proposalText}\n\n--- Common Pitfalls to Avoid ---\n${critique}\n\nSynthesize the definitive answer.`,
      },
    ],
    { maxTokens: 8192, temperature: 0.3 }
  );
}
