import { call } from "./openrouter";
import { MODELS } from "./models";
import type { ChatMessage, Rigor } from "./types";

export async function fast(
  messages: ChatMessage[],
  rigor: Rigor = "balanced"
): Promise<string> {
  return call(MODELS.fast.id, messages, {
    maxTokens: 2048,
    temperature: rigor === "rigorous" ? 0.2 : 0.5,
  });
}
