export type Topology = "fast" | "think" | "discover";
export type Rigor = "balanced" | "rigorous";
export type ResponseStatus = "draft" | "final" | "fallback";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Plan {
  topology: Topology;
  complexity: number;
}

export interface VerificationResult {
  content: string;
  revised: boolean;
  findings: number;
}

export interface EngineResponse {
  content: string;
  status: ResponseStatus;
  needsFollowup: boolean;
}

export function isChatMessage(value: unknown): value is ChatMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    "content" in value &&
    typeof value.role === "string" &&
    typeof value.content === "string"
  );
}

export function isTopology(value: unknown): value is Topology {
  return value === "fast" || value === "think" || value === "discover";
}
