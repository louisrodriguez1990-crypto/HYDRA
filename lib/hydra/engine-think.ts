import { call } from "./openrouter";
import { MODELS } from "./models";

const SYNTH = `You are producing a final answer from multiple expert analyses. Rules:
- Do NOT mention multiple experts, analyses, or sources. Write as one authoritative voice.
- Lead with the answer. No preamble. No "Great question!"
- Match tone and length to the question — casual gets casual, technical gets technical.
- Where experts disagreed, go with the strongest reasoning.
- If genuinely uncertain, say so honestly.
- Be precise. No filler. No padding.`;

export async function think(messages: { role: string; content: string }[]): Promise<string> {
  const query = messages[messages.length - 1].content;
  const ctx = messages.slice(0, -1);

  const [a, b, c] = await Promise.allSettled([
    call(
      MODELS.broad.id,
      [...ctx, { role: "user", content: `Think step-by-step.\n\n${query}` }],
      { maxTokens: 3000, temperature: 0.5 }
    ),
    call(
      MODELS.analyst.id,
      [...ctx, { role: "user", content: `Consider multiple approaches, evaluate tradeoffs, then give your best answer.\n\n${query}` }],
      { maxTokens: 3000, temperature: 0.6 }
    ),
    call(
      MODELS.critic.id,
      [...ctx, { role: "user", content: `First identify the most obvious answer. Then find flaws in it. Then give the most defensible answer.\n\n${query}` }],
      { maxTokens: 3000, temperature: 0.5 }
    ),
  ]);

  const proposals = [a, b, c]
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value.length > 0)
    .map((r) => r.value);

  if (proposals.length === 0) return call(MODELS.broad.id, messages);
  if (proposals.length === 1) return proposals[0];

  const combined = proposals.map((p, i) => `--- Analysis ${i + 1} ---\n${p}`).join("\n\n");

  return call(
    MODELS.reasoner.id,
    [
      { role: "system", content: SYNTH },
      { role: "user", content: `Question: ${query}\n\n${combined}\n\nSynthesize the best answer.` },
    ],
    { maxTokens: 3000, temperature: 0.3 }
  );
}
