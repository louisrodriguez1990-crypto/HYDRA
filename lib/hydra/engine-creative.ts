import { callModel } from "./openrouter";
import { MODELS } from "./models";
import type OpenAI from "openai";

const CREATIVE_MERGE_PROMPT = `You are a master editor. You've been given multiple creative drafts responding to the same prompt. Your job is to produce a single final piece that takes the best elements — voice, imagery, structure, ideas — from each draft. The result should feel like it was written by one person, not stitched together. Do not mention the drafts.`;

export async function executeCreative(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  const userMessage = messages[messages.length - 1].content as string;
  const context = messages.slice(0, -1);

  const [draftA, draftB] = await Promise.allSettled([
    callModel(
      MODELS.creative.id,
      [...context, { role: "user", content: userMessage }],
      { maxTokens: 6144, temperature: 0.9 }
    ),
    callModel(
      MODELS.generalist.id,
      [...context, { role: "user", content: userMessage }],
      { maxTokens: 6144, temperature: 0.8 }
    ),
  ]);

  const drafts: string[] = [];
  if (draftA.status === "fulfilled") drafts.push(draftA.value);
  if (draftB.status === "fulfilled") drafts.push(draftB.value);

  if (drafts.length <= 1) return drafts[0] ?? "I couldn't generate a response. Please try again.";

  return callModel(
    MODELS.fast.id,
    [
      { role: "system", content: CREATIVE_MERGE_PROMPT },
      {
        role: "user",
        content: `Prompt: ${userMessage}\n\n--- Draft A ---\n${drafts[0]}\n\n--- Draft B ---\n${drafts[1]}\n\nProduce the final version.`,
      },
    ],
    { maxTokens: 6144, temperature: 0.7 }
  );
}
