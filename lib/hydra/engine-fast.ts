import { call } from "./openrouter";
import { MODELS } from "./models";
import type { ChatMessage, EngineResponse, Rigor } from "./types";

const FAST_FALLBACK =
  "Hydra hit the serverless time budget before it could finish. Please try again or switch to a simpler prompt.";

export async function fast(
  messages: ChatMessage[],
  rigor: Rigor = "balanced"
): Promise<EngineResponse> {
  const content = await call(MODELS.fast.id, messages, {
    maxTokens: 2048,
    temperature: rigor === "rigorous" ? 0.2 : 0.5,
    timeoutMs: 12000,
  });

  if (!content.trim()) {
    return {
      content: FAST_FALLBACK,
      status: "fallback",
      needsFollowup: false,
    };
  }

  return {
    content,
    status: "final",
    needsFollowup: false,
  };
}
