"use client";

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type Topology = "fast" | "think" | "discover";
type Rigor = "balanced" | "rigorous";
type ChatMode = "hydra" | "three_phase" | "research";
type Role = "user" | "assistant";
type MessageStatus = "draft" | "refining" | "final" | "fallback";
type TraceNodeStatus = "complete" | "partial";

interface MessageCompoundTraceNode {
  id: string;
  question: string;
  dependsOn: string[];
  answer: string;
  status: TraceNodeStatus;
}

interface MessageCompoundTrace {
  kind: "compound";
  nodes: MessageCompoundTraceNode[];
}

interface MessageCollisionTraceFrame {
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

interface MessageCollisionMap {
  tensions: string[];
  agreements: string[];
  gaps: string[];
  productiveContradictions: string[];
}

interface MessageCollisionAssumption {
  id: string;
  label: string;
}

interface MessageCollisionObviousAnswer {
  domain: string;
  obviousAnswer: string;
  mechanism: string;
  coreAssumptions: MessageCollisionAssumption[];
  changedConstraint: string;
  hiddenVariable: string;
}

type MessageCollisionCandidateStatus = "survived" | "killed" | "fallback";

interface MessageCollisionCandidate {
  id: string;
  insight: string;
  mechanism: string;
  targetUser: string;
  valueCapture: string;
  supportingFrameIds: string[];
  contradiction: string;
  whyNotBaseline: string;
  score?: number;
  status: MessageCollisionCandidateStatus;
  killedReason?: string;
}

interface MessageCollisionGateResult {
  candidateId: string;
  trainingCheck: "passed" | "failed" | "not_run";
  webCheck: "passed" | "failed" | "unavailable" | "not_run";
  reasons: string[];
  revivalNote?: string;
}

interface MessageCollisionTrace {
  kind: "collision";
  obviousAnswer?: MessageCollisionObviousAnswer;
  frames: MessageCollisionTraceFrame[];
  collisionMap: MessageCollisionMap;
  candidates: MessageCollisionCandidate[];
  gateResults: MessageCollisionGateResult[];
  selectedCandidateId?: string;
  fallbackReason?: string;
}

interface MessageThreePhaseScopingDocument {
  realProblem: string;
  frames: string[];
  lazyMisses: string[];
  criticalConstraints: string[];
  dataNeededNext: string[];
}

interface MessageThreePhaseWorkerBrief {
  answerShape: string;
  mustInclude: string[];
  mustAvoid: string[];
  tone: string;
  uncertaintyHandling: string;
  instructions: string[];
}

interface MessageThreePhaseDirectorTrace {
  scopingDocument: MessageThreePhaseScopingDocument;
  retrievalQueries: string[];
  retrievedContextSummary: string;
  limitations: string[];
}

interface MessageThreePhaseArchitectTrace {
  analysis: string;
  workerBrief: MessageThreePhaseWorkerBrief;
  degradedAnswer?: string;
}

interface MessageThreePhaseWorkerTrace {
  finalAnswer: string;
  source: "worker" | "architect" | "fallback";
  degraded: boolean;
  note?: string;
}

interface MessageThreePhaseTrace {
  kind: "three_phase";
  director: MessageThreePhaseDirectorTrace;
  architect?: MessageThreePhaseArchitectTrace;
  worker?: MessageThreePhaseWorkerTrace;
}

interface MessageResearchAxis {
  id: string;
  label: string;
  prompt: string;
}

interface MessageResearchReasoningSchema {
  candidateId: string;
  axis: string;
  system: string;
  inputs: string;
  mechanism: string;
  constraints: string;
  incentives: string;
  whyItPersists: string;
  failureModes: string;
  testOrFalsifier: string;
  confidence: string;
}

type MessageResearchFatalFlawCategory =
  | "frame_violation"
  | "weak_mechanism"
  | "missing_constraint"
  | "incentive_mismatch"
  | "no_persistence"
  | "fragile_execution"
  | "hidden_failure_surface"
  | "duplicate_or_weaker_variant"
  | "unsupported_claim"
  | "no_falsifier";

interface MessageResearchEliminationCriteria {
  punish: string[];
  fatalFlawCategories: MessageResearchFatalFlawCategory[];
}

interface MessageResearchFrame {
  objective: string;
  governingInterpretation: string;
  successCriteria: string[];
  requiredReasoningSchema: MessageResearchReasoningSchema;
  disqualifiers: string[];
  commonTraps: string[];
  interpretations: string[];
  searchAxes: MessageResearchAxis[];
  eliminationCriteria: MessageResearchEliminationCriteria;
  outputShape: string;
}

type MessageResearchCandidateConfidence = "low" | "medium" | "high";

interface MessageResearchCandidate {
  id: string;
  axisId: string;
  axisLabel: string;
  candidate: string;
  system: string;
  inputs: string;
  mechanism: string;
  constraints: string;
  incentives: string;
  whyItPersists: string;
  failureModes: string;
  testOrFalsifier: string;
  confidence: MessageResearchCandidateConfidence;
}

interface MessageResearchEliminationKeep {
  candidateId: string;
  rank: 1 | 2 | 3 | 4;
  whyKept: string;
}

interface MessageResearchEliminationRejection {
  candidateId: string;
  fatalFlawCategory: MessageResearchFatalFlawCategory;
  fatalFlawReason: string;
}

interface MessageResearchEliminationJudgment {
  judgeId: string;
  lens: string;
  summary: string;
  kept: MessageResearchEliminationKeep[];
  rejected: MessageResearchEliminationRejection[];
}

interface MessageResearchFinalist {
  candidateId: string;
  axisId: string;
  axisLabel: string;
  candidate: string;
  system: string;
  inputs: string;
  mechanism: string;
  constraints: string;
  incentives: string;
  whyItPersists: string;
  failureModes: string;
  testOrFalsifier: string;
  totalScore: number;
  supportCount: number;
  averageRank: number;
  advancedBecause: string;
  mainObjections: string[];
  distinctnessCluster: string;
}

interface MessageResearchRejected {
  candidateId: string;
  axisId: string;
  axisLabel: string;
  candidate: string;
  fatalFlawCategory: MessageResearchFatalFlawCategory;
  fatalFlawReason: string;
}

type MessageResearchVerificationStatus =
  | "confirmed"
  | "plausible_but_unverified"
  | "contradicted";

interface MessageResearchVerificationPacketEntry {
  candidateId: string;
  mechanismCheck: string;
  executionFeasibilityCheck: string;
  constraintCheck: string;
  persistenceCheck: string;
  failureModeCheck: string;
  legalCompliancePolicyFlag: string;
  verificationStatus: MessageResearchVerificationStatus;
}

interface MessageResearchTrace {
  kind: "research";
  frame: MessageResearchFrame;
  axes: MessageResearchAxis[];
  generatedCandidates: MessageResearchCandidate[];
  eliminationJudgments: MessageResearchEliminationJudgment[];
  finalists: MessageResearchFinalist[];
  rejected: MessageResearchRejected[];
  selectedCandidateIds: string[];
  consensusSummary: string;
  verificationPacket: MessageResearchVerificationPacketEntry[];
  fallbackReason?: string;
}

type MessageTrace =
  | MessageCompoundTrace
  | MessageCollisionTrace
  | MessageThreePhaseTrace
  | MessageResearchTrace;

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  createdAt: string;
  mode?: ChatMode;
  topology?: Topology;
  rigor?: Rigor;
  latency?: number;
  error?: boolean;
  status?: MessageStatus;
  responseToId?: string;
  trace?: MessageTrace;
  progressSteps?: string[];
}

interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  draft: string;
  rigor: Rigor;
  mode: ChatMode;
  messages: ChatMessage[];
}

interface MessageBlock {
  type: "text" | "code";
  content: string;
  language?: string;
}

const STORAGE_KEY = "hydra.chat.threads.v1";
const MODE_LABEL: Record<ChatMode, string> = {
  hydra: "Hydra",
  three_phase: "Director > Architect > Worker",
  research: "Frame > Candidate Swarm > Elimination Swarm > Consensus > Synthesize > Verify",
};
const TOPOLOGY_COLOR: Record<Topology, string> = {
  fast: "#a3a3a3",
  think: "#8ab4ff",
  discover: "#f6bd60",
};
const MODE_COPY: Record<ChatMode, string> = {
  hydra: "Hydra classifies each prompt and can refine deeper answers automatically.",
  three_phase:
    "Director scopes, Architect reasons, and Worker translates using the strongest reasoning model.",
  research:
    "Research frames the problem, runs a 10-worker candidate tournament, cuts the field with 5 orthogonal judges, then synthesizes and verifies the winners.",
};
const RIGOR_COPY: Record<Rigor, string> = {
  balanced: "Balanced keeps Hydra fast and flexible.",
  rigorous: "Rigorous adds a verification pass and tighter synthesis.",
};
const STATUS_COLOR: Record<Exclude<MessageStatus, "final">, string> = {
  draft: "#7dd3fc",
  refining: "#f6bd60",
  fallback: "#fb7185",
};
const STATUS_COPY: Record<Exclude<MessageStatus, "final">, string> = {
  draft: "Hydra is checking the right angles before it commits to a final answer.",
  refining: "Hydra is still working through the answer and tightening it up.",
  fallback: "Showing the best available answer before the request budget expired.",
};
const STARTER_PROMPTS = [
  "Compare three architectures and recommend the strongest option.",
  "Design a novel workflow, then pressure-test it for weak spots.",
  "Break down this bug report and suggest the most likely root causes.",
  "Brainstorm unconventional product ideas, then narrow to the best one.",
];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `hydra-${Date.now()}-${Math.random()}`;
}

function deriveTitle(input: string) {
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (!collapsed) return "New chat";
  return collapsed.length > 48 ? `${collapsed.slice(0, 48).trimEnd()}...` : collapsed;
}

function getThreadPreview(thread: ChatThread) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  if (!lastMessage) return "No messages yet";

  const collapsed = buildPreviewText(lastMessage.text);
  const prefix = lastMessage.role === "user" ? "You: " : "Hydra: ";
  const preview = collapsed || "No preview available";
  const combined = `${prefix}${preview}`;

  return combined.length > 78 ? `${combined.slice(0, 78).trimEnd()}...` : combined;
}

function isMessageStatus(value: unknown): value is MessageStatus {
  return (
    value === "draft" || value === "refining" || value === "final" || value === "fallback"
  );
}

function isTraceNodeStatus(value: unknown): value is TraceNodeStatus {
  return value === "complete" || value === "partial";
}

function isCollisionCandidateStatus(value: unknown): value is MessageCollisionCandidateStatus {
  return value === "survived" || value === "killed" || value === "fallback";
}

function isChatMode(value: unknown): value is ChatMode {
  return value === "hydra" || value === "three_phase" || value === "research";
}

function normalizeTraceStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isResearchFatalFlawCategory(
  value: unknown
): value is MessageResearchFatalFlawCategory {
  return (
    value === "frame_violation" ||
    value === "weak_mechanism" ||
    value === "missing_constraint" ||
    value === "incentive_mismatch" ||
    value === "no_persistence" ||
    value === "fragile_execution" ||
    value === "hidden_failure_surface" ||
    value === "duplicate_or_weaker_variant" ||
    value === "unsupported_claim" ||
    value === "no_falsifier"
  );
}

function parseThreePhaseScopingDocument(value: unknown): MessageThreePhaseScopingDocument | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const item = value as Record<string, unknown>;
  if (typeof item.realProblem !== "string") return undefined;

  return {
    realProblem: item.realProblem,
    frames: normalizeTraceStringArray(item.frames),
    lazyMisses: normalizeTraceStringArray(item.lazyMisses),
    criticalConstraints: normalizeTraceStringArray(item.criticalConstraints),
    dataNeededNext: normalizeTraceStringArray(item.dataNeededNext),
  };
}

function parseThreePhaseWorkerBrief(value: unknown): MessageThreePhaseWorkerBrief | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const item = value as Record<string, unknown>;
  if (
    typeof item.answerShape !== "string" ||
    typeof item.tone !== "string" ||
    typeof item.uncertaintyHandling !== "string"
  ) {
    return undefined;
  }

  return {
    answerShape: item.answerShape,
    mustInclude: normalizeTraceStringArray(item.mustInclude),
    mustAvoid: normalizeTraceStringArray(item.mustAvoid),
    tone: item.tone,
    uncertaintyHandling: item.uncertaintyHandling,
    instructions: normalizeTraceStringArray(item.instructions),
  };
}

function parseResearchFrame(value: unknown): MessageResearchFrame | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const item = value as Record<string, unknown>;
  if (
    typeof item.objective !== "string" ||
    typeof item.governingInterpretation !== "string" ||
    typeof item.outputShape !== "string"
  ) {
    return undefined;
  }

  const searchAxes = Array.isArray(item.searchAxes)
    ? item.searchAxes
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          if (
            typeof record.id !== "string" ||
            typeof record.label !== "string" ||
            typeof record.prompt !== "string"
          ) {
            return null;
          }

          return {
            id: record.id,
            label: record.label,
            prompt: record.prompt,
          } satisfies MessageResearchAxis;
        })
        .filter((entry): entry is MessageResearchAxis => entry !== null)
    : [];

  const requiredReasoningSchema =
    typeof item.requiredReasoningSchema === "object" && item.requiredReasoningSchema !== null
      ? (() => {
          const schema = item.requiredReasoningSchema as Record<string, unknown>;
          if (
            typeof schema.candidateId !== "string" ||
            typeof schema.axis !== "string" ||
            typeof schema.system !== "string" ||
            typeof schema.inputs !== "string" ||
            typeof schema.mechanism !== "string" ||
            typeof schema.constraints !== "string" ||
            typeof schema.incentives !== "string" ||
            typeof schema.whyItPersists !== "string" ||
            typeof schema.failureModes !== "string" ||
            typeof schema.testOrFalsifier !== "string" ||
            typeof schema.confidence !== "string"
          ) {
            return undefined;
          }

          return {
            candidateId: schema.candidateId,
            axis: schema.axis,
            system: schema.system,
            inputs: schema.inputs,
            mechanism: schema.mechanism,
            constraints: schema.constraints,
            incentives: schema.incentives,
            whyItPersists: schema.whyItPersists,
            failureModes: schema.failureModes,
            testOrFalsifier: schema.testOrFalsifier,
            confidence: schema.confidence,
          } satisfies MessageResearchReasoningSchema;
        })()
      : undefined;

  const eliminationCriteria =
    typeof item.eliminationCriteria === "object" && item.eliminationCriteria !== null
      ? (() => {
          const criteria = item.eliminationCriteria as Record<string, unknown>;
          const fatalFlawCategories = Array.isArray(criteria.fatalFlawCategories)
            ? criteria.fatalFlawCategories.filter(isResearchFatalFlawCategory)
            : [];

          return {
            punish: normalizeTraceStringArray(criteria.punish),
            fatalFlawCategories,
          } satisfies MessageResearchEliminationCriteria;
        })()
      : undefined;

  if (!requiredReasoningSchema || !eliminationCriteria) return undefined;

  return {
    objective: item.objective,
    governingInterpretation: item.governingInterpretation,
    successCriteria: normalizeTraceStringArray(item.successCriteria),
    requiredReasoningSchema,
    disqualifiers: normalizeTraceStringArray(item.disqualifiers),
    commonTraps: normalizeTraceStringArray(item.commonTraps),
    interpretations: normalizeTraceStringArray(item.interpretations),
    searchAxes,
    eliminationCriteria,
    outputShape: item.outputShape,
  };
}

function parseMessageTrace(value: unknown): MessageTrace | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const record = value as Record<string, unknown>;
  if (record.kind === "compound" && Array.isArray(record.nodes)) {
    const nodes = record.nodes
      .map((node) => {
        if (typeof node !== "object" || node === null) return null;

        const item = node as Record<string, unknown>;
        if (
          typeof item.id !== "string" ||
          typeof item.question !== "string" ||
          !Array.isArray(item.dependsOn) ||
          item.dependsOn.some((dependency) => typeof dependency !== "string") ||
          typeof item.answer !== "string" ||
          !isTraceNodeStatus(item.status)
        ) {
          return null;
        }

        return {
          id: item.id,
          question: item.question,
          dependsOn: item.dependsOn as string[],
          answer: item.answer,
          status: item.status,
        } satisfies MessageCompoundTraceNode;
      })
      .filter((node): node is MessageCompoundTraceNode => node !== null);

    if (nodes.length !== record.nodes.length) return undefined;

    return {
      kind: "compound",
      nodes,
    };
  }

  if (record.kind === "three_phase") {
    const director =
      typeof record.director === "object" && record.director !== null
        ? (() => {
            const item = record.director as Record<string, unknown>;
            const scopingDocument = parseThreePhaseScopingDocument(item.scopingDocument);
            if (
              !scopingDocument ||
              typeof item.retrievedContextSummary !== "string" ||
              !Array.isArray(item.retrievalQueries) ||
              item.retrievalQueries.some((query) => typeof query !== "string") ||
              !Array.isArray(item.limitations) ||
              item.limitations.some((entry) => typeof entry !== "string")
            ) {
              return undefined;
            }

            return {
              scopingDocument,
              retrievalQueries: item.retrievalQueries as string[],
              retrievedContextSummary: item.retrievedContextSummary,
              limitations: item.limitations as string[],
            } satisfies MessageThreePhaseDirectorTrace;
          })()
        : undefined;

    if (!director) return undefined;

    const architect =
      typeof record.architect === "object" && record.architect !== null
        ? (() => {
            const item = record.architect as Record<string, unknown>;
            const workerBrief = parseThreePhaseWorkerBrief(item.workerBrief);
            if (!workerBrief || typeof item.analysis !== "string") {
              return undefined;
            }

            return {
              analysis: item.analysis,
              workerBrief,
              ...(typeof item.degradedAnswer === "string"
                ? { degradedAnswer: item.degradedAnswer }
                : {}),
            } satisfies MessageThreePhaseArchitectTrace;
          })()
        : undefined;

    const worker =
      typeof record.worker === "object" && record.worker !== null
        ? (() => {
            const item = record.worker as Record<string, unknown>;
            if (
              typeof item.finalAnswer !== "string" ||
              (item.source !== "worker" &&
                item.source !== "architect" &&
                item.source !== "fallback") ||
              typeof item.degraded !== "boolean"
            ) {
              return undefined;
            }

            return {
              finalAnswer: item.finalAnswer,
              source: item.source,
              degraded: item.degraded,
              ...(typeof item.note === "string" ? { note: item.note } : {}),
            } satisfies MessageThreePhaseWorkerTrace;
          })()
        : undefined;

    return {
      kind: "three_phase",
      director,
      ...(architect ? { architect } : {}),
      ...(worker ? { worker } : {}),
    };
  }

  if (record.kind === "research") {
    const frame = parseResearchFrame(record.frame);
    if (!frame) return undefined;

    const axes = Array.isArray(record.axes)
      ? record.axes
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) return null;
            const item = entry as Record<string, unknown>;
            if (
              typeof item.id !== "string" ||
              typeof item.label !== "string" ||
              typeof item.prompt !== "string"
            ) {
              return null;
            }

            return {
              id: item.id,
              label: item.label,
              prompt: item.prompt,
            } satisfies MessageResearchAxis;
          })
          .filter((entry): entry is MessageResearchAxis => entry !== null)
      : [];

    const generatedCandidates = Array.isArray(record.generatedCandidates)
      ? record.generatedCandidates
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) return null;
            const item = entry as Record<string, unknown>;
            if (
              typeof item.id !== "string" ||
              typeof item.axisId !== "string" ||
              typeof item.axisLabel !== "string" ||
              typeof item.candidate !== "string" ||
              typeof item.system !== "string" ||
              typeof item.inputs !== "string" ||
              typeof item.mechanism !== "string" ||
              typeof item.constraints !== "string" ||
              typeof item.incentives !== "string" ||
              typeof item.whyItPersists !== "string" ||
              typeof item.failureModes !== "string" ||
              typeof item.testOrFalsifier !== "string" ||
              (item.confidence !== "low" &&
                item.confidence !== "medium" &&
                item.confidence !== "high")
            ) {
              return null;
            }

            return {
              id: item.id,
              axisId: item.axisId,
              axisLabel: item.axisLabel,
              candidate: item.candidate,
              system: item.system,
              inputs: item.inputs,
              mechanism: item.mechanism,
              constraints: item.constraints,
              incentives: item.incentives,
              whyItPersists: item.whyItPersists,
              failureModes: item.failureModes,
              testOrFalsifier: item.testOrFalsifier,
              confidence: item.confidence,
            } satisfies MessageResearchCandidate;
          })
          .filter((entry): entry is MessageResearchCandidate => entry !== null)
      : [];

    const eliminationJudgments = Array.isArray(record.eliminationJudgments)
      ? record.eliminationJudgments
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) return null;
            const item = entry as Record<string, unknown>;
            const kept = Array.isArray(item.kept)
              ? item.kept
                  .map((keep) => {
                    if (typeof keep !== "object" || keep === null) return null;
                    const keepItem = keep as Record<string, unknown>;
                    if (
                      typeof keepItem.candidateId !== "string" ||
                      typeof keepItem.whyKept !== "string" ||
                      (keepItem.rank !== 1 &&
                        keepItem.rank !== 2 &&
                        keepItem.rank !== 3 &&
                        keepItem.rank !== 4)
                    ) {
                      return null;
                    }

                    return {
                      candidateId: keepItem.candidateId,
                      rank: keepItem.rank,
                      whyKept: keepItem.whyKept,
                    } satisfies MessageResearchEliminationKeep;
                  })
                  .filter((keep): keep is MessageResearchEliminationKeep => keep !== null)
              : [];

            const rejected = Array.isArray(item.rejected)
              ? item.rejected
                  .map((rejection) => {
                    if (typeof rejection !== "object" || rejection === null) return null;
                    const rejectionItem = rejection as Record<string, unknown>;
                    if (
                      typeof rejectionItem.candidateId !== "string" ||
                      !isResearchFatalFlawCategory(rejectionItem.fatalFlawCategory) ||
                      typeof rejectionItem.fatalFlawReason !== "string"
                    ) {
                      return null;
                    }

                    return {
                      candidateId: rejectionItem.candidateId,
                      fatalFlawCategory: rejectionItem.fatalFlawCategory,
                      fatalFlawReason: rejectionItem.fatalFlawReason,
                    } satisfies MessageResearchEliminationRejection;
                  })
                  .filter(
                    (rejection): rejection is MessageResearchEliminationRejection =>
                      rejection !== null
                  )
              : [];

            if (
              typeof item.judgeId !== "string" ||
              typeof item.lens !== "string" ||
              typeof item.summary !== "string"
            ) {
              return null;
            }

            return {
              judgeId: item.judgeId,
              lens: item.lens,
              summary: item.summary,
              kept,
              rejected,
            } satisfies MessageResearchEliminationJudgment;
          })
          .filter(
            (entry): entry is MessageResearchEliminationJudgment => entry !== null
          )
      : [];

    const finalists = Array.isArray(record.finalists)
      ? record.finalists
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) return null;
            const item = entry as Record<string, unknown>;
            if (
              typeof item.candidateId !== "string" ||
              typeof item.axisId !== "string" ||
              typeof item.axisLabel !== "string" ||
              typeof item.candidate !== "string" ||
              typeof item.system !== "string" ||
              typeof item.inputs !== "string" ||
              typeof item.mechanism !== "string" ||
              typeof item.constraints !== "string" ||
              typeof item.incentives !== "string" ||
              typeof item.whyItPersists !== "string" ||
              typeof item.failureModes !== "string" ||
              typeof item.testOrFalsifier !== "string" ||
              typeof item.totalScore !== "number" ||
              typeof item.supportCount !== "number" ||
              typeof item.averageRank !== "number" ||
              typeof item.advancedBecause !== "string" ||
              !Array.isArray(item.mainObjections) ||
              item.mainObjections.some((entry) => typeof entry !== "string") ||
              typeof item.distinctnessCluster !== "string"
            ) {
              return null;
            }

            return {
              candidateId: item.candidateId,
              axisId: item.axisId,
              axisLabel: item.axisLabel,
              candidate: item.candidate,
              system: item.system,
              inputs: item.inputs,
              mechanism: item.mechanism,
              constraints: item.constraints,
              incentives: item.incentives,
              whyItPersists: item.whyItPersists,
              failureModes: item.failureModes,
              testOrFalsifier: item.testOrFalsifier,
              totalScore: item.totalScore,
              supportCount: item.supportCount,
              averageRank: item.averageRank,
              advancedBecause: item.advancedBecause,
              mainObjections: item.mainObjections as string[],
              distinctnessCluster: item.distinctnessCluster,
            } satisfies MessageResearchFinalist;
          })
          .filter((entry): entry is MessageResearchFinalist => entry !== null)
      : [];

    const rejected = Array.isArray(record.rejected)
      ? record.rejected
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) return null;
            const item = entry as Record<string, unknown>;
            if (
              typeof item.candidateId !== "string" ||
              typeof item.axisId !== "string" ||
              typeof item.axisLabel !== "string" ||
              typeof item.candidate !== "string" ||
              !isResearchFatalFlawCategory(item.fatalFlawCategory) ||
              typeof item.fatalFlawReason !== "string"
            ) {
              return null;
            }

            return {
              candidateId: item.candidateId,
              axisId: item.axisId,
              axisLabel: item.axisLabel,
              candidate: item.candidate,
              fatalFlawCategory: item.fatalFlawCategory,
              fatalFlawReason: item.fatalFlawReason,
            } satisfies MessageResearchRejected;
          })
          .filter((entry): entry is MessageResearchRejected => entry !== null)
      : [];

    const verificationPacket = Array.isArray(record.verificationPacket)
      ? record.verificationPacket
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) return null;
            const item = entry as Record<string, unknown>;
            if (
              typeof item.candidateId !== "string" ||
              typeof item.mechanismCheck !== "string" ||
              typeof item.executionFeasibilityCheck !== "string" ||
              typeof item.constraintCheck !== "string" ||
              typeof item.persistenceCheck !== "string" ||
              typeof item.failureModeCheck !== "string" ||
              typeof item.legalCompliancePolicyFlag !== "string" ||
              (item.verificationStatus !== "confirmed" &&
                item.verificationStatus !== "plausible_but_unverified" &&
                item.verificationStatus !== "contradicted")
            ) {
              return null;
            }

            return {
              candidateId: item.candidateId,
              mechanismCheck: item.mechanismCheck,
              executionFeasibilityCheck: item.executionFeasibilityCheck,
              constraintCheck: item.constraintCheck,
              persistenceCheck: item.persistenceCheck,
              failureModeCheck: item.failureModeCheck,
              legalCompliancePolicyFlag: item.legalCompliancePolicyFlag,
              verificationStatus: item.verificationStatus,
            } satisfies MessageResearchVerificationPacketEntry;
          })
          .filter((entry): entry is MessageResearchVerificationPacketEntry => entry !== null)
      : [];

    if (
      typeof record.consensusSummary !== "string" ||
      !Array.isArray(record.selectedCandidateIds) ||
      record.selectedCandidateIds.some((entry) => typeof entry !== "string")
    ) {
      return undefined;
    }

    return {
      kind: "research",
      frame,
      axes,
      generatedCandidates,
      eliminationJudgments,
      finalists,
      rejected,
      selectedCandidateIds: record.selectedCandidateIds as string[],
      consensusSummary: record.consensusSummary,
      verificationPacket,
      ...(typeof record.fallbackReason === "string"
        ? { fallbackReason: record.fallbackReason }
        : {}),
    };
  }

  if (record.kind === "collision" && Array.isArray(record.frames)) {
    const obviousAnswer =
      typeof record.obviousAnswer === "object" && record.obviousAnswer !== null
        ? (() => {
            const item = record.obviousAnswer as Record<string, unknown>;
            const coreAssumptions = Array.isArray(item.coreAssumptions)
              ? item.coreAssumptions
                  .map((assumption) => {
                    if (typeof assumption !== "object" || assumption === null) return null;
                    const entry = assumption as Record<string, unknown>;
                    if (typeof entry.id !== "string" || typeof entry.label !== "string") {
                      return null;
                    }

                    return {
                      id: entry.id,
                      label: entry.label,
                    } satisfies MessageCollisionAssumption;
                  })
                  .filter(
                    (assumption): assumption is MessageCollisionAssumption => assumption !== null
                  )
              : [];

            if (
              typeof item.domain !== "string" ||
              typeof item.obviousAnswer !== "string" ||
              typeof item.mechanism !== "string" ||
              typeof item.changedConstraint !== "string" ||
              typeof item.hiddenVariable !== "string" ||
              coreAssumptions.length === 0
            ) {
              return undefined;
            }

            return {
              domain: item.domain,
              obviousAnswer: item.obviousAnswer,
              mechanism: item.mechanism,
              coreAssumptions,
              changedConstraint: item.changedConstraint,
              hiddenVariable: item.hiddenVariable,
            } satisfies MessageCollisionObviousAnswer;
          })()
        : undefined;

    const frames = record.frames
      .map((frame) => {
        if (typeof frame !== "object" || frame === null) return null;

        const item = frame as Record<string, unknown>;
        if (
          typeof item.id !== "string" ||
          (item.kind !== "baseline" &&
            item.kind !== "liability_inversion" &&
            item.kind !== "constraint_nullifier" &&
            item.kind !== "omission") ||
          typeof item.title !== "string" ||
          typeof item.premise !== "string" ||
          !Array.isArray(item.attackedAssumptionIds) ||
          item.attackedAssumptionIds.some((id) => typeof id !== "string") ||
          !Array.isArray(item.preservedAssumptionIds) ||
          item.preservedAssumptionIds.some((id) => typeof id !== "string") ||
          typeof item.answer !== "string" ||
          !isTraceNodeStatus(item.status)
        ) {
          return null;
        }

        return {
          id: item.id,
          kind: item.kind,
          title: item.title,
          premise: item.premise,
          attackedAssumptionIds: item.attackedAssumptionIds as string[],
          preservedAssumptionIds: item.preservedAssumptionIds as string[],
          answer: item.answer,
          status: item.status,
          ...(typeof item.note === "string" ? { note: item.note } : {}),
        } satisfies MessageCollisionTraceFrame;
      })
      .filter((frame): frame is MessageCollisionTraceFrame => frame !== null);

    if (frames.length !== record.frames.length) return undefined;

    const collisionMap =
      typeof record.collisionMap === "object" && record.collisionMap !== null
        ? (record.collisionMap as Record<string, unknown>)
        : null;

    if (!collisionMap) return undefined;

    const candidates = Array.isArray(record.candidates)
      ? record.candidates
          .map((candidate) => {
            if (typeof candidate !== "object" || candidate === null) return null;
            const item = candidate as Record<string, unknown>;
            if (
              typeof item.id !== "string" ||
              typeof item.insight !== "string" ||
              typeof item.mechanism !== "string" ||
              typeof item.targetUser !== "string" ||
              typeof item.valueCapture !== "string" ||
              !Array.isArray(item.supportingFrameIds) ||
              item.supportingFrameIds.some((id) => typeof id !== "string") ||
              typeof item.contradiction !== "string" ||
              typeof item.whyNotBaseline !== "string" ||
              !isCollisionCandidateStatus(item.status)
            ) {
              return null;
            }

            return {
              id: item.id,
              insight: item.insight,
              mechanism: item.mechanism,
              targetUser: item.targetUser,
              valueCapture: item.valueCapture,
              supportingFrameIds: item.supportingFrameIds as string[],
              contradiction: item.contradiction,
              whyNotBaseline: item.whyNotBaseline,
              status: item.status,
              ...(typeof item.score === "number" ? { score: item.score } : {}),
              ...(typeof item.killedReason === "string"
                ? { killedReason: item.killedReason }
                : {}),
            } satisfies MessageCollisionCandidate;
          })
          .filter((candidate): candidate is MessageCollisionCandidate => candidate !== null)
      : [];

    const gateResults = Array.isArray(record.gateResults)
      ? record.gateResults
          .map((gateResult) => {
            if (typeof gateResult !== "object" || gateResult === null) return null;
            const item = gateResult as Record<string, unknown>;
            if (
              typeof item.candidateId !== "string" ||
              (item.trainingCheck !== "passed" &&
                item.trainingCheck !== "failed" &&
                item.trainingCheck !== "not_run") ||
              (item.webCheck !== "passed" &&
                item.webCheck !== "failed" &&
                item.webCheck !== "unavailable" &&
                item.webCheck !== "not_run") ||
              !Array.isArray(item.reasons) ||
              item.reasons.some((reason) => typeof reason !== "string")
            ) {
              return null;
            }

            return {
              candidateId: item.candidateId,
              trainingCheck: item.trainingCheck,
              webCheck: item.webCheck,
              reasons: item.reasons as string[],
              ...(typeof item.revivalNote === "string"
                ? { revivalNote: item.revivalNote }
                : {}),
            } satisfies MessageCollisionGateResult;
          })
          .filter((gateResult): gateResult is MessageCollisionGateResult => gateResult !== null)
      : [];

    return {
      kind: "collision",
      obviousAnswer,
      frames,
      collisionMap: {
        tensions: normalizeTraceStringArray(collisionMap.tensions),
        agreements: normalizeTraceStringArray(collisionMap.agreements),
        gaps: normalizeTraceStringArray(collisionMap.gaps),
        productiveContradictions: normalizeTraceStringArray(
          collisionMap.productiveContradictions
        ),
      },
      candidates,
      gateResults,
      selectedCandidateId:
        typeof record.selectedCandidateId === "string" ? record.selectedCandidateId : undefined,
      fallbackReason:
        typeof record.fallbackReason === "string" ? record.fallbackReason : undefined,
    };
  }

  return undefined;
}

function summarizeTraceAnswer(answer: string) {
  const collapsed = answer.replace(/\s+/g, " ").trim();
  if (!collapsed) return "No subproblem answer was captured.";
  return collapsed.length > 220 ? `${collapsed.slice(0, 220).trimEnd()}...` : collapsed;
}

function getTraceToggleLabel(trace: MessageTrace, expanded: boolean) {
  if (trace.kind === "collision") {
    return expanded ? "Hide collision trace" : "Collision trace";
  }

  if (trace.kind === "research") {
    return expanded ? "Hide research trace" : "Research trace";
  }

  if (trace.kind === "three_phase") {
    return expanded ? "Hide 3-phase trace" : "3-phase trace";
  }

  return expanded ? "Hide reasoning trace" : "Reasoning trace";
}

function getStatusCopy(message: ChatMessage) {
  if (!message.status || message.status === "final") return "";

  if (message.mode === "research") {
    if (message.status === "draft") {
      return "Frame is defining what counts before the candidate swarm, elimination judges, synthesis, and verification run.";
    }

    if (message.status === "refining") {
      return "Research is running the candidate tournament, narrowing the winners, and calibrating them before the final answer lands.";
    }

    return "Showing the best available answer before the full Research pass finished cleanly.";
  }

  if (message.mode === "three_phase") {
    if (message.status === "draft") {
      return "Director is gathering the right context before Architect and Worker take over.";
    }

    if (message.status === "refining") {
      return "Director, Architect, and Worker are moving through the deeper pass.";
    }

    return "Showing the best available answer before the full 3-phase pass finished cleanly.";
  }

  return STATUS_COPY[message.status];
}

function stripPresentationArtifacts(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^<{3,}.*$/.test(trimmed) || /^>{3,}.*$/.test(trimmed)) return false;
      if (/^(begin|end)\s+(analysis|thinking|response|output)\b/i.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPreviewText(text: string) {
  return stripPresentationArtifacts(text)
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDraftNarration(
  mode: ChatMode | undefined,
  topology: Topology | undefined,
  rigor: Rigor
) {
  if (mode === "research") {
    return "Frame is defining the rules first, then the candidate swarm will explore 10 search axes, the elimination swarm will cut the field, Synthesize will package the winners, and Verification will calibrate them.";
  }

  if (mode === "three_phase") {
    return "Director is gathering context first, then Architect will reason through it, and Worker will turn that into the final answer.";
  }

  if (topology === "discover") {
    return rigor === "rigorous"
      ? "Before I answer, I want to test a few competing frames, see where they agree or clash, and make sure the final idea holds up from more than one angle."
      : "Before I answer, I want to check the real constraints and explore a couple of non-obvious directions so I don’t just default to the usual playbook.";
  }

  if (topology === "think") {
    return rigor === "rigorous"
      ? "Before I answer, I want to break this into parts, pressure-test the tradeoffs, and make sure the recommendation still holds once the pieces interact."
      : "Before I answer, I want to check the main constraints and tradeoffs so I can give you a tighter answer instead of a rushed one.";
  }

  return "Before I answer, I want to check the key context and make sure I’m not missing the obvious constraint.";
}

function humanizeProgressStep(
  label: string,
  mode: ChatMode | undefined,
  topology: Topology | undefined
) {
  const exact: Record<string, string> = {
    "Preparing a deeper reasoning pass":
      "Before I answer, I’m checking a few angles so the final response is actually worth reading.",
    "Frame is defining the rules":
      "Frame is defining what actually counts, what gets disqualified, and where to search next.",
    "Candidate swarm is exploring 10 search axes":
      "The candidate swarm is exploring ten independent axes so we do not converge on the obvious answer too early.",
    "Elimination swarm is cutting the field":
      "The elimination swarm is comparing the full field in parallel and aggressively cutting weak or duplicate candidates.",
    "Synthesize is packaging the winners":
      "Synthesize is turning the consensus finalists into the final ranked answer.",
    "Verification is calibrating the winners":
      "Verification is checking whether the selected winners are actually grounded enough to survive the final answer.",
    "Director is gathering context":
      "Director is gathering the relevant context from the thread and any needed sources.",
    "Director is shaping the brief":
      "Director is turning that context into a sharper brief for the deeper pass.",
    "Architect is reasoning through the problem":
      "Architect is pressure-testing the problem inside that brief.",
    "Architect is preparing the worker brief":
      "Architect is turning that reasoning into a precise handoff for the final answer.",
    "Worker is composing the final answer":
      "Worker is turning that handoff into a clean final answer.",
    "Breaking the problem into subproblems":
      "I’m breaking the problem into smaller parts so I can test them separately.",
    "Merging subproblem interactions into a final answer":
      "I’m combining those pieces and checking how they change each other.",
    "Revising the answer":
      "I’m tightening the answer so it’s clearer and more defensible.",
    "Breaking assumptions and naming hard constraints":
      "Before I answer, I’m pinning down the real constraints and stripping away soft assumptions.",
    "Deriving options from hard constraints":
      "I’m deriving options from the actual constraints instead of defaulting to standard playbooks.",
    "Revising the final first-principles answer":
      "I’m turning that analysis into a clear final answer.",
    "Testing the consensus frame":
      "I’m checking what still looks true if the mainstream view is basically right.",
    "Testing the anti-consensus frame":
      "I’m checking what changes if the mainstream view is wrong for incentive reasons.",
    "Testing the structural-shift frame":
      "I’m checking what becomes valuable if this domain is about to shift.",
    "Mining contradictions across the frames":
      "I’m looking for where those frames agree, clash, or leave something important out.",
    "Synthesizing the invisible insight":
      "I’m extracting the part that only becomes visible when those frames are compared.",
  };

  if (exact[label]) return exact[label];

  if (label.startsWith("Working through subproblems ")) {
    return "I’m working through the first set of subproblems in parallel.";
  }

  if (label.startsWith("Using earlier results to solve ")) {
    return "I’m using the early results to tackle the part that depends on them.";
  }

  if (label.startsWith("Solving subproblem ")) {
    return "I’m working through one part of the problem in more depth.";
  }

  if (label.startsWith("Critiquing subproblem ")) {
    return "I’m pressure-testing that part for weak assumptions or missing constraints.";
  }

  if (label.startsWith("Revising subproblem ")) {
    return "I’m tightening that part before I merge it back into the full answer.";
  }

  if (label.startsWith("Running ")) {
    return mode === "hydra" && topology === "discover"
      ? "I’m reviewing the current direction for weak spots, generic thinking, and missing tradeoffs."
      : "I’m pressure-testing the draft for weak assumptions and missing tradeoffs.";
  }

  if (label.startsWith("Stress-testing the proposal with ")) {
    return "I’m trying to break the strongest idea before I commit to it.";
  }

  return label;
}

type MarkdownRenderableBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; content: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "blockquote"; lines: string[] };

function parseMarkdownBlocks(text: string): MarkdownRenderableBlock[] {
  const blocks: MarkdownRenderableBlock[] = [];
  const lines = stripPresentationArtifacts(text).split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4,
        content: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*•]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*•]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        !next ||
        /^(#{1,4})\s+/.test(next) ||
        /^>\s?/.test(next) ||
        /^[-*•]\s+/.test(next) ||
        /^\d+\.\s+/.test(next)
      ) {
        break;
      }
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
      continue;
    }

    index += 1;
  }

  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*\n]+)\*)/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          className="hydra-link"
          href={match[3]}
          key={`${keyPrefix}-${index}-link`}
          rel="noreferrer"
          target="_blank"
        >
          {match[2]}
        </a>
      );
    } else if (match[5]) {
      nodes.push(
        <strong key={`${keyPrefix}-${index}-strong`}>{match[5]}</strong>
      );
    } else if (match[7]) {
      nodes.push(
        <code className="hydra-inline-code" key={`${keyPrefix}-${index}-code`}>
          {match[7]}
        </code>
      );
    } else if (match[9]) {
      nodes.push(<em key={`${keyPrefix}-${index}-em`}>{match[9]}</em>);
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function createThread(seed?: Partial<Pick<ChatThread, "draft" | "rigor" | "mode">>): ChatThread {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    draft: seed?.draft ?? "",
    rigor: seed?.rigor ?? "balanced",
    mode: seed?.mode ?? "hydra",
    messages: [],
  };
}

function loadThreads() {
  if (typeof window === "undefined") return [createThread()];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length === 0) return [createThread()];

    return parsed.map((thread) => ({
      id: typeof thread.id === "string" ? thread.id : createId(),
      title: typeof thread.title === "string" && thread.title.trim() ? thread.title : "New chat",
      createdAt:
        typeof thread.createdAt === "string" ? thread.createdAt : new Date().toISOString(),
      updatedAt:
        typeof thread.updatedAt === "string" ? thread.updatedAt : new Date().toISOString(),
      draft: typeof thread.draft === "string" ? thread.draft : "",
      rigor: thread.rigor === "rigorous" ? "rigorous" : "balanced",
      mode: isChatMode(thread.mode) ? thread.mode : "hydra",
      messages: Array.isArray(thread.messages)
        ? thread.messages.map((message: Record<string, unknown>) => ({
            id: typeof message.id === "string" ? message.id : createId(),
            role: message.role === "assistant" ? "assistant" : "user",
            text: typeof message.text === "string" ? message.text : "",
            createdAt:
              typeof message.createdAt === "string"
                ? message.createdAt
                : new Date().toISOString(),
            mode: isChatMode(message.mode) ? message.mode : undefined,
            topology:
              message.topology === "fast" ||
              message.topology === "think" ||
              message.topology === "discover"
                ? message.topology
                : undefined,
            rigor:
              message.rigor === "balanced" || message.rigor === "rigorous"
                ? message.rigor
                : undefined,
            latency: typeof message.latency === "number" ? message.latency : undefined,
            error: message.error === true,
            status: isMessageStatus(message.status)
              ? message.status
              : message.role === "assistant"
                ? "final"
                : undefined,
            responseToId:
              typeof message.responseToId === "string" ? message.responseToId : undefined,
            trace: parseMessageTrace(message.trace),
            progressSteps: Array.isArray(message.progressSteps)
              ? message.progressSteps.filter((step): step is string => typeof step === "string")
              : undefined,
          }))
        : [],
    })) as ChatThread[];
  } catch {
    return [createThread()];
  }
}

function formatThreadTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value)
  );
}

function splitBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const pattern = /```([\w-]+)?\n([\s\S]*?)```/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      const copy = text.slice(cursor, index).trim();
      if (copy) blocks.push({ type: "text", content: copy });
    }
    blocks.push({ type: "code", language: match[1]?.trim() || undefined, content: match[2] ?? "" });
    cursor = index + match[0].length;
  }

  const tail = text.slice(cursor).trim();
  if (tail) blocks.push({ type: "text", content: tail });
  return blocks.length > 0 ? blocks : [{ type: "text", content: text }];
}

function persistThreadsToStorage(threads: ChatThread[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

function serializeMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

function getLastUserMessageId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages[index].id;
    }
  }

  return null;
}

function syncThreadUrl(threadId: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set("chat", threadId);
  else url.searchParams.delete("chat");
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function resizeComposer(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

function MessageContent({ text }: { text: string }) {
  return (
    <div className="hydra-message-content">
      {splitBlocks(text).map((block, index) =>
        block.type === "code" ? (
          <div className="hydra-code" key={`${block.language ?? "text"}-${index}`}>
            <div className="hydra-code-head">{block.language ?? "text"}</div>
            <pre>
              <code>{block.content}</code>
            </pre>
          </div>
        ) : (
          <div className="hydra-markdown" key={`text-${index}`}>
            {parseMarkdownBlocks(block.content).map((markdownBlock, blockIndex) => {
              const key = `markdown-${index}-${blockIndex}`;

              if (markdownBlock.type === "heading") {
                if (markdownBlock.level === 1) {
                  return (
                    <h1 className="hydra-h1" key={key}>
                      {renderInlineMarkdown(markdownBlock.content, key)}
                    </h1>
                  );
                }

                if (markdownBlock.level === 2) {
                  return (
                    <h2 className="hydra-h2" key={key}>
                      {renderInlineMarkdown(markdownBlock.content, key)}
                    </h2>
                  );
                }

                if (markdownBlock.level === 3) {
                  return (
                    <h3 className="hydra-h3" key={key}>
                      {renderInlineMarkdown(markdownBlock.content, key)}
                    </h3>
                  );
                }

                return (
                  <h4 className="hydra-h4" key={key}>
                    {renderInlineMarkdown(markdownBlock.content, key)}
                  </h4>
                );
              }

              if (markdownBlock.type === "unordered-list") {
                return (
                  <ul className="hydra-list" key={key}>
                    {markdownBlock.items.map((item, itemIndex) => (
                      <li key={`${key}-item-${itemIndex}`}>
                        {renderInlineMarkdown(item, `${key}-item-${itemIndex}`)}
                      </li>
                    ))}
                  </ul>
                );
              }

              if (markdownBlock.type === "ordered-list") {
                return (
                  <ol className="hydra-list hydra-list-ordered" key={key}>
                    {markdownBlock.items.map((item, itemIndex) => (
                      <li key={`${key}-item-${itemIndex}`}>
                        {renderInlineMarkdown(item, `${key}-item-${itemIndex}`)}
                      </li>
                    ))}
                  </ol>
                );
              }

              if (markdownBlock.type === "blockquote") {
                return (
                  <blockquote className="hydra-quote" key={key}>
                    {markdownBlock.lines.map((line, lineIndex) => (
                      <p className="hydra-text" key={`${key}-line-${lineIndex}`}>
                        {renderInlineMarkdown(line, `${key}-line-${lineIndex}`)}
                      </p>
                    ))}
                  </blockquote>
                );
              }

              return (
                <p className="hydra-text" key={key}>
                  {markdownBlock.lines.map((line, lineIndex) => (
                    <span key={`${key}-line-${lineIndex}`}>
                      {lineIndex > 0 ? <br /> : null}
                      {renderInlineMarkdown(line, `${key}-line-${lineIndex}`)}
                    </span>
                  ))}
                </p>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

export default function HydraChatApp() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sendingThreadId, setSendingThreadId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [expandedTraceMessageId, setExpandedTraceMessageId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null;
  const orderedThreads = [...threads].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );

  useEffect(() => {
    const initialThreads = loadThreads();
    const requestedThreadId = new URLSearchParams(window.location.search).get("chat");
    const nextActiveThreadId =
      requestedThreadId && initialThreads.some((thread) => thread.id === requestedThreadId)
        ? requestedThreadId
        : initialThreads[0]?.id ?? null;

    setThreads(initialThreads);
    setActiveThreadId(nextActiveThreadId);
    setHydrated(true);
    syncThreadUrl(nextActiveThreadId, "replace");
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    persistThreadsToStorage(threads);
  }, [hydrated, threads]);

  useEffect(() => {
    resizeComposer(composerRef.current);
  }, [activeThread?.draft, activeThreadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeThread?.messages.length, activeThreadId, sendingThreadId]);

  useEffect(() => {
    setExpandedTraceMessageId(null);
  }, [activeThreadId]);

  const setDraft = (draft: string) => {
    if (!activeThread) return;
    setThreads((current) =>
      current.map((thread) => (thread.id === activeThread.id ? { ...thread, draft } : thread))
    );
  };

  const setRigor = (rigor: Rigor) => {
    if (!activeThread) return;
    const now = new Date().toISOString();
    setThreads((current) =>
      current.map((thread) =>
        thread.id === activeThread.id ? { ...thread, rigor, updatedAt: now } : thread
      )
    );
  };

  const setMode = (mode: ChatMode) => {
    if (!activeThread) return;
    const now = new Date().toISOString();
    setThreads((current) =>
      current.map((thread) =>
        thread.id === activeThread.id ? { ...thread, mode, updatedAt: now } : thread
      )
    );
  };

  const createNewThread = (draft = "") => {
    const nextThread = createThread({
      draft,
      rigor: activeThread?.rigor ?? "balanced",
      mode: activeThread?.mode ?? "hydra",
    });
    startTransition(() => {
      setThreads((current) => [nextThread, ...current]);
      setActiveThreadId(nextThread.id);
    });
    syncThreadUrl(nextThread.id, "push");
  };

  const selectThread = (threadId: string) => {
    if (threadId === activeThreadId) return;
    startTransition(() => setActiveThreadId(threadId));
    syncThreadUrl(threadId, "push");
  };

  const deleteThread = (threadId: string) => {
    if (sendingThreadId === threadId) return;

    let nextActiveThreadId: string | null = activeThreadId;
    setThreads((current) => {
      const remaining = current.filter((thread) => thread.id !== threadId);
      if (remaining.length === 0) {
        const replacement = createThread();
        nextActiveThreadId = replacement.id;
        return [replacement];
      }
      if (threadId === activeThreadId) nextActiveThreadId = remaining[0]?.id ?? null;
      return remaining;
    });
    setActiveThreadId(nextActiveThreadId);
    syncThreadUrl(nextActiveThreadId, "replace");
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1200);
    } catch {}
  };

  const toggleTrace = (messageId: string) => {
    setExpandedTraceMessageId((current) => (current === messageId ? null : messageId));
  };

  const startFollowup = async (args: {
    threadId: string;
    assistantMessageId: string;
    responseToId: string;
    mode: ChatMode;
    topology?: Topology;
    rigor: Rigor;
    draft: string;
    messages: ChatMessage[];
  }) => {
    const { threadId, assistantMessageId, responseToId, mode, topology, rigor, draft, messages } = args;
    const refiningAt = new Date().toISOString();
    const initialProgressStep = humanizeProgressStep(
      mode === "research"
        ? "Frame is defining the rules"
        : mode === "three_phase"
        ? "Director is gathering context"
        : "Preparing a deeper reasoning pass",
      mode,
      topology
    );

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              updatedAt: refiningAt,
              messages: thread.messages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      status: "refining",
                      progressSteps: [initialProgressStep],
                    }
                  : message
              ),
            }
          : thread
      )
    );

    try {
      const res = await fetch("/api/chat/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: serializeMessages(messages),
          mode,
          draft,
          topology,
          rigor,
        }),
      });
      const contentType = res.headers.get("content-type") ?? "";

      if (!res.body || !contentType.includes("text/event-stream")) {
        const data = await res.json();
        const finishedAt = new Date().toISOString();
        const nextTrace = parseMessageTrace(data.metadata?.trace);

        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== threadId) return thread;
            if (getLastUserMessageId(thread.messages) !== responseToId) return thread;
            if (!thread.messages.some((message) => message.id === assistantMessageId)) return thread;

            const nextText =
              typeof data.content === "string" && data.content.trim() ? data.content : draft;
            const nextStatus: MessageStatus =
              res.ok && data.metadata?.status !== "fallback" ? "final" : "fallback";
            const nextMode = isChatMode(data.metadata?.mode) ? data.metadata.mode : undefined;

            return {
              ...thread,
              updatedAt: finishedAt,
              messages: thread.messages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      text: nextText,
                      mode: nextMode ?? message.mode,
                      topology,
                      rigor,
                      latency:
                        typeof data.metadata?.latencyMs === "number"
                          ? data.metadata.latencyMs
                          : message.latency,
                      status: nextStatus,
                      error: !res.ok,
                      trace: nextTrace ?? message.trace,
                      progressSteps: undefined,
                    }
                  : message
              ),
            };
          })
        );

        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawTerminalEvent = false;

      const appendProgressStep = (label: string) => {
        const progressAt = new Date().toISOString();
        const friendlyLabel = humanizeProgressStep(label, mode, topology);

        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== threadId) return thread;
            if (getLastUserMessageId(thread.messages) !== responseToId) return thread;
            if (!thread.messages.some((message) => message.id === assistantMessageId)) return thread;

            return {
              ...thread,
              updatedAt: progressAt,
              messages: thread.messages.map((message) => {
                if (message.id !== assistantMessageId) return message;

                const currentSteps = message.progressSteps ?? [];
                if (currentSteps[currentSteps.length - 1] === friendlyLabel) {
                  return message;
                }

                return {
                  ...message,
                  status: "refining",
                  progressSteps: [...currentSteps, friendlyLabel].slice(-8),
                };
              }),
            };
          })
        );
      };

      const applyFinalData = (data: Record<string, unknown>, errored: boolean) => {
        const finishedAt = new Date().toISOString();
        const nextTrace = parseMessageTrace((data.metadata as Record<string, unknown> | undefined)?.trace);

        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== threadId) return thread;
            if (getLastUserMessageId(thread.messages) !== responseToId) return thread;
            if (!thread.messages.some((message) => message.id === assistantMessageId)) return thread;

            const metadata =
              typeof data.metadata === "object" && data.metadata !== null
                ? (data.metadata as Record<string, unknown>)
                : undefined;
            const nextText =
              typeof data.content === "string" && data.content.trim()
                ? data.content
                : typeof data.error === "string" && data.error.trim()
                  ? data.error
                  : draft;
            const nextStatus: MessageStatus =
              !errored && metadata?.status !== "fallback" ? "final" : "fallback";
            const nextMode = isChatMode(metadata?.mode) ? metadata.mode : undefined;

            return {
              ...thread,
              updatedAt: finishedAt,
              messages: thread.messages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      text: nextText,
                      mode: nextMode ?? message.mode,
                      topology,
                      rigor,
                      latency:
                        typeof metadata?.latencyMs === "number"
                          ? metadata.latencyMs
                          : message.latency,
                      status: nextStatus,
                      error: errored,
                      trace: nextTrace ?? message.trace,
                      progressSteps: undefined,
                    }
                  : message
              ),
            };
          })
        );
      };

      const handleEvent = (eventName: string, rawData: string) => {
        if (!rawData.trim()) return;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(rawData) as Record<string, unknown>;
        } catch {
          return;
        }

        if (eventName === "stage") {
          if (typeof data.label === "string" && data.label.trim()) {
            appendProgressStep(data.label);
          }
          return;
        }

        if (eventName === "final") {
          sawTerminalEvent = true;
          applyFinalData(data, false);
          return;
        }

        if (eventName === "error") {
          sawTerminalEvent = true;
          applyFinalData(data, true);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let boundaryIndex = buffer.indexOf("\n\n");

        while (boundaryIndex !== -1) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          let eventName = "message";
          const dataLines: string[] = [];

          for (const line of rawEvent.split(/\r?\n/)) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }

          handleEvent(eventName, dataLines.join("\n"));
          boundaryIndex = buffer.indexOf("\n\n");
        }
      }

      if (!sawTerminalEvent) {
        const failedAt = new Date().toISOString();
        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== threadId) return thread;
            if (getLastUserMessageId(thread.messages) !== responseToId) return thread;
            if (!thread.messages.some((message) => message.id === assistantMessageId)) return thread;

            return {
              ...thread,
              updatedAt: failedAt,
              messages: thread.messages.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, status: "fallback", error: true, progressSteps: undefined }
                  : message
              ),
            };
          })
        );
      }
    } catch {
      const failedAt = new Date().toISOString();
      setThreads((current) =>
        current.map((thread) => {
          if (thread.id !== threadId) return thread;
          if (getLastUserMessageId(thread.messages) !== responseToId) return thread;
          if (!thread.messages.some((message) => message.id === assistantMessageId)) return thread;

          return {
            ...thread,
            updatedAt: failedAt,
            messages: thread.messages.map((message) =>
              message.id === assistantMessageId
                ? { ...message, status: "fallback", error: true, progressSteps: undefined }
                : message
            ),
          };
        })
      );
    }
  };

  const send = async () => {
    if (!activeThread || sendingThreadId) return;
    const text = activeThread.draft.trim();
    if (!text) return;

    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      text,
      createdAt: now,
      mode: activeThread.mode,
    };
    const outgoingMessages = [...activeThread.messages, userMessage];
    const threadId = activeThread.id;
    const rigor = activeThread.rigor;
    const mode = activeThread.mode;

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title:
                thread.messages.length === 0 || thread.title === "New chat"
                  ? deriveTitle(text)
                  : thread.title,
              draft: "",
              updatedAt: now,
              messages: outgoingMessages,
            }
          : thread
      )
    );
    setSendingThreadId(threadId);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: serializeMessages(outgoingMessages),
          mode,
          rigor,
        }),
      });
      const data = await res.json();
      const finishedAt = new Date().toISOString();
      const nextMode = isChatMode(data.metadata?.mode) ? data.metadata.mode : mode;
      const topology = data.metadata?.topology as Topology | undefined;
      const nextRigor = (data.metadata?.rigor as Rigor | undefined) ?? rigor;
      const apiStatus = data.metadata?.status;
      const nextTrace = parseMessageTrace(data.metadata?.trace);
      const assistantStatus: MessageStatus = res.ok
        ? apiStatus === "draft"
          ? "draft"
          : apiStatus === "fallback"
            ? "fallback"
          : "final"
        : "fallback";
      const rawAssistantText =
        typeof data.content === "string" && data.content.trim()
          ? data.content
          : data.error ?? "Something went wrong. Please try again.";
      const shouldRunFollowup =
        res.ok &&
        assistantStatus === "draft" &&
        data.metadata?.needsFollowup === true &&
        (nextMode === "three_phase" ||
          nextMode === "research" ||
          (topology != null && topology !== "fast"));
      const visibleAssistantText =
        shouldRunFollowup
          ? buildDraftNarration(nextMode, topology, nextRigor)
          : rawAssistantText;
      const assistantMessageId = createId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        text: visibleAssistantText,
        createdAt: finishedAt,
        mode: nextMode,
        topology,
        rigor: nextRigor,
        latency: data.metadata?.latencyMs as number | undefined,
        status: assistantStatus,
        responseToId: userMessage.id,
        error: !res.ok,
        trace: nextTrace,
      };

      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: finishedAt,
                messages: [...thread.messages, assistantMessage],
              }
            : thread
        )
      );

      if (shouldRunFollowup) {
        void startFollowup({
          threadId,
          assistantMessageId,
          responseToId: userMessage.id,
          mode: nextMode,
          topology,
          rigor: nextRigor,
          draft: rawAssistantText,
          messages: outgoingMessages,
        });
      }
    } catch {
      const failedAt = new Date().toISOString();
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: failedAt,
                messages: [
                  ...thread.messages,
                  {
                    id: createId(),
                    role: "assistant",
                    text: "Connection error. Please check your network and try again.",
                    createdAt: failedAt,
                    mode,
                    rigor,
                    status: "fallback",
                    error: true,
                  },
                ],
              }
            : thread
        )
      );
    } finally {
      setSendingThreadId((current) => (current === threadId ? null : current));
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="hydra-app">
      <style>{`
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: #181818;
          color: #ececec;
          font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }
        button, textarea { font: inherit; }
        ::selection { background: rgba(16, 163, 127, 0.3); color: #f5f5f5; }
        .hydra-app {
          min-height: 100vh;
          padding: 12px;
          background: #181818;
        }
        .hydra-shell {
          min-height: calc(100vh - 24px);
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          border: 1px solid #2d2d2d;
          border-radius: 18px;
          background: #212121;
          overflow: hidden;
        }
        .hydra-sidebar {
          display: flex;
          flex-direction: column;
          min-height: 0;
          padding: 18px;
          gap: 16px;
          background: #171717;
          border-right: 1px solid #2a2a2a;
        }
        .hydra-main {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          min-height: 0;
          background: #212121;
        }
        .hydra-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .hydra-brand {
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
          color: #f5f5f5;
        }
        .hydra-muted {
          color: #a1a1aa;
          font-size: 13px;
          line-height: 1.6;
        }
        .hydra-section-title {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #7c7c85;
        }
        .hydra-btn,
        .hydra-thread,
        .hydra-thread-delete,
        .hydra-chip-btn,
        .hydra-toggle button,
        .hydra-action,
        .hydra-send {
          transition: background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
        }
        .hydra-btn,
        .hydra-thread-delete,
        .hydra-action,
        .hydra-send {
          border: 1px solid #383838;
          background: #2a2a2a;
          color: #f3f4f6;
          border-radius: 12px;
          cursor: pointer;
        }
        .hydra-btn {
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 600;
        }
        .hydra-btn:hover,
        .hydra-thread-delete:hover,
        .hydra-action:hover,
        .hydra-send:hover,
        .hydra-thread:hover,
        .hydra-chip-btn:hover,
        .hydra-toggle button:hover {
          border-color: #4a4a4a;
          background: #323232;
          box-shadow: none;
        }
        .hydra-btn-primary {
          background: #10a37f;
          border-color: #10a37f;
          color: #ffffff;
        }
        .hydra-btn-primary:hover {
          background: #0e8f70;
          border-color: #0e8f70;
        }
        .hydra-thread-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: auto;
          min-height: 0;
        }
        .hydra-thread-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: start;
        }
        .hydra-thread {
          border: 1px solid #2f2f2f;
          background: #1f1f1f;
          border-radius: 14px;
          padding: 14px;
          text-align: left;
          cursor: pointer;
        }
        .hydra-thread.is-active {
          border-color: #454545;
          background: #2a2a2a;
        }
        .hydra-thread-title {
          display: block;
          color: #f5f5f5;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.45;
          margin-bottom: 6px;
        }
        .hydra-thread-snippet {
          display: block;
          color: #9ca3af;
          font-size: 12px;
          line-height: 1.55;
          margin-bottom: 8px;
        }
        .hydra-thread-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          color: #7c7c85;
          font-size: 11px;
        }
        .hydra-thread-delete {
          padding: 8px 10px;
          font-size: 12px;
          color: #a1a1aa;
          background: transparent;
          border-color: transparent;
        }
        .hydra-head,
        .hydra-compose {
          padding: 20px 24px;
          background: #212121;
        }
        .hydra-head {
          border-bottom: 1px solid #2a2a2a;
        }
        .hydra-title {
          margin: 0;
          font-size: 20px;
          line-height: 1.25;
          font-weight: 700;
          color: #f5f5f5;
        }
        .hydra-subtitle {
          margin: 6px 0 0;
          color: #a1a1aa;
          font-size: 13px;
          line-height: 1.6;
        }
        .hydra-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .hydra-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid #353535;
          background: #262626;
          color: #c4c4cc;
          font-size: 12px;
          line-height: 1.2;
        }
        .hydra-scroll {
          min-height: 0;
          overflow: auto;
          padding: 24px;
        }
        .hydra-conversation {
          width: min(820px, 100%);
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .hydra-empty {
          min-height: 100%;
          display: grid;
          place-items: center;
        }
        .hydra-empty-card {
          width: min(720px, 100%);
          border: none;
          border-radius: 0;
          padding: 12px 0;
          background: transparent;
          box-shadow: none;
        }
        .hydra-kicker {
          color: #10a37f;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.4;
          margin-bottom: 10px;
        }
        .hydra-empty h2 {
          margin: 0;
          font-size: clamp(28px, 4vw, 36px);
          line-height: 1.2;
          letter-spacing: -0.03em;
          color: #f5f5f5;
        }
        .hydra-empty-copy {
          margin: 14px 0 22px;
          color: #a1a1aa;
          font-size: 15px;
          line-height: 1.7;
          max-width: 58ch;
        }
        .hydra-chip-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .hydra-chip-btn {
          border: 1px solid #2f2f2f;
          background: #262626;
          color: #f3f4f6;
          border-radius: 16px;
          padding: 14px 16px;
          text-align: left;
          cursor: pointer;
          min-height: 88px;
        }
        .hydra-chip-label {
          display: block;
          color: #9ca3af;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .hydra-message {
          display: flex;
        }
        .hydra-message.user {
          justify-content: flex-end;
        }
        .hydra-card {
          width: min(100%, 760px);
          border-radius: 18px;
          padding: 18px 0;
          border: none;
          background: transparent;
          box-shadow: none;
        }
        .hydra-message.user .hydra-card {
          width: min(78%, 680px);
          padding: 14px 16px;
          background: #303030;
          border: 1px solid #3a3a3a;
        }
        .hydra-message.error .hydra-card {
          padding: 14px 16px;
          background: #3a1f24;
          border: 1px solid #6b2c35;
        }
        .hydra-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
          color: #8f8f97;
          font-size: 12px;
          line-height: 1.5;
        }
        .hydra-meta-left,
        .hydra-meta-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .hydra-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          background: #262626;
          border: 1px solid #363636;
          color: #c4c4cc;
          font-size: 11px;
          line-height: 1.2;
        }
        .hydra-action {
          background: #262626;
          color: #d4d4d8;
          padding: 7px 10px;
          font-size: 12px;
        }
        .hydra-message-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .hydra-markdown {
          display: grid;
          gap: 12px;
        }
        .hydra-h1,
        .hydra-h2,
        .hydra-h3,
        .hydra-h4 {
          margin: 0;
          color: #f5f5f5;
          line-height: 1.3;
          letter-spacing: -0.02em;
        }
        .hydra-h1 {
          font-size: 26px;
          font-weight: 700;
        }
        .hydra-h2 {
          font-size: 22px;
          font-weight: 700;
        }
        .hydra-h3 {
          font-size: 18px;
          font-weight: 650;
        }
        .hydra-h4 {
          font-size: 16px;
          font-weight: 650;
        }
        .hydra-text {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          color: #ececec;
          font-size: 15px;
          line-height: 1.75;
        }
        .hydra-list {
          margin: 0;
          padding-left: 22px;
          display: grid;
          gap: 8px;
          color: #ececec;
          font-size: 15px;
          line-height: 1.75;
        }
        .hydra-list-ordered {
          padding-left: 24px;
        }
        .hydra-quote {
          margin: 0;
          padding: 12px 14px;
          border-left: 3px solid #3a5750;
          border-radius: 0 14px 14px 0;
          background: #1f2624;
        }
        .hydra-inline-code {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 7px;
          background: #2b2b2b;
          border: 1px solid #3a3a3a;
          color: #f2f2f2;
          font-size: 0.92em;
          line-height: 1.5;
          vertical-align: baseline;
        }
        .hydra-link {
          color: #7dd3fc;
          text-decoration: none;
        }
        .hydra-link:hover {
          color: #bae6fd;
          text-decoration: underline;
        }
        .hydra-note {
          margin: 12px 0 0;
          font-size: 13px;
          line-height: 1.6;
        }
        .hydra-progress {
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid #2d3a35;
          background: #1f2624;
        }
        .hydra-progress-title {
          margin: 0;
          color: #d8f3ea;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.5;
        }
        .hydra-progress-list {
          list-style: none;
          margin: 10px 0 0;
          padding: 0;
          display: grid;
          gap: 8px;
        }
        .hydra-progress-step {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: start;
          color: #b8c9c3;
          font-size: 13px;
          line-height: 1.55;
        }
        .hydra-progress-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          margin-top: 6px;
          background: #4b635b;
        }
        .hydra-progress-dot.is-active {
          background: #10a37f;
          box-shadow: 0 0 0 4px rgba(16, 163, 127, 0.12);
        }
        .hydra-trace {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #2a2a2a;
        }
        .hydra-trace-toggle {
          border: none;
          background: transparent;
          padding: 0;
          color: #10a37f;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .hydra-trace-toggle:hover {
          color: #34d399;
        }
        .hydra-trace-panel {
          margin-top: 12px;
          display: grid;
          gap: 10px;
        }
        .hydra-trace-node {
          padding: 12px;
          border-radius: 14px;
          border: 1px solid #343434;
          background: #262626;
        }
        .hydra-trace-head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .hydra-trace-id {
          font-size: 12px;
          font-weight: 700;
          color: #f5f5f5;
        }
        .hydra-trace-question {
          margin: 0 0 8px;
          color: #f3f4f6;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.5;
        }
        .hydra-trace-premise {
          margin: 0 0 8px;
          color: #8f8f97;
          font-size: 12px;
          line-height: 1.6;
        }
        .hydra-trace-answer {
          margin: 0;
          color: #b6b6bf;
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .hydra-trace-section {
          padding: 12px;
          border-radius: 14px;
          border: 1px solid #343434;
          background: #232323;
        }
        .hydra-trace-section-title {
          margin: 0 0 10px;
          color: #f5f5f5;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.4;
        }
        .hydra-trace-list {
          margin: 0;
          padding-left: 18px;
          display: grid;
          gap: 8px;
          color: #b6b6bf;
          font-size: 13px;
          line-height: 1.6;
        }
        .hydra-code {
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid #303030;
          background: #171717;
        }
        .hydra-code-head {
          padding: 8px 12px;
          color: #9ca3af;
          font-size: 11px;
          font-weight: 600;
          border-bottom: 1px solid #2c2c2c;
          background: #202020;
        }
        .hydra-code pre {
          margin: 0;
          padding: 14px;
          overflow: auto;
          color: #ececec;
          font-size: 13px;
          line-height: 1.65;
        }
        .hydra-compose {
          border-top: 1px solid #2a2a2a;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .hydra-toggle {
          display: inline-flex;
          gap: 4px;
          padding: 4px;
          border: 1px solid #303030;
          border-radius: 999px;
          background: #171717;
        }
        .hydra-toggle button {
          border: none;
          background: transparent;
          color: #9ca3af;
          padding: 8px 12px;
          border-radius: 999px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
        }
        .hydra-toggle button.is-active {
          background: #2b2b2b;
          color: #f5f5f5;
          box-shadow: none;
        }
        .hydra-frame {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: end;
          border: 1px solid #383838;
          border-radius: 24px;
          background: #2b2b2b;
          padding: 12px 14px;
        }
        .hydra-composer {
          width: 100%;
          min-height: 52px;
          max-height: 220px;
          resize: none;
          border: none;
          outline: none;
          background: transparent;
          color: #f5f5f5;
          font-size: 15px;
          line-height: 1.7;
        }
        .hydra-composer::placeholder {
          color: #8b8b95;
        }
        .hydra-send {
          min-width: 84px;
          height: 44px;
          border-radius: 999px;
          border: 1px solid #10a37f;
          background: #10a37f;
          color: #ffffff;
          font-weight: 600;
        }
        .hydra-send:hover {
          background: #0e8f70;
          border-color: #0e8f70;
        }
        .hydra-send:disabled,
        .hydra-btn:disabled,
        .hydra-thread-delete:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          box-shadow: none;
        }
        .hydra-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          color: #7c7c85;
          font-size: 12px;
          line-height: 1.6;
        }
        @media (max-width: 1080px) {
          .hydra-shell { grid-template-columns: 260px minmax(0, 1fr); }
        }
        @media (max-width: 960px) {
          .hydra-app { padding: 12px; }
          .hydra-shell { min-height: calc(100vh - 24px); grid-template-columns: 1fr; }
          .hydra-sidebar { border-right: none; border-bottom: 1px solid #2a2a2a; }
          .hydra-thread-list {
            display: grid;
            grid-auto-flow: column;
            grid-auto-columns: minmax(240px, 1fr);
            overflow-x: auto;
            overflow-y: hidden;
          }
          .hydra-chip-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .hydra-head, .hydra-compose, .hydra-sidebar, .hydra-scroll { padding: 16px; }
          .hydra-row { align-items: flex-start; flex-direction: column; }
          .hydra-thread-item { grid-template-columns: 1fr; }
          .hydra-frame { grid-template-columns: 1fr; }
          .hydra-send { width: 100%; }
          .hydra-card { width: 100%; }
        }
      `}</style>

      <div className="hydra-shell">
        <aside className="hydra-sidebar">
          <div className="hydra-row">
            <div>
              <div className="hydra-brand">Hydra</div>
              <div className="hydra-muted">AI chat workspace</div>
            </div>
            <button className="hydra-btn" type="button" onClick={() => createNewThread()}>
              New chat
            </button>
          </div>

          <div className="hydra-section-title">Chats</div>

          <div className="hydra-muted">
            Conversations are stored locally in this browser. Longer answers can refine
            automatically after the first draft arrives.
          </div>

          <div className="hydra-thread-list" aria-label="Conversations">
            {orderedThreads.map((thread) => (
              <div className="hydra-thread-item" key={thread.id}>
                <button
                  className={`hydra-thread${thread.id === activeThread?.id ? " is-active" : ""}`}
                  type="button"
                  onClick={() => selectThread(thread.id)}
                >
                  <span className="hydra-thread-title">{thread.title}</span>
                  <span className="hydra-thread-snippet">{getThreadPreview(thread)}</span>
                  <div className="hydra-thread-meta">
                    <span>{thread.messages.length} messages</span>
                    <span>{thread.mode === "three_phase" ? "3-phase" : thread.mode === "research" ? "Research" : "Hydra"}</span>
                    <span>{thread.rigor}</span>
                    <span>{formatThreadTime(thread.updatedAt)}</span>
                    {thread.id === sendingThreadId && <span>sending</span>}
                  </div>
                </button>
                <button
                  className="hydra-thread-delete"
                  type="button"
                  aria-label={`Delete ${thread.title}`}
                  disabled={thread.id === sendingThreadId}
                  onClick={() => deleteThread(thread.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="hydra-main">
          <header className="hydra-head">
            <div className="hydra-row">
              <div>
                <h1 className="hydra-title">{activeThread?.title ?? "Hydra"}</h1>
                <p className="hydra-subtitle">
                  {activeThread
                    ? `${activeThread.messages.length} messages in this thread. ${MODE_LABEL[activeThread.mode]}. ${RIGOR_COPY[activeThread.rigor]}`
                    : "Loading your workspace..."}
                </p>
              </div>
              {activeThread && (
                <div className="hydra-pills">
                  <span className="hydra-pill">updated {formatThreadTime(activeThread.updatedAt)}</span>
                  <span className="hydra-pill">{MODE_LABEL[activeThread.mode]}</span>
                  <span className="hydra-pill">{activeThread.rigor}</span>
                </div>
              )}
            </div>
          </header>

          <main className="hydra-scroll">
            {!hydrated || !activeThread ? (
              <div className="hydra-empty">
                <div className="hydra-empty-card">
                  <div className="hydra-kicker">Loading</div>
                  <h2>Rehydrating your chat workspace.</h2>
                </div>
              </div>
            ) : activeThread.messages.length === 0 ? (
              <div className="hydra-empty">
                <div className="hydra-empty-card">
                  <div className="hydra-kicker">New conversation</div>
                  <h2>Start a chat with Hydra.</h2>
                  <p className="hydra-empty-copy">
                    Ask a question, paste a problem, or choose one of the starter prompts below to
                    begin.
                  </p>
                  <div className="hydra-chip-grid">
                    {STARTER_PROMPTS.map((prompt, index) => (
                      <button className="hydra-chip-btn" key={prompt} type="button" onClick={() => setDraft(prompt)}>
                        <span className="hydra-chip-label">Prompt {index + 1}</span>
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="hydra-conversation">
                {activeThread.messages.map((message) => (
                  <article className={`hydra-message ${message.role}${message.error ? " error" : ""}`} key={message.id}>
                    <div className="hydra-card">
                      <div className="hydra-meta">
                        <div className="hydra-meta-left">
                          <span>{message.role === "user" ? "You" : "Hydra"}</span>
                          <span>{formatMessageTime(message.createdAt)}</span>
                          {message.mode && <span className="hydra-badge">{MODE_LABEL[message.mode]}</span>}
                          {message.topology && (
                            <span className="hydra-badge" style={{ color: TOPOLOGY_COLOR[message.topology], borderColor: `${TOPOLOGY_COLOR[message.topology]}55` }}>
                              {message.topology}
                            </span>
                          )}
                          {message.rigor && <span className="hydra-badge">{message.rigor}</span>}
                          {message.latency != null && <span className="hydra-badge">{(message.latency / 1000).toFixed(1)}s</span>}
                          {message.role === "assistant" && message.status && message.status !== "final" && (
                            <span className="hydra-badge" style={{ color: STATUS_COLOR[message.status], borderColor: `${STATUS_COLOR[message.status]}55` }}>
                              {message.status}
                            </span>
                          )}
                          {message.error && <span className="hydra-badge" style={{ color: "#f87171", borderColor: "rgba(248,113,113,.4)" }}>error</span>}
                        </div>
                        {message.role === "assistant" && (
                          <div className="hydra-meta-right">
                            <button className="hydra-action" type="button" onClick={() => void copyMessage(message)}>
                              {copiedMessageId === message.id ? "Copied" : "Copy"}
                            </button>
                          </div>
                        )}
                      </div>
                      <MessageContent text={message.text} />
                      {message.role === "assistant" && message.status && message.status !== "final" && (
                        <p className="hydra-note" style={{ color: STATUS_COLOR[message.status] }}>
                          {getStatusCopy(message)}
                        </p>
                      )}
                      {message.role === "assistant" &&
                        message.status === "refining" &&
                        (message.progressSteps?.length ?? 0) > 0 && (
                          <div className="hydra-progress" aria-live="polite">
                            <p className="hydra-progress-title">
                              {message.mode === "three_phase"
                                ? "3-phase is working"
                                : message.mode === "research"
                                  ? "Research is working"
                                  : "Hydra is thinking"}
                            </p>
                            <ul className="hydra-progress-list">
                              {message.progressSteps?.map((step, index, steps) => (
                                <li className="hydra-progress-step" key={`${message.id}-step-${index}`}>
                                  <span
                                    className={`hydra-progress-dot${index === steps.length - 1 ? " is-active" : ""}`}
                                    aria-hidden="true"
                                  />
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      {message.role === "assistant" &&
                        message.trace &&
                        ((message.trace.kind === "compound" &&
                          message.trace.nodes.length > 0) ||
                          message.trace.kind === "research" ||
                          message.trace.kind === "three_phase" ||
                          (message.trace.kind === "collision" &&
                            message.trace.frames.length > 0)) && (
                          <div className="hydra-trace">
                            <button
                              className="hydra-trace-toggle"
                              type="button"
                              onClick={() => toggleTrace(message.id)}
                            >
                              {getTraceToggleLabel(
                                message.trace,
                                expandedTraceMessageId === message.id
                              )}
                            </button>
                            {expandedTraceMessageId === message.id && (
                              <div className="hydra-trace-panel">
                                {(() => {
                                  if (message.trace.kind === "compound") {
                                    return message.trace.nodes.map((node) => (
                                      <div className="hydra-trace-node" key={`${message.id}-${node.id}`}>
                                        <div className="hydra-trace-head">
                                          <span className="hydra-trace-id">Node {node.id}</span>
                                          <span className="hydra-badge">{node.status}</span>
                                          {node.dependsOn.length > 0 && (
                                            <span className="hydra-badge">
                                              depends on {node.dependsOn.join(", ")}
                                            </span>
                                          )}
                                        </div>
                                        <p className="hydra-trace-question">{node.question}</p>
                                        <p className="hydra-trace-answer">
                                          {summarizeTraceAnswer(node.answer)}
                                        </p>
                                      </div>
                                    ));
                                  }

                                  if (message.trace.kind === "research") {
                                    const trace = message.trace;
                                    return (
                                      <>
                                        <div className="hydra-trace-section">
                                          <p className="hydra-trace-section-title">Frame</p>
                                          <div className="hydra-trace-node">
                                            <div className="hydra-trace-head">
                                              <span className="hydra-trace-id">Objective</span>
                                              <span className="hydra-badge">frame</span>
                                            </div>
                                            <p className="hydra-trace-question">
                                              {trace.frame.objective}
                                            </p>
                                            {trace.frame.successCriteria.length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {trace.frame.successCriteria.map(
                                                  (item, index) => (
                                                    <li key={`${message.id}-research-success-${index}`}>
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            <p className="hydra-trace-answer">
                                              Governing interpretation:{" "}
                                              {summarizeTraceAnswer(trace.frame.governingInterpretation)}
                                            </p>
                                            {trace.frame.disqualifiers.length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {trace.frame.disqualifiers.map(
                                                  (item, index) => (
                                                    <li key={`${message.id}-research-disqualifier-${index}`}>
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            {trace.frame.commonTraps.length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {trace.frame.commonTraps.map(
                                                  (item, index) => (
                                                    <li key={`${message.id}-research-trap-${index}`}>
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            {trace.frame.interpretations.length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {trace.frame.interpretations.map(
                                                  (item, index) => (
                                                    <li key={`${message.id}-research-interpretation-${index}`}>
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            <ul className="hydra-trace-list">
                                              <li>
                                                Schema `candidateId`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema.candidateId
                                                )}
                                              </li>
                                              <li>
                                                Schema `system`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema.system
                                                )}
                                              </li>
                                              <li>
                                                Schema `mechanism`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema.mechanism
                                                )}
                                              </li>
                                              <li>
                                                Schema `constraints`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema.constraints
                                                )}
                                              </li>
                                              <li>
                                                Schema `incentives`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema.incentives
                                                )}
                                              </li>
                                              <li>
                                                Schema `whyItPersists`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema.whyItPersists
                                                )}
                                              </li>
                                              <li>
                                                Schema `failureModes`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema.failureModes
                                                )}
                                              </li>
                                              <li>
                                                Schema `testOrFalsifier`:{" "}
                                                {summarizeTraceAnswer(
                                                  trace.frame.requiredReasoningSchema
                                                    .testOrFalsifier
                                                )}
                                              </li>
                                            </ul>
                                            {trace.frame.eliminationCriteria.punish.length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {trace.frame.eliminationCriteria.punish.map(
                                                  (item, index) => (
                                                    <li key={`${message.id}-research-punish-${index}`}>
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            {trace.frame.eliminationCriteria.fatalFlawCategories.length > 0 && (
                                              <div className="hydra-trace-head">
                                                {trace.frame.eliminationCriteria.fatalFlawCategories.map(
                                                  (category) => (
                                                    <span
                                                      className="hydra-badge"
                                                      key={`${message.id}-research-flaw-category-${category}`}
                                                    >
                                                      {category}
                                                    </span>
                                                  )
                                                )}
                                              </div>
                                            )}
                                            <p className="hydra-trace-answer">
                                              Output shape:{" "}
                                              {summarizeTraceAnswer(trace.frame.outputShape)}
                                            </p>
                                          </div>
                                        </div>

                                        {trace.axes.length > 0 && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Search axes</p>
                                            {trace.axes.map((axis) => (
                                              <div
                                                className="hydra-trace-node"
                                                key={`${message.id}-research-axis-${axis.id}`}
                                              >
                                                <div className="hydra-trace-head">
                                                  <span className="hydra-trace-id">{axis.label}</span>
                                                  <span className="hydra-badge">{axis.id}</span>
                                                </div>
                                                <p className="hydra-trace-answer">
                                                  {summarizeTraceAnswer(axis.prompt)}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {trace.generatedCandidates.length > 0 && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Generated candidates</p>
                                            {trace.axes.map((axis) => {
                                              const axisCandidates = trace.generatedCandidates.filter(
                                                (candidate) => candidate.axisId === axis.id
                                              );
                                              if (axisCandidates.length === 0) return null;

                                              return (
                                                <div
                                                  className="hydra-trace-node"
                                                  key={`${message.id}-research-candidate-group-${axis.id}`}
                                                >
                                                  <div className="hydra-trace-head">
                                                    <span className="hydra-trace-id">{axis.label}</span>
                                                    <span className="hydra-badge">{axis.id}</span>
                                                  </div>
                                                  {axisCandidates.map((candidate) => (
                                                    <div
                                                      className="hydra-trace-node"
                                                      key={`${message.id}-research-candidate-${candidate.id}`}
                                                    >
                                                      <div className="hydra-trace-head">
                                                        <span className="hydra-trace-id">{candidate.id}</span>
                                                        <span className="hydra-badge">
                                                          {candidate.confidence}
                                                        </span>
                                                        {trace.selectedCandidateIds.includes(candidate.id) && (
                                                          <span className="hydra-badge">selected</span>
                                                        )}
                                                      </div>
                                                      <p className="hydra-trace-question">
                                                        {candidate.candidate}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        System: {summarizeTraceAnswer(candidate.system)}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        Inputs: {summarizeTraceAnswer(candidate.inputs)}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        Mechanism: {summarizeTraceAnswer(candidate.mechanism)}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        Constraints:{" "}
                                                        {summarizeTraceAnswer(candidate.constraints)}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        Incentives:{" "}
                                                        {summarizeTraceAnswer(
                                                          candidate.incentives
                                                        )}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        Why it persists:{" "}
                                                        {summarizeTraceAnswer(candidate.whyItPersists)}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        Failure modes:{" "}
                                                        {summarizeTraceAnswer(candidate.failureModes)}
                                                      </p>
                                                      <p className="hydra-trace-answer">
                                                        Test or falsifier:{" "}
                                                        {summarizeTraceAnswer(candidate.testOrFalsifier)}
                                                      </p>
                                                    </div>
                                                  ))}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}

                                        <div className="hydra-trace-section">
                                          <p className="hydra-trace-section-title">Consensus summary</p>
                                          <p className="hydra-trace-answer">
                                            {summarizeTraceAnswer(trace.consensusSummary)}
                                          </p>
                                        </div>

                                        {trace.eliminationJudgments.length > 0 && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Elimination judges</p>
                                            {trace.eliminationJudgments.map((judgment) => (
                                              <div
                                                className="hydra-trace-node"
                                                key={`${message.id}-research-judge-${judgment.judgeId}`}
                                              >
                                                <div className="hydra-trace-head">
                                                  <span className="hydra-trace-id">{judgment.judgeId}</span>
                                                  <span className="hydra-badge">{judgment.lens}</span>
                                                </div>
                                                <p className="hydra-trace-answer">
                                                  {summarizeTraceAnswer(judgment.summary)}
                                                </p>
                                                {judgment.kept.length > 0 && (
                                                  <div className="hydra-trace-node">
                                                    <div className="hydra-trace-head">
                                                      {judgment.kept.map((keep) => (
                                                        <span
                                                          className="hydra-badge"
                                                          key={`${message.id}-${judgment.judgeId}-keep-${keep.candidateId}`}
                                                        >
                                                          #{keep.rank} {keep.candidateId}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                                {judgment.rejected.length > 0 && (
                                                  <ul className="hydra-trace-list">
                                                    {judgment.rejected.map((rejection) => (
                                                      <li
                                                        key={`${message.id}-${judgment.judgeId}-reject-${rejection.candidateId}`}
                                                      >
                                                        {rejection.candidateId} ({rejection.fatalFlawCategory}):{" "}
                                                        {summarizeTraceAnswer(rejection.fatalFlawReason)}
                                                      </li>
                                                    ))}
                                                  </ul>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {trace.rejected.length > 0 && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Rejected</p>
                                            {trace.rejected.map((candidate) => (
                                              <div
                                                className="hydra-trace-node"
                                                key={`${message.id}-research-rejected-${candidate.candidateId}`}
                                              >
                                                <div className="hydra-trace-head">
                                                  <span className="hydra-trace-id">
                                                    {candidate.candidateId}
                                                  </span>
                                                  <span className="hydra-badge">
                                                    {candidate.axisLabel}
                                                  </span>
                                                </div>
                                                <p className="hydra-trace-question">
                                                  {candidate.candidate}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Fatal flaw ({candidate.fatalFlawCategory}):{" "}
                                                  {summarizeTraceAnswer(candidate.fatalFlawReason)}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {trace.finalists.length > 0 && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Consensus finalists</p>
                                            {trace.finalists.map((candidate) => (
                                              <div
                                                className="hydra-trace-node"
                                                key={`${message.id}-research-finalist-${candidate.candidateId}`}
                                              >
                                                <div className="hydra-trace-head">
                                                  <span className="hydra-trace-id">
                                                    {candidate.candidateId}
                                                  </span>
                                                  <span className="hydra-badge">
                                                    {candidate.axisLabel}
                                                  </span>
                                                  <span className="hydra-badge">
                                                    {candidate.totalScore} pts
                                                  </span>
                                                  <span className="hydra-badge">
                                                    {candidate.supportCount} judges
                                                  </span>
                                                  <span className="hydra-badge">
                                                    {candidate.distinctnessCluster}
                                                  </span>
                                                  {trace.selectedCandidateIds.includes(candidate.candidateId) && (
                                                    <span className="hydra-badge">selected</span>
                                                  )}
                                                </div>
                                                <p className="hydra-trace-question">
                                                  {candidate.candidate}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  System: {summarizeTraceAnswer(candidate.system)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Inputs: {summarizeTraceAnswer(candidate.inputs)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Mechanism: {summarizeTraceAnswer(candidate.mechanism)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Constraints:{" "}
                                                  {summarizeTraceAnswer(candidate.constraints)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Incentives:{" "}
                                                  {summarizeTraceAnswer(candidate.incentives)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Why it persists:{" "}
                                                  {summarizeTraceAnswer(candidate.whyItPersists)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Failure modes:{" "}
                                                  {summarizeTraceAnswer(candidate.failureModes)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Test or falsifier:{" "}
                                                  {summarizeTraceAnswer(candidate.testOrFalsifier)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Why advanced:{" "}
                                                  {summarizeTraceAnswer(candidate.advancedBecause)}
                                                </p>
                                                {candidate.mainObjections.length > 0 && (
                                                  <ul className="hydra-trace-list">
                                                    {candidate.mainObjections.map((objection, index) => (
                                                      <li
                                                        key={`${message.id}-research-objection-${candidate.candidateId}-${index}`}
                                                      >
                                                        {summarizeTraceAnswer(objection)}
                                                      </li>
                                                    ))}
                                                  </ul>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {trace.verificationPacket.length > 0 && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Verification packet</p>
                                            {trace.verificationPacket.map((entry) => (
                                              <div
                                                className="hydra-trace-node"
                                                key={`${message.id}-research-verify-${entry.candidateId}`}
                                              >
                                                <div className="hydra-trace-head">
                                                  <span className="hydra-trace-id">{entry.candidateId}</span>
                                                  <span className="hydra-badge">
                                                    {entry.verificationStatus}
                                                  </span>
                                                </div>
                                                <p className="hydra-trace-answer">
                                                  Mechanism check:{" "}
                                                  {summarizeTraceAnswer(entry.mechanismCheck)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Execution feasibility:{" "}
                                                  {summarizeTraceAnswer(
                                                    entry.executionFeasibilityCheck
                                                  )}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Constraint check:{" "}
                                                  {summarizeTraceAnswer(entry.constraintCheck)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Persistence check:{" "}
                                                  {summarizeTraceAnswer(entry.persistenceCheck)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Failure-mode check:{" "}
                                                  {summarizeTraceAnswer(entry.failureModeCheck)}
                                                </p>
                                                <p className="hydra-trace-answer">
                                                  Legal/compliance/policy:{" "}
                                                  {summarizeTraceAnswer(
                                                    entry.legalCompliancePolicyFlag
                                                  )}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {trace.selectedCandidateIds.length > 0 && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Selected finalists</p>
                                            <div className="hydra-trace-head">
                                              {trace.selectedCandidateIds.map((candidateId) => (
                                                <span
                                                  className="hydra-badge"
                                                  key={`${message.id}-research-selected-${candidateId}`}
                                                >
                                                  {candidateId}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {trace.fallbackReason && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Fallback reason</p>
                                            <p className="hydra-trace-answer">
                                              {summarizeTraceAnswer(trace.fallbackReason)}
                                            </p>
                                          </div>
                                        )}
                                      </>
                                    );
                                  }

                                  if (message.trace.kind === "three_phase") {
                                    return (
                                      <>
                                        <div className="hydra-trace-section">
                                          <p className="hydra-trace-section-title">Director</p>
                                          <div className="hydra-trace-node">
                                            <div className="hydra-trace-head">
                                              <span className="hydra-trace-id">Scoping brief</span>
                                              <span className="hydra-badge">director</span>
                                            </div>
                                            <p className="hydra-trace-question">
                                              {message.trace.director.scopingDocument.realProblem}
                                            </p>
                                            {message.trace.director.scopingDocument.frames.length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {message.trace.director.scopingDocument.frames.map(
                                                  (frame, index) => (
                                                    <li key={`${message.id}-director-frame-${index}`}>
                                                      {summarizeTraceAnswer(frame)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            {message.trace.director.scopingDocument.lazyMisses.length >
                                              0 && (
                                              <ul className="hydra-trace-list">
                                                {message.trace.director.scopingDocument.lazyMisses.map(
                                                  (item, index) => (
                                                    <li key={`${message.id}-director-miss-${index}`}>
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            {message.trace.director.scopingDocument.criticalConstraints
                                              .length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {message.trace.director.scopingDocument.criticalConstraints.map(
                                                  (item, index) => (
                                                    <li
                                                      key={`${message.id}-director-constraint-${index}`}
                                                    >
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            {message.trace.director.scopingDocument.dataNeededNext.length >
                                              0 && (
                                              <ul className="hydra-trace-list">
                                                {message.trace.director.scopingDocument.dataNeededNext.map(
                                                  (item, index) => (
                                                    <li key={`${message.id}-director-data-${index}`}>
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                            <p className="hydra-trace-answer">
                                              {summarizeTraceAnswer(
                                                message.trace.director.retrievedContextSummary
                                              )}
                                            </p>
                                            {message.trace.director.retrievalQueries.length > 0 && (
                                              <div className="hydra-trace-head">
                                                {message.trace.director.retrievalQueries.map(
                                                  (query, index) => (
                                                    <span
                                                      className="hydra-badge"
                                                      key={`${message.id}-director-query-${index}`}
                                                    >
                                                      {query}
                                                    </span>
                                                  )
                                                )}
                                              </div>
                                            )}
                                            {message.trace.director.limitations.length > 0 && (
                                              <ul className="hydra-trace-list">
                                                {message.trace.director.limitations.map(
                                                  (item, index) => (
                                                    <li
                                                      key={`${message.id}-director-limitation-${index}`}
                                                    >
                                                      {summarizeTraceAnswer(item)}
                                                    </li>
                                                  )
                                                )}
                                              </ul>
                                            )}
                                          </div>
                                        </div>

                                        {message.trace.architect && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Architect</p>
                                            <div className="hydra-trace-node">
                                              <div className="hydra-trace-head">
                                                <span className="hydra-trace-id">
                                                  Analysis
                                                </span>
                                                <span className="hydra-badge">architect</span>
                                              </div>
                                              <p className="hydra-trace-answer">
                                                {summarizeTraceAnswer(message.trace.architect.analysis)}
                                              </p>
                                              {message.trace.architect.degradedAnswer && (
                                                <p className="hydra-trace-answer">
                                                  {summarizeTraceAnswer(
                                                    message.trace.architect.degradedAnswer
                                                  )}
                                                </p>
                                              )}
                                              <div className="hydra-trace-head">
                                                <span className="hydra-badge">
                                                  {message.trace.architect.workerBrief.answerShape}
                                                </span>
                                                <span className="hydra-badge">
                                                  {message.trace.architect.workerBrief.tone}
                                                </span>
                                              </div>
                                              <p className="hydra-trace-answer">
                                                {summarizeTraceAnswer(
                                                  message.trace.architect.workerBrief
                                                    .uncertaintyHandling
                                                )}
                                              </p>
                                              {message.trace.architect.workerBrief.mustInclude.length >
                                                0 && (
                                                <ul className="hydra-trace-list">
                                                  {message.trace.architect.workerBrief.mustInclude.map(
                                                    (item, index) => (
                                                      <li
                                                        key={`${message.id}-architect-include-${index}`}
                                                      >
                                                        {summarizeTraceAnswer(item)}
                                                      </li>
                                                    )
                                                  )}
                                                </ul>
                                              )}
                                              {message.trace.architect.workerBrief.mustAvoid.length >
                                                0 && (
                                                <ul className="hydra-trace-list">
                                                  {message.trace.architect.workerBrief.mustAvoid.map(
                                                    (item, index) => (
                                                      <li
                                                        key={`${message.id}-architect-avoid-${index}`}
                                                      >
                                                        {summarizeTraceAnswer(item)}
                                                      </li>
                                                    )
                                                  )}
                                                </ul>
                                              )}
                                              {message.trace.architect.workerBrief.instructions.length >
                                                0 && (
                                                <ul className="hydra-trace-list">
                                                  {message.trace.architect.workerBrief.instructions.map(
                                                    (item, index) => (
                                                      <li
                                                        key={`${message.id}-architect-instruction-${index}`}
                                                      >
                                                        {summarizeTraceAnswer(item)}
                                                      </li>
                                                    )
                                                  )}
                                                </ul>
                                              )}
                                            </div>
                                          </div>
                                        )}

                                        {message.trace.worker && (
                                          <div className="hydra-trace-section">
                                            <p className="hydra-trace-section-title">Worker</p>
                                            <div className="hydra-trace-node">
                                              <div className="hydra-trace-head">
                                                <span className="hydra-trace-id">
                                                  Final answer snapshot
                                                </span>
                                                <span className="hydra-badge">
                                                  {message.trace.worker.source}
                                                </span>
                                                {message.trace.worker.degraded && (
                                                  <span className="hydra-badge">degraded</span>
                                                )}
                                              </div>
                                              <p className="hydra-trace-answer">
                                                {summarizeTraceAnswer(
                                                  message.trace.worker.finalAnswer
                                                )}
                                              </p>
                                              {message.trace.worker.note && (
                                                <p className="hydra-trace-answer">
                                                  {summarizeTraceAnswer(message.trace.worker.note)}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </>
                                    );
                                  }

                                  return (
                                  <>
                                    {message.trace.obviousAnswer && (
                                      <div className="hydra-trace-section">
                                        <p className="hydra-trace-section-title">
                                          Obvious answer
                                        </p>
                                        <div className="hydra-trace-node">
                                          <div className="hydra-trace-head">
                                            <span className="hydra-trace-id">
                                              {message.trace.obviousAnswer.domain}
                                            </span>
                                          </div>
                                          <p className="hydra-trace-question">
                                            {message.trace.obviousAnswer.obviousAnswer}
                                          </p>
                                          <p className="hydra-trace-answer">
                                            Mechanism:{" "}
                                            {summarizeTraceAnswer(
                                              message.trace.obviousAnswer.mechanism
                                            )}
                                          </p>
                                          <p className="hydra-trace-answer">
                                            Changed constraint:{" "}
                                            {summarizeTraceAnswer(
                                              message.trace.obviousAnswer.changedConstraint
                                            )}
                                          </p>
                                          <p className="hydra-trace-answer">
                                            Hidden variable:{" "}
                                            {summarizeTraceAnswer(
                                              message.trace.obviousAnswer.hiddenVariable
                                            )}
                                          </p>
                                          <div className="hydra-trace-head">
                                            {message.trace.obviousAnswer.coreAssumptions.map(
                                              (assumption) => (
                                                <span
                                                  className="hydra-badge"
                                                  key={`${message.id}-assumption-${assumption.id}`}
                                                >
                                                  {assumption.id}: {assumption.label}
                                                </span>
                                              )
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {message.trace.frames.map((frame) => (
                                      <div className="hydra-trace-node" key={`${message.id}-${frame.id}`}>
                                        <div className="hydra-trace-head">
                                          <span className="hydra-trace-id">{frame.title}</span>
                                          <span className="hydra-badge">{frame.kind.replace(/_/g, " ")}</span>
                                          <span className="hydra-badge">{frame.status}</span>
                                          {frame.attackedAssumptionIds.length > 0 && (
                                            <span className="hydra-badge">
                                              attacks {frame.attackedAssumptionIds.join(", ")}
                                            </span>
                                          )}
                                        </div>
                                        <p className="hydra-trace-premise">{frame.premise}</p>
                                        <p className="hydra-trace-answer">
                                          {summarizeTraceAnswer(frame.answer)}
                                        </p>
                                        {frame.note && (
                                          <p className="hydra-trace-answer">
                                            {summarizeTraceAnswer(frame.note)}
                                          </p>
                                        )}
                                      </div>
                                    ))}

                                    {message.trace.collisionMap.agreements.length > 0 && (
                                      <div className="hydra-trace-section">
                                        <p className="hydra-trace-section-title">
                                          Robust agreements
                                        </p>
                                        <ul className="hydra-trace-list">
                                          {message.trace.collisionMap.agreements.map((item, index) => (
                                            <li key={`${message.id}-agreement-${index}`}>
                                              {summarizeTraceAnswer(item)}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {message.trace.collisionMap.productiveContradictions.length >
                                      0 && (
                                      <div className="hydra-trace-section">
                                        <p className="hydra-trace-section-title">
                                          Productive contradictions
                                        </p>
                                        <ul className="hydra-trace-list">
                                          {message.trace.collisionMap.productiveContradictions.map(
                                            (item, index) => (
                                              <li
                                                key={`${message.id}-productive-contradiction-${index}`}
                                              >
                                                {summarizeTraceAnswer(item)}
                                              </li>
                                            )
                                          )}
                                        </ul>
                                      </div>
                                    )}

                                    {message.trace.collisionMap.tensions.length > 0 && (
                                      <div className="hydra-trace-section">
                                        <p className="hydra-trace-section-title">Tensions</p>
                                        <ul className="hydra-trace-list">
                                          {message.trace.collisionMap.tensions.map((item, index) => (
                                            <li key={`${message.id}-tension-${index}`}>
                                              {summarizeTraceAnswer(item)}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {message.trace.collisionMap.gaps.length > 0 && (
                                      <div className="hydra-trace-section">
                                        <p className="hydra-trace-section-title">
                                          Blind spots
                                        </p>
                                        <ul className="hydra-trace-list">
                                          {message.trace.collisionMap.gaps.map((item, index) => (
                                            <li key={`${message.id}-gap-${index}`}>
                                              {summarizeTraceAnswer(item)}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {message.trace.candidates.length > 0 && (
                                      <div className="hydra-trace-section">
                                        <p className="hydra-trace-section-title">Candidates</p>
                                        {message.trace.candidates.map((candidate) => {
                                          const gate =
                                            message.trace?.kind === "collision"
                                              ? message.trace.gateResults.find(
                                                  (result) =>
                                                    result.candidateId === candidate.id
                                                )
                                              : undefined;

                                          return (
                                            <div
                                              className="hydra-trace-node"
                                              key={`${message.id}-candidate-${candidate.id}`}
                                            >
                                              <div className="hydra-trace-head">
                                                <span className="hydra-trace-id">
                                                  {candidate.id}
                                                </span>
                                                <span className="hydra-badge">
                                                  {candidate.status}
                                                </span>
                                                {message.trace?.kind === "collision" &&
                                                  message.trace.selectedCandidateId ===
                                                  candidate.id && (
                                                  <span className="hydra-badge">selected</span>
                                                )}
                                              </div>
                                              <p className="hydra-trace-question">
                                                {candidate.insight}
                                              </p>
                                              <p className="hydra-trace-answer">
                                                Mechanism:{" "}
                                                {summarizeTraceAnswer(candidate.mechanism)}
                                              </p>
                                              <p className="hydra-trace-answer">
                                                Target user: {candidate.targetUser}
                                              </p>
                                              <p className="hydra-trace-answer">
                                                Value capture: {candidate.valueCapture}
                                              </p>
                                              <p className="hydra-trace-answer">
                                                Why not baseline:{" "}
                                                {summarizeTraceAnswer(candidate.whyNotBaseline)}
                                              </p>
                                              <p className="hydra-trace-answer">
                                                Depends on frames{" "}
                                                {candidate.supportingFrameIds.join(", ")}
                                              </p>
                                              <p className="hydra-trace-answer">
                                                {summarizeTraceAnswer(candidate.contradiction)}
                                              </p>
                                              {candidate.killedReason && (
                                                <p className="hydra-trace-answer">
                                                  {summarizeTraceAnswer(candidate.killedReason)}
                                                </p>
                                              )}
                                              {gate && (
                                                <>
                                                  <div className="hydra-trace-head">
                                                    <span className="hydra-badge">
                                                      training {gate.trainingCheck}
                                                    </span>
                                                    <span className="hydra-badge">
                                                      web {gate.webCheck}
                                                    </span>
                                                  </div>
                                                  {gate.reasons.length > 0 && (
                                                    <ul className="hydra-trace-list">
                                                      {gate.reasons.map((reason, index) => (
                                                        <li
                                                          key={`${message.id}-${candidate.id}-reason-${index}`}
                                                        >
                                                          {summarizeTraceAnswer(reason)}
                                                        </li>
                                                      ))}
                                                    </ul>
                                                  )}
                                                  {gate.revivalNote && (
                                                    <p className="hydra-trace-answer">
                                                      {summarizeTraceAnswer(gate.revivalNote)}
                                                    </p>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {message.trace.fallbackReason && (
                                      <div className="hydra-trace-section">
                                        <p className="hydra-trace-section-title">
                                          Fallback reason
                                        </p>
                                        <p className="hydra-trace-answer">
                                          {summarizeTraceAnswer(message.trace.fallbackReason)}
                                        </p>
                                      </div>
                                    )}
                                  </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  </article>
                ))}

                {sendingThreadId === activeThread.id && (
                  <article className="hydra-message assistant" aria-live="polite">
                    <div className="hydra-card">
                      <div className="hydra-meta">
                        <div className="hydra-meta-left">
                          <span>Hydra</span>
                          <span>drafting</span>
                          <span className="hydra-badge">{MODE_LABEL[activeThread.mode]}</span>
                          <span className="hydra-badge">{activeThread.rigor}</span>
                        </div>
                      </div>
                      <p className="hydra-text">
                        {activeThread.mode === "three_phase"
                          ? "Director is scoping the problem, Architect is reasoning through it, and Worker is turning that into a clean answer."
                          : activeThread.mode === "research"
                            ? "Frame is defining the rules, the candidate swarm is searching across 10 axes, the elimination swarm is cutting the field, Synthesize is packaging the winners, and Verification is calibrating them."
                            : "Before I answer, I am sketching a first pass and deciding whether this needs a deeper reasoning run."}
                      </p>
                    </div>
                  </article>
                )}
              </div>
            )}
            <div ref={endRef} />
          </main>

          <footer className="hydra-compose">
            <div className="hydra-row">
              <div className="hydra-toggle" role="group" aria-label="Thread mode">
                {([
                  { value: "hydra", label: "Hydra" },
                  { value: "three_phase", label: "3-phase" },
                  { value: "research", label: "Research" },
                ] as const).map((option) => (
                  <button
                    className={activeThread?.mode === option.value ? "is-active" : ""}
                    key={option.value}
                    type="button"
                    onClick={() => setMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="hydra-toggle" role="group" aria-label="Thread rigor">
                {(["balanced", "rigorous"] as const).map((option) => (
                  <button className={activeThread?.rigor === option ? "is-active" : ""} key={option} type="button" onClick={() => setRigor(option)}>
                    {option}
                  </button>
                ))}
              </div>
              <div className="hydra-pills">
                <span className="hydra-pill">{MODE_COPY[activeThread?.mode ?? "hydra"]}</span>
                <span className="hydra-pill">{RIGOR_COPY[activeThread?.rigor ?? "balanced"]}</span>
              </div>
            </div>

            <div className="hydra-frame">
              <textarea
                ref={composerRef}
                className="hydra-composer"
                value={activeThread?.draft ?? ""}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Message Hydra..."
                rows={1}
                disabled={!activeThread || sendingThreadId !== null}
              />
              <button className="hydra-send" type="button" onClick={() => void send()} disabled={!activeThread?.draft.trim() || sendingThreadId !== null}>
                Send
              </button>
            </div>

            <div className="hydra-footer">
              <span>Enter sends. Shift+Enter adds a new line.</span>
              <span>
                {sendingThreadId
                  ? "Hydra is drafting..."
                  : "Follow-up refinement runs automatically when needed."}
              </span>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
