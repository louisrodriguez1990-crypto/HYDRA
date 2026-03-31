import { callModel } from "./openrouter";
import { MODELS } from "./models";
import type OpenAI from "openai";

export async function executeFast(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  return callModel(MODELS.fast.id, messages, {
    maxTokens: 2048,
    temperature: 0.7,
  });
}
