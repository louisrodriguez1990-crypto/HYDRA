export type Topology = "fast" | "think" | "discover";
export type Rigor = "balanced" | "rigorous";
export type ResponseStatus = "draft" | "final" | "fallback";
export type TraceNodeStatus = "complete" | "partial";

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

export interface CompoundTraceNode {
  id: string;
  question: string;
  dependsOn: string[];
  answer: string;
  status: TraceNodeStatus;
}

export interface CompoundTrace {
  kind: "compound";
  nodes: CompoundTraceNode[];
}

export interface CollisionTraceFrame {
  id: string;
  kind: "baseline" | "liability_inversion" | "constraint_nullifier" | "omission";
  title: string;
  premise: string;
  attackedAssumptionIds: string[];
  preservedAssumptionIds: string[];
  answer: string;
  status: TraceNodeStatus;
  note?: string;
}

export interface CollisionMapTrace {
  tensions: string[];
  agreements: string[];
  gaps: string[];
  productiveContradictions: string[];
}

export interface CollisionAssumption {
  id: string;
  label: string;
}

export interface CollisionObviousAnswer {
  domain: string;
  obviousAnswer: string;
  mechanism: string;
  coreAssumptions: CollisionAssumption[];
  changedConstraint: string;
  hiddenVariable: string;
}

export type CollisionCandidateStatus = "survived" | "killed" | "fallback";

export interface CollisionCandidate {
  id: string;
  insight: string;
  mechanism: string;
  targetUser: string;
  valueCapture: string;
  supportingFrameIds: string[];
  contradiction: string;
  whyNotBaseline: string;
  score?: number;
  status: CollisionCandidateStatus;
  killedReason?: string;
}

export interface CollisionCandidateGateResult {
  candidateId: string;
  trainingCheck: "passed" | "failed" | "not_run";
  webCheck: "passed" | "failed" | "unavailable" | "not_run";
  reasons: string[];
  revivalNote?: string;
}

export interface CollisionTrace {
  kind: "collision";
  obviousAnswer: CollisionObviousAnswer;
  frames: CollisionTraceFrame[];
  collisionMap: CollisionMapTrace;
  candidates: CollisionCandidate[];
  gateResults: CollisionCandidateGateResult[];
  selectedCandidateId?: string;
  fallbackReason?: string;
}

export type ReasoningTrace = CompoundTrace | CollisionTrace;

export interface ProgressUpdate {
  label: string;
}

export type ProgressReporter = (update: ProgressUpdate) => void | Promise<void>;

export interface EngineResponse {
  content: string;
  status: ResponseStatus;
  needsFollowup: boolean;
  trace?: ReasoningTrace;
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
