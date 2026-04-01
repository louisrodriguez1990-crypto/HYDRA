import { call } from "./openrouter";
import { MODELS } from "./models";
import type { ChatMessage, Rigor } from "./types";
import { verifyAnswer } from "./verify";

const SYNTH = `You are producing a final answer from multiple expert analyses. Rules:
- Do NOT mention multiple experts, analyses, or sources. Write as one authoritative voice.
- Lead with the answer. No preamble. No "Great question!"
- Match tone and length to the question - casual gets casual, technical gets technical.
- Where experts disagreed, go with the strongest reasoning.
- If genuinely uncertain, say so honestly.
- Be precise. No filler. No padding.`;

export async function think(
  messages: ChatMessage[],
  rigor: Rigor = "balanced"
): Promise<string> {
  const query = messages[messages.length - 1].content;
  const ctx = messages.slice(0, -1);
  const rigorous = rigor === "rigorous";

  const [a, b, c] = await Promise.allSettled([
    call(
      MODELS.broad.id,
      [
        ...ctx,
        {
          role: "user",
          content: rigorous
            ? `Work systematically. State the key constraints, compare the most viable approaches, call out the main tradeoffs, then give your recommendation.\n\n${query}`
            : `Think step-by-step.\n\n${query}`,
        },
      ],
      { maxTokens: 3000, temperature: rigorous ? 0.35 : 0.5 }
    ),
    call(
      MODELS.analyst.id,
      [
        ...ctx,
        {
          role: "user",
          content: rigorous
            ? `Analyze this methodically. Surface assumptions, evaluate tradeoffs, identify likely failure modes, then give the strongest answer.\n\n${query}`
            : `Consider multiple approaches, evaluate tradeoffs, then give your best answer.\n\n${query}`,
        },
      ],
      { maxTokens: 3000, temperature: rigorous ? 0.4 : 0.6 }
    ),
    call(
      MODELS.critic.id,
      [
        ...ctx,
        {
          role: "user",
          content: rigorous
            ? `Be adversarial but constructive. Challenge the obvious answer, surface the strongest objections, then give the most defensible answer.\n\n${query}`
            : `First identify the most obvious answer. Then find flaws in it. Then give the most defensible answer.\n\n${query}`,
        },
      ],
      { maxTokens: 3000, temperature: rigorous ? 0.3 : 0.5 }
    ),
  ]);

  const proposals = [a, b, c]
    .filter(
      (result): result is PromiseFulfilledResult<string> =>
        result.status === "fulfilled" && result.value.length > 0
    )
    .map((result) => result.value);

  let draft: string;

  if (proposals.length === 0) {
    draft = await call(MODELS.broad.id, messages, {
      maxTokens: 3000,
      temperature: rigorous ? 0.35 : 0.5,
    });
  } else if (proposals.length === 1) {
    draft = proposals[0];
  } else {
    const combined = proposals
      .map((proposal, index) => `--- Analysis ${index + 1} ---\n${proposal}`)
      .join("\n\n");

    draft = await call(
      MODELS.reasoner.id,
      [
        { role: "system", content: SYNTH },
        {
          role: "user",
          content: `Question: ${query}\n\n${combined}\n\nSynthesize the best answer.`,
        },
      ],
      { maxTokens: 3000, temperature: 0.3 }
    );
  }

  if (!rigorous) {
    return draft;
  }

  const verified = await verifyAnswer({
    query,
    draft,
    topology: "think",
    rigor,
  });

  return verified.content;
}
