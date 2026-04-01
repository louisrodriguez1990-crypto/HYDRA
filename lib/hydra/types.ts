export type Topology = "fast" | "think" | "discover";
export type Rigor = "balanced" | "rigorous";

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
