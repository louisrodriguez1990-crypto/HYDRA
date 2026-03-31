import { call } from "./openrouter";
import { MODELS } from "./models";

export async function fast(messages: { role: string; content: string }[]): Promise<string> {
  return call(MODELS.fast.id, messages, { maxTokens: 2048 });
}
