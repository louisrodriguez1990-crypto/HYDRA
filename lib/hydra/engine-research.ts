import { MODELS } from "./models";
import { call, parseJSON } from "./openrouter";
import { runRepoContextQueries } from "./repo-context";
import { runSearchQueries, type SearchWindow } from "./search";
import type {
  ChatMessage,
  EngineResponse,
  ProgressReporter,
  ResearchCandidate,
  ResearchCandidateConfidence,
  ResearchEliminationCriteria,
  ResearchEliminationJudgment,
  ResearchEliminationKeep,
  ResearchEliminationRejection,
  ResearchFatalFlawCategory,
  ResearchFinalist,
  ResearchFrame,
  ResearchGoNoGoDecision,
  ResearchReasoningSchema,
  ResearchRejected,
  ResearchRetryFeedback,
  ResearchSearchAxis,
  ResearchTrace,
  ResearchVerificationPacketEntry,
  Rigor,
} from "./types";

const RESEARCH_MODELS = {
  frame: MODELS.researchFrame.id,
  candidateSwarm: MODELS.researchCandidateSwarm.id,
  eliminationSwarm: MODELS.researchEliminationSwarm.id,
  synthesize: MODELS.researchSynthesize.id,
  verify: MODELS.researchVerify.id,
} as const;

export const RESEARCH_MODEL_ID = [
  `frame:${RESEARCH_MODELS.frame}`,
  `candidateSwarm:${RESEARCH_MODELS.candidateSwarm}`,
  `eliminationSwarm:${RESEARCH_MODELS.eliminationSwarm}`,
  `synthesize:${RESEARCH_MODELS.synthesize}`,
  `verify:${RESEARCH_MODELS.verify}`,
].join(" | ");

const RESEARCH_DRAFT =
  "Frame is defining the rules before the candidate swarm explores 10 axes, the elimination swarm cuts the field, Synthesize picks the winners, and Verification calibrates them.";
const RESEARCH_FALLBACK =
  "Hydra could not complete the Research pass within the current request budget. Please try again.";

const FRAME_STAGE = "Frame is defining the rules";
const CANDIDATE_SWARM_STAGE = "Candidate swarm is exploring 10 search axes";
const ELIMINATION_SWARM_STAGE = "Elimination swarm is cutting the field";
const SYNTHESIZE_STAGE = "Synthesize is packaging the winners";
const VERIFY_STAGE = "Verification is calibrating the winners";

const AXIS_COUNT = 10;
const CANDIDATE_MINIMUM = 6;
const ELIMINATION_JUDGE_COUNT = 5;
const ELIMINATION_QUORUM = 3;
const FINALIST_COUNT = 4;
const SELECTED_COUNT = 2;

const CODE_CONTEXT_PATTERN =
  /```|\b(repo|repository|codebase|component|module|function|file|folder|route|api|app\/|lib\/|package\.json|next\.config|vercel\.json|tsx?|jsx?|bug|build|lint|test|typecheck|compile|refactor|implement|fix)\b/i;
const WEB_CONTEXT_PATTERN =
  /\b(latest|current|today|recent|news|look up|lookup|search online|search the web|verify|fact check|release|version|price|pricing|president|ceo|weather|score|schedule|stock|market|bond|yield|rate|legal|law|policy|regulation|compliance|data|benchmark|statistic|factual|as of)\b/i;

const FATAL_FLAW_CATEGORIES: ResearchFatalFlawCategory[] = [
  "frame_violation",
  "weak_mechanism",
  "missing_constraint",
  "incentive_mismatch",
  "no_persistence",
  "fragile_execution",
  "hidden_failure_surface",
  "duplicate_or_weaker_variant",
  "unsupported_claim",
  "no_falsifier",
];

const FRAME_PROMPT = `Given the user prompt, do not answer it yet.
Construct a compact framing object that defines what valid reasoning must look like.

Output ONLY JSON:
{
  "objective": "...",
  "governingInterpretation": "...",
  "successCriteria": ["..."],
  "requiredReasoningSchema": {
    "candidateId": "...",
    "axis": "...",
    "system": "...",
    "inputs": "...",
    "assumption": "...",
    "mechanism": "...",
    "constraints": "...",
    "incentives": "...",
    "whyItPersists": "...",
    "failureModes": "...",
    "testOrFalsifier": "...",
    "measurementPlan": "...",
    "competitiveMoat": "...",
    "executionBarrier": "...",
    "confidence": "..."
  },
  "disqualifiers": ["..."],
  "commonTraps": ["..."],
  "interpretations": ["..."],
  "searchAxes": [
    { "id": "A1", "label": "...", "prompt": "..." }
  ],
  "eliminationCriteria": {
    "punish": ["..."],
    "fatalFlawCategories": [
      "frame_violation",
      "weak_mechanism",
      "missing_constraint",
      "incentive_mismatch",
      "no_persistence",
      "fragile_execution",
      "hidden_failure_surface",
      "duplicate_or_weaker_variant",
      "unsupported_claim",
      "no_falsifier"
    ]
  },
  "outputShape": "..."
}

Rules:
- Return exactly 10 search axes.
- Keep it compact, operational, and mechanism-first.
- Every candidate must be built from explicit mechanism, assumptions, constraints, incentives, persistence, measurement, and failure modes.
- Every candidate must explain a credible competitive moat or execution barrier.
- Any answer relying mainly on analogy, precedent, trend language, authority, or unsupported conclusion is invalid.
- searchAxes must be orthogonal search directions, not paraphrases.
- Do not answer the user.`;

const CANDIDATE_PROMPT = `You are one candidate worker.

You have one search axis only.
You must produce exactly one candidate object.
Do not produce a final answer.
Do not rank candidates.
Do not explain broadly.
Do not use analogy, trend language, or authority as substitutes for mechanism.

Your candidate will be judged by an elimination swarm.
Candidates missing explicit mechanism, assumptions, constraints, incentives, persistence, measurement, moat/execution barriers, failure modes, or a falsifiable test will likely be eliminated.

Before output, run this cheap self-check once:
- Did I fill every field?
- Did I name the core assumption?
- Is the mechanism causal and step-by-step?
- Did I name real constraints?
- Did I explain why it persists?
- Did I state what breaks it?
- Did I include at least one observable test or falsifier?
- Did I include a concrete measurement plan?
- Did I explain why others do not or cannot compress it?
- Is this distinct from generic category answers?

Output ONLY JSON:
{
  "candidate": "...",
  "system": "...",
  "inputs": "...",
  "assumption": "...",
  "mechanism": "...",
  "constraints": "...",
  "incentives": "...",
  "whyItPersists": "...",
  "failureModes": "...",
  "testOrFalsifier": "...",
  "measurementPlan": "...",
  "competitiveMoat": "...",
  "executionBarrier": "...",
  "confidence": "low|medium|high"
}`;

const ELIMINATION_PROMPT = `Using the framing object and the full candidate pool, eliminate aggressively.

Output ONLY JSON:
{
  "summary": "...",
  "kept": [
    {
      "candidateId": "A1",
      "rank": 1,
      "whyKept": "..."
    }
  ],
  "rejected": [
    {
      "candidateId": "A2",
      "fatalFlawCategory": "weak_mechanism",
      "fatalFlawReason": "..."
    }
  ]
}

Rules:
- Keep exactly 4 candidates and rank them 1 through 4.
- Reject every remaining candidate.
- Do not synthesize the final answer.
- Do not write user-facing prose.
- Be harsh and lens-specific.
- Normalize fatalFlawCategory to one of:
  frame_violation
  weak_mechanism
  missing_constraint
  incentive_mismatch
  no_persistence
  fragile_execution
  hidden_failure_surface
  duplicate_or_weaker_variant
  unsupported_claim
  no_falsifier`;

const SYNTHESIZE_PROMPT = `You are synthesizing finalists only.

Your job is to:
- compare the 4 finalists
- choose the strongest 2
- explain why they survive better than the others
- preserve the exact mechanisms and constraints
- improve readability and explanatory clarity

Do not invent missing logic.
Do not expand scope.
Do not introduce new candidates.

Output ONLY JSON:
{
  "selectedCandidateIds": ["A1", "A4"],
  "answer": "..."
}`;

const VERIFY_PROMPT = `You are calibrating already-selected finalists.

Do not choose new candidates.
Do not write user-facing prose.
Return only a verification packet for the provided selected finalists.

Output ONLY JSON:
{
  "packet": [
    {
      "candidateId": "A1",
      "assumptionCheck": "...",
      "mechanismCheck": "...",
      "measurementCheck": "...",
      "evidenceSummary": "...",
      "executionFeasibilityCheck": "...",
      "constraintCheck": "...",
      "persistenceCheck": "...",
      "failureModeCheck": "...",
      "competitiveMoatCheck": "...",
      "legalCompliancePolicyFlag": "...",
      "falsificationCriterion": "...",
      "viabilityThreshold": "...",
      "goNoGoDecision": "go|watch|no-go",
      "verificationSources": ["..."],
      "verificationStatus": "confirmed|plausible_but_unverified|contradicted"
    }
  ]
}

Rules:
- Use "confirmed" only when external evidence is provided and it materially supports the claim.
- Without external retrieval, default to "plausible_but_unverified" unless the claim materially breaks.
- Use "plausible_but_unverified" when the story might hold but is not fully defensible from the provided material.
- Use "contradicted" when the mechanism, constraints, persistence, or failure surface materially breaks.
- Return a falsification criterion and viability threshold for every candidate.
- Keep go/no-go aligned with the verification status:
  - confirmed -> usually go
  - plausible_but_unverified -> usually watch
  - contradicted -> no-go`;

const FRAME_TIMEOUT_MS = 20_000;
const CANDIDATE_SWARM_TIMEOUT_MS = 18_000;
const ELIMINATION_SWARM_TIMEOUT_MS = 20_000;
const SYNTHESIZE_TIMEOUT_MS = 22_000;
const VERIFY_TIMEOUT_MS = 18_000;

const ELIMINATION_JUDGES = [
  {
    judgeId: "J1",
    lens: "Mechanism Integrity",
    guidance:
      "Check causal chain completeness, hidden leaps, hand-waving, and whether the mechanism is real rather than analogy.",
  },
  {
    judgeId: "J2",
    lens: "Constraint Realism",
    guidance:
      "Check whether the limiting factors are real, concrete, and demonstrated rather than merely asserted.",
  },
  {
    judgeId: "J3",
    lens: "Incentive Alignment",
    guidance:
      "Check whether the actors would actually behave this way and whether the story is incentive-compatible.",
  },
  {
    judgeId: "J4",
    lens: "Persistence Validity",
    guidance:
      "Check why the opportunity or pattern has not already disappeared and whether the persistence story actually holds.",
  },
  {
    judgeId: "J5",
    lens: "Failure Surface / Fragility",
    guidance:
      "Check what breaks the idea, whether the fragility is understated, and whether the proposal survives contact with reality.",
  },
] as const;

interface CandidateConsensusStats {
  totalScore: number;
  supportCount: number;
  rankSum: number;
  keepReasons: string[];
  rejectCategories: ResearchFatalFlawCategory[];
  rejectReasons: string[];
}

interface EliminationConsensusResult {
  eliminationJudgments: ResearchEliminationJudgment[];
  finalists: ResearchFinalist[];
  rejected: ResearchRejected[];
  consensusSummary: string;
  fallbackReason?: string;
}

interface SynthesizedResearchAnswer {
  answer: string;
  selectedCandidateIds: string[];
}

interface VerificationRetrievalOutcome {
  mode: "thread" | "repo" | "web";
  queries: string[];
  context: string;
  summary: string;
  sources: string[];
  limitations: string[];
  usedExternalEvidence: boolean;
}

interface VerificationRunResult {
  packet: ResearchVerificationPacketEntry[];
  retrieval: VerificationRetrievalOutcome;
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => toNonEmptyString(item)).filter(Boolean))].slice(0, limit);
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = keyOf(item).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function uniqueStrings(items: string[], limit = 8) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function formatConversation(messages: ChatMessage[]) {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join("\n\n");
}

function looksCodebaseOrFileTask(messages: ChatMessage[]) {
  const thread = messages.map((message) => message.content).join("\n");
  return CODE_CONTEXT_PATTERN.test(thread);
}

function looksWebFactTask(messages: ChatMessage[]) {
  const thread = messages.map((message) => message.content).join("\n");
  return WEB_CONTEXT_PATTERN.test(thread);
}

function buildWebWindow(messages: ChatMessage[]): SearchWindow {
  const thread = messages.map((message) => message.content).join("\n");
  return /\b(latest|current|today|recent|news|release|version|price|pricing|president|ceo|score|schedule|weather|stock|market|bond|yield|rate|policy|regulation|legal|law|as of)\b/i.test(
    thread
  )
    ? "recent"
    : "any";
}

function normalizeConfidence(value: unknown): ResearchCandidateConfidence {
  return value === "low" || value === "high" ? value : "medium";
}

function confidenceScore(confidence: ResearchCandidateConfidence) {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function averageRank(rankSum: number, supportCount: number) {
  return supportCount > 0 ? rankSum / supportCount : Number.POSITIVE_INFINITY;
}

function mostCommonReason(reasons: string[], fallback: string) {
  if (reasons.length === 0) return fallback;

  const counts = new Map<string, number>();
  for (const reason of reasons) {
    const normalized = reason.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return top ?? fallback;
}

function mostCommonCategory(
  categories: ResearchFatalFlawCategory[],
  fallback: ResearchFatalFlawCategory
) {
  if (categories.length === 0) return fallback;

  const counts = new Map<ResearchFatalFlawCategory, number>();
  for (const category of categories) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return top ?? fallback;
}

function normalizeComparableText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeDistinctness(value: string) {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "that",
    "with",
    "from",
    "this",
    "into",
    "your",
    "their",
    "then",
    "than",
    "because",
    "through",
    "where",
    "when",
    "which",
    "while",
    "under",
    "across",
    "about",
    "between",
    "using",
    "could",
    "would",
    "should",
    "have",
    "has",
    "been",
    "being",
    "still",
    "over",
    "only",
    "idea",
    "system",
    "market",
    "candidate",
  ]);

  return normalizeComparableText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !stopwords.has(token));
}

function jaccardSimilarity(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

function candidateDistinctnessSignature(candidate: ResearchCandidate) {
  return tokenizeDistinctness(
    [
      candidate.candidate,
      candidate.system,
      candidate.assumption,
      candidate.mechanism,
      candidate.constraints,
      candidate.incentives,
      candidate.whyItPersists,
      candidate.competitiveMoat,
      candidate.executionBarrier,
    ].join(" ")
  );
}

function areNearDuplicateCandidates(left: ResearchCandidate, right: ResearchCandidate) {
  const leftTitle = normalizeComparableText(left.candidate);
  const rightTitle = normalizeComparableText(right.candidate);
  if (leftTitle && rightTitle) {
    if (leftTitle === rightTitle) return true;
    if (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) return true;
  }

  return (
    jaccardSimilarity(candidateDistinctnessSignature(left), candidateDistinctnessSignature(right)) >=
    0.7
  );
}

function buildFallbackReasoningSchema(): ResearchReasoningSchema {
  return {
    candidateId: "Short stable identifier for the candidate.",
    axis: "The assigned search axis.",
    system: "The system or environment where the idea lives.",
    inputs: "The minimum inputs, signals, or conditions needed.",
    assumption: "The key claim about reality that must hold for the idea to work.",
    mechanism: "Step-by-step causal mechanism, not analogy.",
    constraints: "Real limiting factors or boundaries that matter.",
    incentives: "Why the participants behave this way.",
    whyItPersists: "Why the edge or pattern has not already disappeared.",
    failureModes: "What breaks the idea or makes it fail in practice.",
    testOrFalsifier: "One observable test that could prove the idea wrong.",
    measurementPlan: "What evidence or measurement would validate the core claim.",
    competitiveMoat: "Why others do not or cannot compress the edge immediately.",
    executionBarrier: "What practical barrier makes execution hard in reality.",
    confidence: "Low, medium, or high based on structural clarity.",
  };
}

function buildFallbackEliminationCriteria(): ResearchEliminationCriteria {
  return {
    punish: [
      "Frame violations",
      "Mechanism gaps and hand-waving",
      "Missing or fake constraints",
      "Incentive contradictions",
      "No credible persistence story",
      "Fragile execution or hidden failure surfaces",
      "Unsupported claims",
      "Missing falsifiers",
      "Near-duplicate variants",
    ],
    fatalFlawCategories: FATAL_FLAW_CATEGORIES,
  };
}

function buildFallbackFrame(query: string): ResearchFrame {
  const axes: ResearchSearchAxis[] = [
    {
      id: "A1",
      label: "Operational bottlenecks",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in physical or operational bottlenecks.`,
    },
    {
      id: "A2",
      label: "Formal rules",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in regulation, policy, or formal rule constraints.`,
    },
    {
      id: "A3",
      label: "Incentive mismatch",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in mismatched incentives between participants.`,
    },
    {
      id: "A4",
      label: "Time asymmetry",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in time delays, sequencing, duration, or waiting periods.`,
    },
    {
      id: "A5",
      label: "Capital limits",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in capital constraints, collateral separation, or balance-sheet limits.`,
    },
    {
      id: "A6",
      label: "Observability gap",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in information asymmetry or poor observability.`,
    },
    {
      id: "A7",
      label: "Platform fragmentation",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in access, distribution, or platform fragmentation.`,
    },
    {
      id: "A8",
      label: "Coordination failure",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in coordination failure or game-theoretic misalignment.`,
    },
    {
      id: "A9",
      label: "Hidden dependency",
      prompt: `Find one mechanism-first candidate in "${query}" rooted in a reverse-engineered exploit, hidden dependency, or system interaction.`,
    },
    {
      id: "A10",
      label: "Failure-mode inversion",
      prompt: `Find one mechanism-first candidate in "${query}" where the edge is hidden inside what breaks or destabilizes the system.`,
    },
  ];

  return {
    objective: query.trim() || "Answer the user's research prompt.",
    governingInterpretation:
      "Search for mechanistic, constraint-aware, persistence-aware candidates and reject anything vibe-based, analogical, or causally empty.",
    successCriteria: [
      "Return candidates with explicit assumptions, mechanism, constraints, incentives, persistence, measurement, and failure modes.",
      "Force every candidate to name a competitive moat or execution barrier.",
      "Favor first-principles system reasoning over summaries or category lists.",
      "Keep only finalists that survive elimination and calibration.",
    ],
    requiredReasoningSchema: buildFallbackReasoningSchema(),
    disqualifiers: [
      "Vibe-based or trend-based answers",
      "Category summaries without mechanism",
      "Authority-based claims without causal support",
      "Ideas without a measurable threshold or falsifier",
      "Ideas that cannot explain persistence or failure",
    ],
    commonTraps: [
      "Polished but causally empty responses",
      "Analogy standing in for mechanism",
      "Fake specificity hiding weak logic",
      "Duplicate variants of the same core idea",
    ],
    interpretations: [
      "Find the system-shaped mechanisms that actually survive contact with reality.",
      "Generate breadth first, then use elimination pressure to kill anything weak.",
      "Keep only finalists that can explain both persistence and failure.",
    ],
    searchAxes: axes,
    eliminationCriteria: buildFallbackEliminationCriteria(),
    outputShape:
      "Exactly 2 winners with clear mechanism, why they survived, why the other finalists were weaker, and calibrated uncertainty only if needed.",
  };
}

function normalizeAxes(value: unknown, fallbackAxes: ResearchSearchAxis[]) {
  const parsed = Array.isArray(value)
    ? value
        .map((entry, index) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const label = toNonEmptyString(record.label);
          const prompt = toNonEmptyString(record.prompt);
          const rawId = toNonEmptyString(record.id) || `A${index + 1}`;
          const id = rawId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16) || `A${index + 1}`;
          return label && prompt ? { id, label, prompt } : null;
        })
        .filter((entry): entry is ResearchSearchAxis => entry !== null)
    : [];

  const deduped = uniqueBy(parsed, (axis) => `${axis.label}:${axis.prompt}`);
  const combined = [...deduped];

  for (const fallback of fallbackAxes) {
    if (combined.length >= AXIS_COUNT) break;
    if (combined.some((axis) => axis.label.toLowerCase() === fallback.label.toLowerCase())) {
      continue;
    }

    combined.push({
      ...fallback,
      id: `A${combined.length + 1}`,
    });
  }

  return combined.slice(0, AXIS_COUNT).map((axis, index) => ({
    id: `A${index + 1}`,
    label: axis.label,
    prompt: axis.prompt,
  }));
}

function normalizeReasoningSchema(
  value: unknown,
  fallback: ResearchReasoningSchema
): ResearchReasoningSchema {
  if (typeof value !== "object" || value === null) return fallback;
  const record = value as Record<string, unknown>;

  return {
    candidateId: toNonEmptyString(record.candidateId) || fallback.candidateId,
    axis: toNonEmptyString(record.axis) || fallback.axis,
    system: toNonEmptyString(record.system) || fallback.system,
    inputs: toNonEmptyString(record.inputs) || fallback.inputs,
    assumption: toNonEmptyString(record.assumption) || fallback.assumption,
    mechanism: toNonEmptyString(record.mechanism) || fallback.mechanism,
    constraints: toNonEmptyString(record.constraints) || fallback.constraints,
    incentives: toNonEmptyString(record.incentives) || fallback.incentives,
    whyItPersists: toNonEmptyString(record.whyItPersists) || fallback.whyItPersists,
    failureModes: toNonEmptyString(record.failureModes) || fallback.failureModes,
    testOrFalsifier: toNonEmptyString(record.testOrFalsifier) || fallback.testOrFalsifier,
    measurementPlan:
      toNonEmptyString(record.measurementPlan) || fallback.measurementPlan,
    competitiveMoat:
      toNonEmptyString(record.competitiveMoat) || fallback.competitiveMoat,
    executionBarrier:
      toNonEmptyString(record.executionBarrier) || fallback.executionBarrier,
    confidence: toNonEmptyString(record.confidence) || fallback.confidence,
  };
}

function normalizeFatalFlawCategory(
  value: unknown,
  reason = ""
): ResearchFatalFlawCategory {
  const normalized = toNonEmptyString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (FATAL_FLAW_CATEGORIES.includes(normalized as ResearchFatalFlawCategory)) {
    return normalized as ResearchFatalFlawCategory;
  }

  const reasonText = normalizeComparableText(reason);
  if (reasonText.includes("frame") || reasonText.includes("governing interpretation")) {
    return "frame_violation";
  }
  if (reasonText.includes("mechanism") || reasonText.includes("causal")) {
    return "weak_mechanism";
  }
  if (reasonText.includes("constraint") || reasonText.includes("limit")) {
    return "missing_constraint";
  }
  if (reasonText.includes("incentive")) {
    return "incentive_mismatch";
  }
  if (reasonText.includes("persist") || reasonText.includes("durab")) {
    return "no_persistence";
  }
  if (reasonText.includes("fragile") || reasonText.includes("execution")) {
    return "fragile_execution";
  }
  if (reasonText.includes("failure") || reasonText.includes("downside")) {
    return "hidden_failure_surface";
  }
  if (reasonText.includes("duplicate") || reasonText.includes("weaker variant")) {
    return "duplicate_or_weaker_variant";
  }
  if (reasonText.includes("falsifier") || reasonText.includes("test")) {
    return "no_falsifier";
  }
  return "unsupported_claim";
}

function normalizeEliminationCriteria(
  value: unknown,
  fallback: ResearchEliminationCriteria
): ResearchEliminationCriteria {
  if (typeof value !== "object" || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const punish = normalizeStringArray(record.punish, 12);
  const parsedCategories = Array.isArray(record.fatalFlawCategories)
    ? uniqueBy(
        record.fatalFlawCategories
          .map((item) => normalizeFatalFlawCategory(item))
          .filter(Boolean),
        (item) => item
      )
    : [];

  return {
    punish: punish.length > 0 ? punish : fallback.punish,
    fatalFlawCategories:
      parsedCategories.length > 0 ? parsedCategories : fallback.fatalFlawCategories,
  };
}

function normalizeFrame(value: unknown, query: string): ResearchFrame {
  const fallback = buildFallbackFrame(query);
  if (typeof value !== "object" || value === null) return fallback;

  const record = value as Record<string, unknown>;
  const successCriteria = normalizeStringArray(record.successCriteria, 8);
  const disqualifiers = normalizeStringArray(record.disqualifiers, 8);
  const commonTraps = normalizeStringArray(record.commonTraps, 8);
  const interpretations = normalizeStringArray(record.interpretations, 4);

  return {
    objective: toNonEmptyString(record.objective) || fallback.objective,
    governingInterpretation:
      toNonEmptyString(record.governingInterpretation) || fallback.governingInterpretation,
    successCriteria: successCriteria.length > 0 ? successCriteria : fallback.successCriteria,
    requiredReasoningSchema: normalizeReasoningSchema(
      record.requiredReasoningSchema,
      fallback.requiredReasoningSchema
    ),
    disqualifiers: disqualifiers.length > 0 ? disqualifiers : fallback.disqualifiers,
    commonTraps: commonTraps.length > 0 ? commonTraps : fallback.commonTraps,
    interpretations: interpretations.length > 0 ? interpretations : fallback.interpretations,
    searchAxes: normalizeAxes(record.searchAxes, fallback.searchAxes),
    eliminationCriteria: normalizeEliminationCriteria(
      record.eliminationCriteria,
      fallback.eliminationCriteria
    ),
    outputShape: toNonEmptyString(record.outputShape) || fallback.outputShape,
  };
}

function formatReasoningSchema(schema: ResearchReasoningSchema) {
  return `Required reasoning schema:
- candidateId: ${schema.candidateId}
- axis: ${schema.axis}
- system: ${schema.system}
- inputs: ${schema.inputs}
- assumption: ${schema.assumption}
- mechanism: ${schema.mechanism}
- constraints: ${schema.constraints}
- incentives: ${schema.incentives}
- whyItPersists: ${schema.whyItPersists}
- failureModes: ${schema.failureModes}
- testOrFalsifier: ${schema.testOrFalsifier}
- measurementPlan: ${schema.measurementPlan}
- competitiveMoat: ${schema.competitiveMoat}
- executionBarrier: ${schema.executionBarrier}
- confidence: ${schema.confidence}`;
}

function formatEliminationCriteria(criteria: ResearchEliminationCriteria) {
  return `Elimination criteria:
Punish:
${criteria.punish.map((item) => `- ${item}`).join("\n")}

Fatal flaw categories:
${criteria.fatalFlawCategories.map((item) => `- ${item}`).join("\n")}`;
}

function formatFrame(frame: ResearchFrame) {
  return `Objective:
${frame.objective}

Governing interpretation:
${frame.governingInterpretation}

Success criteria:
${frame.successCriteria.map((item) => `- ${item}`).join("\n")}

Disqualifiers:
${frame.disqualifiers.map((item) => `- ${item}`).join("\n")}

Common traps:
${frame.commonTraps.map((item) => `- ${item}`).join("\n")}

Interpretations:
${frame.interpretations.map((item) => `- ${item}`).join("\n")}

${formatReasoningSchema(frame.requiredReasoningSchema)}

${formatEliminationCriteria(frame.eliminationCriteria)}

Output shape:
${frame.outputShape}`;
}

function formatCandidate(candidate: ResearchCandidate) {
  return `[${candidate.id}] ${candidate.candidate}
Axis: ${candidate.axisLabel}
System: ${candidate.system}
Inputs: ${candidate.inputs}
Assumption: ${candidate.assumption}
Mechanism: ${candidate.mechanism}
Constraints: ${candidate.constraints}
Incentives: ${candidate.incentives}
Why it persists: ${candidate.whyItPersists}
Failure modes: ${candidate.failureModes}
Test or falsifier: ${candidate.testOrFalsifier}
Measurement plan: ${candidate.measurementPlan}
Competitive moat: ${candidate.competitiveMoat}
Execution barrier: ${candidate.executionBarrier}
Confidence: ${candidate.confidence}`;
}

function normalizeCandidate(value: unknown, axis: ResearchSearchAxis): ResearchCandidate | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const candidate = toNonEmptyString(record.candidate);
  const mechanism = toNonEmptyString(record.mechanism);
  if (!candidate || !mechanism) return null;

  const missingFields = [
    !toNonEmptyString(record.system),
    !toNonEmptyString(record.inputs),
    !toNonEmptyString(record.assumption),
    !toNonEmptyString(record.constraints),
    !toNonEmptyString(record.incentives),
    !toNonEmptyString(record.whyItPersists),
    !toNonEmptyString(record.failureModes),
    !toNonEmptyString(record.testOrFalsifier),
    !toNonEmptyString(record.measurementPlan),
    !toNonEmptyString(record.competitiveMoat),
    !toNonEmptyString(record.executionBarrier),
  ].filter(Boolean).length;

  const normalizedConfidence =
    missingFields > 1 ? "low" : normalizeConfidence(record.confidence);

  return {
    id: axis.id,
    axisId: axis.id,
    axisLabel: axis.label,
    candidate,
    system:
      toNonEmptyString(record.system) ||
      "Not made explicit; weak by default because the system boundary is underspecified.",
    inputs:
      toNonEmptyString(record.inputs) ||
      "Not made explicit; weak by default because the required inputs are unclear.",
    assumption:
      toNonEmptyString(record.assumption) ||
      "No explicit assumption was named; weak by default until the core claim about reality is stated.",
    mechanism,
    constraints:
      toNonEmptyString(record.constraints) ||
      "Not made explicit; weak by default because the real limiting factors were not named.",
    incentives:
      toNonEmptyString(record.incentives) ||
      "Not made explicit; weak by default because participant incentives were not explained.",
    whyItPersists:
      toNonEmptyString(record.whyItPersists) ||
      "Not made explicit; weak by default because persistence was not defended.",
    failureModes:
      toNonEmptyString(record.failureModes) ||
      "Not made explicit; weak by default because the failure surface was not described.",
    testOrFalsifier:
      toNonEmptyString(record.testOrFalsifier) ||
      "No falsifier was provided; weak by default until one observable test is named.",
    measurementPlan:
      toNonEmptyString(record.measurementPlan) ||
      "No measurement plan was provided; weak by default until evidence collection is defined.",
    competitiveMoat:
      toNonEmptyString(record.competitiveMoat) ||
      "No competitive moat was provided; weak by default until it explains why others do not compress it.",
    executionBarrier:
      toNonEmptyString(record.executionBarrier) ||
      "No execution barrier was provided; weak by default until real-world friction is named.",
    confidence: normalizedConfidence,
  };
}

function normalizeJudgeKeeps(value: unknown, candidateIds: Set<string>): ResearchEliminationKeep[] {
  if (!Array.isArray(value)) return [];

  const keeps = value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const candidateId = toNonEmptyString(record.candidateId);
      const whyKept = toNonEmptyString(record.whyKept);
      const rank = record.rank;

      if (
        !candidateId ||
        !candidateIds.has(candidateId) ||
        (rank !== 1 && rank !== 2 && rank !== 3 && rank !== 4)
      ) {
        return null;
      }

      return {
        candidateId,
        rank,
        whyKept: whyKept || "The judge kept this candidate as one of the strongest finalists.",
      } satisfies ResearchEliminationKeep;
    })
    .filter((entry): entry is ResearchEliminationKeep => entry !== null)
    .sort((left, right) => left.rank - right.rank);

  const uniqueCandidates = uniqueBy(keeps, (item) => item.candidateId);
  const uniqueRanks = new Set(uniqueCandidates.map((item) => item.rank));

  if (uniqueCandidates.length !== FINALIST_COUNT || uniqueRanks.size !== FINALIST_COUNT) {
    return [];
  }

  return uniqueCandidates;
}

function normalizeJudgeRejected(
  value: unknown,
  candidateMap: Map<string, ResearchCandidate>,
  keptIds: Set<string>
): ResearchEliminationRejection[] {
  const parsed = Array.isArray(value)
    ? value
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const candidateId = toNonEmptyString(record.candidateId);
          if (!candidateId || keptIds.has(candidateId) || !candidateMap.has(candidateId)) {
            return null;
          }

          const fatalFlawReason =
            toNonEmptyString(record.fatalFlawReason) ||
            "Rejected because stronger candidates occupied the keep slots under this lens.";

          return {
            candidateId,
            fatalFlawCategory: normalizeFatalFlawCategory(
              record.fatalFlawCategory,
              fatalFlawReason
            ),
            fatalFlawReason,
          } satisfies ResearchEliminationRejection;
        })
        .filter((entry): entry is ResearchEliminationRejection => entry !== null)
    : [];

  const completed = [...parsed];

  for (const candidateId of candidateMap.keys()) {
    if (keptIds.has(candidateId) || completed.some((entry) => entry.candidateId === candidateId)) {
      continue;
    }

    completed.push({
      candidateId,
      fatalFlawCategory: "unsupported_claim",
      fatalFlawReason: "Rejected because this judge ranked other candidates above it.",
    });
  }

  return uniqueBy(completed, (entry) => entry.candidateId);
}

function normalizeJudgment(
  value: unknown,
  judge: (typeof ELIMINATION_JUDGES)[number],
  candidates: ResearchCandidate[]
): ResearchEliminationJudgment | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const kept = normalizeJudgeKeeps(record.kept, new Set(candidateMap.keys()));

  if (kept.length !== FINALIST_COUNT) return null;

  const keptIds = new Set(kept.map((entry) => entry.candidateId));

  return {
    judgeId: judge.judgeId,
    lens: judge.lens,
    summary:
      toNonEmptyString(record.summary) ||
      `${judge.lens} kept ${FINALIST_COUNT} candidates and rejected the rest.`,
    kept,
    rejected: normalizeJudgeRejected(record.rejected, candidateMap, keptIds),
  };
}

function buildDistinctnessMap(ranked: ResearchCandidate[]) {
  const clusters: Array<{
    id: string;
    representativeId: string;
    representative: ResearchCandidate;
    members: string[];
  }> = [];

  const candidateToCluster = new Map<string, string>();
  const clusterToRepresentative = new Map<string, string>();

  for (const candidate of ranked) {
    const existing = clusters.find((cluster) =>
      areNearDuplicateCandidates(candidate, cluster.representative)
    );

    if (existing) {
      candidateToCluster.set(candidate.id, existing.id);
      existing.members.push(candidate.id);
      continue;
    }

    const clusterId = `cluster-${clusters.length + 1}`;
    clusters.push({
      id: clusterId,
      representativeId: candidate.id,
      representative: candidate,
      members: [candidate.id],
    });
    candidateToCluster.set(candidate.id, clusterId);
    clusterToRepresentative.set(clusterId, candidate.id);
  }

  return {
    candidateToCluster,
    clusterToRepresentative,
  };
}

function buildFinalistFromCandidate(args: {
  candidate: ResearchCandidate;
  stats: CandidateConsensusStats;
  clusterId: string;
}): ResearchFinalist {
  const { candidate, stats, clusterId } = args;

  return {
    candidateId: candidate.id,
    axisId: candidate.axisId,
    axisLabel: candidate.axisLabel,
    candidate: candidate.candidate,
    system: candidate.system,
    inputs: candidate.inputs,
    assumption: candidate.assumption,
    mechanism: candidate.mechanism,
    constraints: candidate.constraints,
    incentives: candidate.incentives,
    whyItPersists: candidate.whyItPersists,
    failureModes: candidate.failureModes,
    testOrFalsifier: candidate.testOrFalsifier,
    measurementPlan: candidate.measurementPlan,
    competitiveMoat: candidate.competitiveMoat,
    executionBarrier: candidate.executionBarrier,
    totalScore: stats.totalScore,
    supportCount: stats.supportCount,
    averageRank: averageRank(stats.rankSum, stats.supportCount),
    advancedBecause: mostCommonReason(
      stats.keepReasons,
      "Advanced because it survived more elimination pressure than the rest of the field."
    ),
    mainObjections: uniqueBy(stats.rejectReasons, (reason) => reason).slice(0, 3),
    distinctnessCluster: clusterId,
  };
}

function buildHeuristicConsensus(
  candidates: ResearchCandidate[],
  eliminationJudgments: ResearchEliminationJudgment[],
  fallbackReason: string
): EliminationConsensusResult {
  const ranked = [...candidates].sort((left, right) => {
    const confidenceDelta = confidenceScore(right.confidence) - confidenceScore(left.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;
    return left.id.localeCompare(right.id);
  });

  const { candidateToCluster } = buildDistinctnessMap(ranked);
  const finalists: ResearchFinalist[] = [];
  const finalistIds = new Set<string>();
  const selectedClusters = new Set<string>();

  for (const candidate of ranked) {
    const clusterId = candidateToCluster.get(candidate.id) ?? candidate.id;
    if (selectedClusters.has(clusterId)) continue;
    finalists.push(
      buildFinalistFromCandidate({
        candidate,
        stats: {
          totalScore: Math.max(1, FINALIST_COUNT - finalists.length),
          supportCount: 0,
          rankSum: finalists.length + 1,
          keepReasons: [
            "Advanced by fallback heuristic because the elimination swarm did not return a full quorum.",
          ],
          rejectCategories: [],
          rejectReasons: [],
        },
        clusterId,
      })
    );
    finalistIds.add(candidate.id);
    selectedClusters.add(clusterId);
    if (finalists.length >= FINALIST_COUNT) break;
  }

  if (finalists.length < FINALIST_COUNT) {
    for (const candidate of ranked) {
      if (finalistIds.has(candidate.id)) continue;
      finalists.push(
        buildFinalistFromCandidate({
          candidate,
          stats: {
            totalScore: Math.max(1, FINALIST_COUNT - finalists.length),
            supportCount: 0,
            rankSum: finalists.length + 1,
            keepReasons: [
              "Advanced by fallback heuristic because there were not enough distinct candidates to fill the finalist set cleanly.",
            ],
            rejectCategories: [],
            rejectReasons: [],
          },
          clusterId: candidateToCluster.get(candidate.id) ?? candidate.id,
        })
      );
      finalistIds.add(candidate.id);
      if (finalists.length >= FINALIST_COUNT) break;
    }
  }

  return {
    eliminationJudgments,
    finalists,
    rejected: ranked
      .filter((candidate) => !finalistIds.has(candidate.id))
      .map((candidate) => ({
        candidateId: candidate.id,
        axisId: candidate.axisId,
        axisLabel: candidate.axisLabel,
        candidate: candidate.candidate,
        fatalFlawCategory: "duplicate_or_weaker_variant" as ResearchFatalFlawCategory,
        fatalFlawReason:
          "Rejected by fallback heuristic because stronger or more distinct candidates filled the finalist slots.",
      })),
    consensusSummary:
      "The elimination swarm fell back to a heuristic top-4 ranking because fewer than 3 judge outputs were usable.",
    fallbackReason,
  };
}

function aggregateConsensus(
  candidates: ResearchCandidate[],
  eliminationJudgments: ResearchEliminationJudgment[]
): EliminationConsensusResult {
  const stats = new Map(
    candidates.map((candidate) => [
      candidate.id,
      {
        totalScore: 0,
        supportCount: 0,
        rankSum: 0,
        keepReasons: [] as string[],
        rejectCategories: [] as ResearchFatalFlawCategory[],
        rejectReasons: [] as string[],
      } satisfies CandidateConsensusStats,
    ])
  );

  for (const judgment of eliminationJudgments) {
    for (const kept of judgment.kept) {
      const entry = stats.get(kept.candidateId);
      if (!entry) continue;
      entry.totalScore += FINALIST_COUNT + 1 - kept.rank;
      entry.supportCount += 1;
      entry.rankSum += kept.rank;
      entry.keepReasons.push(kept.whyKept);
    }

    for (const rejected of judgment.rejected) {
      const entry = stats.get(rejected.candidateId);
      if (!entry) continue;
      entry.rejectCategories.push(rejected.fatalFlawCategory);
      entry.rejectReasons.push(rejected.fatalFlawReason);
    }
  }

  const ranked = [...candidates].sort((left, right) => {
    const leftStats = stats.get(left.id)!;
    const rightStats = stats.get(right.id)!;
    if (rightStats.totalScore !== leftStats.totalScore) {
      return rightStats.totalScore - leftStats.totalScore;
    }
    if (rightStats.supportCount !== leftStats.supportCount) {
      return rightStats.supportCount - leftStats.supportCount;
    }

    const leftAverage = averageRank(leftStats.rankSum, leftStats.supportCount);
    const rightAverage = averageRank(rightStats.rankSum, rightStats.supportCount);
    if (leftAverage !== rightAverage) return leftAverage - rightAverage;
    return left.id.localeCompare(right.id);
  });

  const { candidateToCluster, clusterToRepresentative } = buildDistinctnessMap(ranked);
  const finalists: ResearchFinalist[] = [];
  const finalistIds = new Set<string>();
  const selectedClusters = new Set<string>();

  for (const candidate of ranked) {
    const clusterId = candidateToCluster.get(candidate.id) ?? candidate.id;
    const representativeId = clusterToRepresentative.get(clusterId) ?? candidate.id;
    if (candidate.id !== representativeId || selectedClusters.has(clusterId)) continue;

    finalists.push(
      buildFinalistFromCandidate({
        candidate,
        stats: stats.get(candidate.id)!,
        clusterId,
      })
    );
    finalistIds.add(candidate.id);
    selectedClusters.add(clusterId);
    if (finalists.length >= FINALIST_COUNT) break;
  }

  if (finalists.length < FINALIST_COUNT) {
    for (const candidate of ranked) {
      if (finalistIds.has(candidate.id)) continue;
      finalists.push(
        buildFinalistFromCandidate({
          candidate,
          stats: stats.get(candidate.id)!,
          clusterId: candidateToCluster.get(candidate.id) ?? candidate.id,
        })
      );
      finalistIds.add(candidate.id);
      if (finalists.length >= FINALIST_COUNT) break;
    }
  }

  const rejected = ranked
    .filter((candidate) => !finalistIds.has(candidate.id))
    .map((candidate) => {
      const entry = stats.get(candidate.id)!;
      const clusterId = candidateToCluster.get(candidate.id) ?? candidate.id;
      const representativeId = clusterToRepresentative.get(clusterId) ?? candidate.id;
      const duplicateSuppressed =
        representativeId !== candidate.id && finalistIds.has(representativeId);

      if (duplicateSuppressed) {
        return {
          candidateId: candidate.id,
          axisId: candidate.axisId,
          axisLabel: candidate.axisLabel,
          candidate: candidate.candidate,
          fatalFlawCategory: "duplicate_or_weaker_variant" as ResearchFatalFlawCategory,
          fatalFlawReason: `Rejected because it was a weaker near-duplicate of ${representativeId}, which survived distinctness enforcement.`,
        } satisfies ResearchRejected;
      }

      return {
        candidateId: candidate.id,
        axisId: candidate.axisId,
        axisLabel: candidate.axisLabel,
        candidate: candidate.candidate,
        fatalFlawCategory: mostCommonCategory(entry.rejectCategories, "unsupported_claim"),
        fatalFlawReason: mostCommonReason(
          entry.rejectReasons,
          "Rejected because the consensus scoring favored stronger finalists."
        ),
      } satisfies ResearchRejected;
    });

  const supportRange =
    finalists.length > 0
      ? `${Math.min(...finalists.map((candidate) => candidate.supportCount))}-${Math.max(
          ...finalists.map((candidate) => candidate.supportCount)
        )}`
      : "0-0";

  return {
    eliminationJudgments,
    finalists,
    rejected,
    consensusSummary: `${eliminationJudgments.length} of ${ELIMINATION_JUDGE_COUNT} elimination judges produced usable rankings. Consensus advanced ${finalists.length} distinct finalists from ${candidates.length} candidates with finalist support ranging from ${supportRange} judge picks.`,
  };
}

function buildTrace(args: {
  frame: ResearchFrame;
  generatedCandidates: ResearchCandidate[];
  consensus: EliminationConsensusResult;
  selectedCandidateIds: string[];
  verificationPacket: ResearchVerificationPacketEntry[];
  retryOccurred: boolean;
  retryFeedback?: ResearchRetryFeedback;
  failClosedReason?: string;
  fallbackReason?: string;
}): ResearchTrace {
  return {
    kind: "research",
    frame: args.frame,
    axes: args.frame.searchAxes,
    generatedCandidates: args.generatedCandidates,
    eliminationJudgments: args.consensus.eliminationJudgments,
    finalists: args.consensus.finalists,
    rejected: args.consensus.rejected,
    selectedCandidateIds: args.selectedCandidateIds,
    consensusSummary: args.consensus.consensusSummary,
    verificationPacket: args.verificationPacket,
    retryOccurred: args.retryOccurred,
    ...(args.retryFeedback ? { retryFeedback: args.retryFeedback } : {}),
    ...(args.failClosedReason ? { failClosedReason: args.failClosedReason } : {}),
    ...(args.fallbackReason ? { fallbackReason: args.fallbackReason } : {}),
  };
}

async function notifyProgress(onProgress: ProgressReporter | undefined, label: string) {
  if (!onProgress) return;
  await onProgress({ label });
}

function formatRepoContext(result: Awaited<ReturnType<typeof runRepoContextQueries>>) {
  const lines: string[] = [];

  for (const query of result.queries) {
    lines.push(`Repo query: ${query.query}`);
    if (query.matches.length === 0) {
      lines.push("- No repo matches found.");
      lines.push("");
      continue;
    }

    for (const match of query.matches) {
      lines.push(`- ${match.path}`);
      lines.push(`  ${match.snippet}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function formatWebContext(result: Awaited<ReturnType<typeof runSearchQueries>>) {
  const lines: string[] = [];

  for (const query of result.queries) {
    lines.push(`Web query: ${query.query}`);
    if (query.results.length === 0) {
      lines.push("- No web results found.");
      lines.push("");
      continue;
    }

    for (const item of query.results) {
      lines.push(`- ${item.title}`);
      lines.push(`  URL: ${item.url}`);
      if (item.description) {
        lines.push(`  ${item.description}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildVerificationQueries(
  query: string,
  finalists: ResearchFinalist[],
  mode: "repo" | "web"
) {
  const candidateQueries =
    mode === "repo"
      ? finalists.flatMap((finalist) => [
          finalist.axisLabel,
          finalist.candidate,
          `${finalist.system} ${finalist.candidate}`,
        ])
      : finalists.flatMap((finalist) => [
          finalist.candidate,
          `${finalist.system} ${finalist.assumption}`,
          `${finalist.candidate} ${finalist.measurementPlan}`,
        ]);

  return uniqueStrings([query, ...candidateQueries], 3);
}

async function gatherVerificationContext(args: {
  messages: ChatMessage[];
  finalists: ResearchFinalist[];
}): Promise<VerificationRetrievalOutcome> {
  const { messages, finalists } = args;
  const query = messages[messages.length - 1]?.content ?? "";

  if (looksCodebaseOrFileTask(messages)) {
    const queries = buildVerificationQueries(query, finalists, "repo");
    const repoContext = await runRepoContextQueries(queries);
    const sources = uniqueStrings(
      repoContext.queries.flatMap((item) => item.matches.map((match) => match.path)),
      6
    );
    const matchCount = repoContext.queries.reduce(
      (count, item) => count + item.matches.length,
      0
    );

    return {
      mode: "repo",
      queries,
      context: formatRepoContext(repoContext) || "No repo retrieval context was captured.",
      summary:
        matchCount > 0
          ? `Repo verification found ${matchCount} relevant file snippets.`
          : "Repo verification did not find relevant file snippets.",
      sources,
      limitations:
        !repoContext.available && repoContext.error
          ? [`Repo verification was limited: ${repoContext.error}`]
          : [],
      usedExternalEvidence: matchCount > 0,
    };
  }

  if (looksWebFactTask(messages)) {
    const queries = buildVerificationQueries(query, finalists, "web");
    const webContext = await runSearchQueries(queries, buildWebWindow(messages));
    const sources = uniqueStrings(
      webContext.queries.flatMap((item) =>
        item.results.map((result) => `${result.title} (${result.url})`)
      ),
      6
    );
    const resultCount = webContext.queries.reduce(
      (count, item) => count + item.results.length,
      0
    );

    return {
      mode: "web",
      queries,
      context: formatWebContext(webContext) || "No web verification context was captured.",
      summary:
        resultCount > 0
          ? `Web verification found ${resultCount} relevant external results.`
          : "Web verification did not find relevant external results.",
      sources,
      limitations:
        !webContext.available && webContext.error
          ? [`Web verification was limited: ${webContext.error}`]
          : [],
      usedExternalEvidence: resultCount > 0,
    };
  }

  return {
    mode: "thread",
    queries: [],
    context: "No external retrieval was used. Verification stayed inside the thread and candidate structure.",
    summary:
      "No external retrieval was needed, so verification should stay calibrated as plausible but unverified unless the logic materially breaks.",
    sources: [],
    limitations: [],
    usedExternalEvidence: false,
  };
}

async function runFrame(messages: ChatMessage[], rigor: Rigor) {
  const query = messages[messages.length - 1]?.content ?? "";
  console.log(`[Hydra][Research] frame:start | rigor=${rigor}`);

  const raw = await call(
    RESEARCH_MODELS.frame,
    [
      { role: "system", content: FRAME_PROMPT },
      {
        role: "user",
        content: `Conversation:
${formatConversation(messages)}

Additional guidance:
- Return exactly ${AXIS_COUNT} search axes.
- Keep the framing compact and operational.
- Balanced and Rigorous use the same topology; Rigorous should be stricter about invalid reasoning.
- Make the elimination criteria harsh enough that vibe-based candidates will die early.`,
      },
    ],
    {
      maxTokens: rigor === "rigorous" ? 1_550 : 1_250,
      temperature: 0.1,
      timeoutMs: FRAME_TIMEOUT_MS,
      reasoning: {
        effort: rigor === "rigorous" ? "low" : "minimal",
        exclude: true,
      },
    }
  );

  const frame = normalizeFrame(parseJSON<Record<string, unknown>>(raw, {}), query);
  console.log(
    `[Hydra][Research] frame:done | axes=${frame.searchAxes.length} | outputShape=${frame.outputShape.slice(0, 80)}`
  );
  return frame;
}

async function runCandidateSwarm(args: {
  frame: ResearchFrame;
  rigor: Rigor;
  verifierFeedback?: ResearchRetryFeedback;
}) {
  const { frame, rigor, verifierFeedback } = args;
  console.log(
    `[Hydra][Research] candidate-swarm:start | rigor=${rigor} | axes=${Math.min(frame.searchAxes.length, AXIS_COUNT)} | retry=${Boolean(verifierFeedback)}`
  );

  const settled = await Promise.allSettled(
    frame.searchAxes.slice(0, AXIS_COUNT).map(async (axis) => {
      const raw = await call(
        RESEARCH_MODELS.candidateSwarm,
        [
          { role: "system", content: CANDIDATE_PROMPT },
          {
            role: "user",
            content: `Framing object:
${formatFrame(frame)}

Assigned search axis:
${axis.label}

Axis prompt:
${axis.prompt}

${verifierFeedback
  ? `Verifier feedback from the failed round:
- Summary: ${verifierFeedback.summary}
- Failed assumptions: ${verifierFeedback.failedAssumptions.join(" | ") || "None captured"}
- Broken mechanisms: ${verifierFeedback.brokenMechanisms.join(" | ") || "None captured"}
- Missing measurement patterns: ${verifierFeedback.missingMeasurementPatterns.join(" | ") || "None captured"}
- Moat/execution mistakes: ${verifierFeedback.moatExecutionMistakes.join(" | ") || "None captured"}
- Disallowed weak patterns: ${verifierFeedback.disallowedWeakPatterns.join(" | ") || "None captured"}

`
  : ""}Additional guidance:
- Return exactly one candidate object.
- Mechanism matters more than creativity.
- Novelty without causal structure is worthless.
- A vague but stylish answer will be eliminated.
- Do not repeat mistakes called out in the verifier feedback.`,
          },
        ],
        {
          maxTokens: rigor === "rigorous" ? 950 : 775,
          temperature: rigor === "rigorous" ? 0.35 : 0.25,
          timeoutMs: CANDIDATE_SWARM_TIMEOUT_MS,
          reasoning: {
            effort: "none",
            exclude: true,
          },
        }
      );

      return normalizeCandidate(parseJSON<Record<string, unknown>>(raw, {}), axis);
    })
  );

  const candidates = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
  console.log(
    `[Hydra][Research] candidate-swarm:done | usable=${candidates.length}/${Math.min(frame.searchAxes.length, AXIS_COUNT)}`
  );
  return candidates;
}

async function runEliminationSwarm(args: {
  frame: ResearchFrame;
  candidates: ResearchCandidate[];
  rigor: Rigor;
}) {
  const { frame, candidates, rigor } = args;
  console.log(
    `[Hydra][Research] elimination-swarm:start | rigor=${rigor} | candidates=${candidates.length} | judges=${ELIMINATION_JUDGE_COUNT}`
  );

  const settled = await Promise.allSettled(
    ELIMINATION_JUDGES.map(async (judge) => {
      const raw = await call(
        RESEARCH_MODELS.eliminationSwarm,
        [
          { role: "system", content: ELIMINATION_PROMPT },
          {
            role: "user",
            content: `Framing object:
${formatFrame(frame)}

Judge lens:
${judge.lens}

Judge guidance:
${judge.guidance}

Candidate pool:
${candidates.map((candidate) => formatCandidate(candidate)).join("\n\n")}

Additional guidance:
- Keep exactly ${FINALIST_COUNT} candidates.
- Rank them 1 through ${FINALIST_COUNT}.
- Reject the remaining ${Math.max(0, candidates.length - FINALIST_COUNT)} candidates.
- Use the fatal flaw categories exactly.
- If two candidates are near-duplicates, keep only the stronger representative.`,
          },
        ],
        {
          maxTokens: rigor === "rigorous" ? 1_400 : 1_150,
          temperature: 0.1,
          timeoutMs: ELIMINATION_SWARM_TIMEOUT_MS,
          reasoning: {
            effort: rigor === "rigorous" ? "low" : "minimal",
            exclude: true,
          },
        }
      );

      return normalizeJudgment(parseJSON<Record<string, unknown>>(raw, {}), judge, candidates);
    })
  );

  const eliminationJudgments = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
  console.log(
    `[Hydra][Research] elimination-swarm:done | usable=${eliminationJudgments.length}/${ELIMINATION_JUDGE_COUNT}`
  );

  if (eliminationJudgments.length >= ELIMINATION_QUORUM) {
    const consensus = aggregateConsensus(candidates, eliminationJudgments);
    console.log(
      `[Hydra][Research] consensus:done | finalists=${consensus.finalists.length} | rejected=${consensus.rejected.length}`
    );
    return consensus;
  }

  const heuristic = buildHeuristicConsensus(
    candidates,
    eliminationJudgments,
    `Only ${eliminationJudgments.length} of ${ELIMINATION_JUDGE_COUNT} elimination judges returned usable outputs, so Hydra fell back to a heuristic top-4 shortlist.`
  );
  console.log(
    `[Hydra][Research] consensus:heuristic | finalists=${heuristic.finalists.length} | rejected=${heuristic.rejected.length}`
  );
  return heuristic;
}

async function runSynthesize(args: {
  frame: ResearchFrame;
  finalists: ResearchFinalist[];
  rejected: ResearchRejected[];
  consensusSummary: string;
  rigor: Rigor;
  fallbackReason?: string;
}) {
  const { frame, finalists, rejected, consensusSummary, rigor, fallbackReason } = args;

  const raw = await call(
    RESEARCH_MODELS.synthesize,
    [
      { role: "system", content: SYNTHESIZE_PROMPT },
      {
        role: "user",
        content: `Framing object:
${formatFrame(frame)}

Consensus finalists:
${finalists
  .map(
    (finalist) => `[${finalist.candidateId}] ${finalist.candidate}
Axis: ${finalist.axisLabel}
System: ${finalist.system}
Inputs: ${finalist.inputs}
Assumption: ${finalist.assumption}
Mechanism: ${finalist.mechanism}
Constraints: ${finalist.constraints}
Incentives: ${finalist.incentives}
Why it persists: ${finalist.whyItPersists}
Failure modes: ${finalist.failureModes}
Test or falsifier: ${finalist.testOrFalsifier}
Measurement plan: ${finalist.measurementPlan}
Competitive moat: ${finalist.competitiveMoat}
Execution barrier: ${finalist.executionBarrier}
Total score: ${finalist.totalScore}
Support count: ${finalist.supportCount}
Average rank: ${finalist.averageRank}
Advanced because: ${finalist.advancedBecause}
Main objections: ${finalist.mainObjections.join(" | ") || "None captured"}`
  )
  .join("\n\n")}

Compact rejection summary:
${rejected
  .slice(0, 8)
  .map((item) => `- ${item.candidateId} (${item.fatalFlawCategory}): ${item.fatalFlawReason}`)
  .join("\n") || "- No rejected candidates were captured."}

Consensus summary:
${consensusSummary}

${fallbackReason ? `Fallback reason:\n${fallbackReason}\n\n` : ""}Additional guidance:
- Select exactly ${Math.min(SELECTED_COUNT, finalists.length)} finalists.
- Follow this output shape: ${frame.outputShape}`,
      },
    ],
    {
      maxTokens: rigor === "rigorous" ? 2_100 : 1_700,
      temperature: 0.2,
      timeoutMs: SYNTHESIZE_TIMEOUT_MS,
      reasoning: {
        effort: rigor === "rigorous" ? "low" : "minimal",
        exclude: true,
      },
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const validFinalistIds = new Set(finalists.map((candidate) => candidate.candidateId));
  const selectedCandidateIds = Array.isArray(parsed.selectedCandidateIds)
    ? (parsed.selectedCandidateIds as unknown[])
        .filter((item): item is string => typeof item === "string" && validFinalistIds.has(item))
        .slice(0, SELECTED_COUNT)
    : [];

  return {
    answer: toNonEmptyString(parsed.answer) || raw.trim(),
    selectedCandidateIds:
      selectedCandidateIds.length > 0
        ? selectedCandidateIds
        : finalists.slice(0, SELECTED_COUNT).map((candidate) => candidate.candidateId),
  } satisfies SynthesizedResearchAnswer;
}

function normalizeGoNoGoDecision(
  value: unknown,
  verificationStatus: ResearchVerificationPacketEntry["verificationStatus"]
): ResearchGoNoGoDecision {
  const normalized = toNonEmptyString(value).toLowerCase().replace(/\s+/g, "-");
  const candidate =
    normalized === "go" || normalized === "watch" || normalized === "no-go"
      ? normalized
      : verificationStatus === "confirmed"
        ? "go"
        : verificationStatus === "contradicted"
          ? "no-go"
          : "watch";

  if (verificationStatus === "contradicted") return "no-go";
  if (verificationStatus === "confirmed" && candidate === "no-go") return "watch";
  return candidate;
}

function buildDefaultVerificationEntry(
  finalist: ResearchFinalist,
  retrieval: VerificationRetrievalOutcome
): ResearchVerificationPacketEntry {
  return {
    candidateId: finalist.candidateId,
    assumptionCheck:
      retrieval.usedExternalEvidence
        ? `The assumption needs stronger grounding against the retrieved evidence: ${finalist.assumption}`
        : `The assumption remains plausible but unverified without external grounding: ${finalist.assumption}`,
    mechanismCheck:
      "The mechanism stayed structurally coherent, but it still needs evidence beyond the candidate narrative.",
    measurementCheck:
      finalist.measurementPlan ||
      "No concrete measurement plan was captured, so the claim remains weakly grounded.",
    evidenceSummary: retrieval.summary,
    executionFeasibilityCheck:
      finalist.executionBarrier ||
      "Execution feasibility is still unclear because the practical barrier was not made explicit.",
    constraintCheck:
      finalist.constraints ||
      "Constraint realism was not made explicit enough to clear verification.",
    persistenceCheck:
      finalist.whyItPersists ||
      "Persistence was not defended strongly enough to clear verification.",
    failureModeCheck:
      finalist.failureModes ||
      "Failure modes were not detailed enough to clear verification.",
    competitiveMoatCheck:
      finalist.competitiveMoat ||
      "Competitive moat was not made explicit enough to justify durability.",
    legalCompliancePolicyFlag: "No explicit flag noted.",
    falsificationCriterion:
      finalist.testOrFalsifier ||
      "If the core measurement plan does not support the claim, treat the candidate as invalid.",
    viabilityThreshold:
      finalist.measurementPlan ||
      "Require the measurement plan to show a durable edge net of execution friction before moving from watch to go.",
    goNoGoDecision: "watch",
    verificationStatus: "plausible_but_unverified",
    verificationSources: retrieval.sources.slice(0, 4),
  };
}

function normalizeVerificationPacket(
  value: unknown,
  finalists: ResearchFinalist[],
  retrieval: VerificationRetrievalOutcome
) {
  const finalistMap = new Map(finalists.map((finalist) => [finalist.candidateId, finalist]));
  const parsed = Array.isArray(value)
    ? value
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const candidateId = toNonEmptyString(record.candidateId);
          const finalist = finalistMap.get(candidateId);
          let verificationStatus =
            record.verificationStatus as ResearchVerificationPacketEntry["verificationStatus"];

          if (
            !candidateId ||
            !finalist ||
            (verificationStatus !== "confirmed" &&
              verificationStatus !== "plausible_but_unverified" &&
              verificationStatus !== "contradicted")
          ) {
            return null;
          }

          let verificationSources = normalizeStringArray(record.verificationSources, 6);
          if (verificationSources.length === 0 && retrieval.sources.length > 0) {
            verificationSources = retrieval.sources.slice(0, 4);
          }

          const evidenceSummary =
            toNonEmptyString(record.evidenceSummary) ||
            retrieval.summary ||
            "No explicit evidence summary was captured.";

          if (
            verificationStatus === "confirmed" &&
            (!retrieval.usedExternalEvidence ||
              verificationSources.length === 0 ||
              !evidenceSummary)
          ) {
            verificationStatus = "plausible_but_unverified";
          }

          return {
            candidateId,
            assumptionCheck:
              toNonEmptyString(record.assumptionCheck) ||
              `The assumption still needs sharper grounding: ${finalist.assumption}`,
            mechanismCheck:
              toNonEmptyString(record.mechanismCheck) ||
              "Mechanism was not fully checked; treat as plausible but unverified.",
            measurementCheck:
              toNonEmptyString(record.measurementCheck) ||
              finalist.measurementPlan ||
              "Measurement was not fully checked; treat as plausible but unverified.",
            evidenceSummary,
            executionFeasibilityCheck:
              toNonEmptyString(record.executionFeasibilityCheck) ||
              finalist.executionBarrier ||
              "Execution feasibility was not fully checked; treat as plausible but unverified.",
            constraintCheck:
              toNonEmptyString(record.constraintCheck) ||
              finalist.constraints ||
              "Constraints were not fully checked; treat as plausible but unverified.",
            persistenceCheck:
              toNonEmptyString(record.persistenceCheck) ||
              finalist.whyItPersists ||
              "Persistence was not fully checked; treat as plausible but unverified.",
            failureModeCheck:
              toNonEmptyString(record.failureModeCheck) ||
              finalist.failureModes ||
              "Failure modes were not fully checked; treat as plausible but unverified.",
            competitiveMoatCheck:
              toNonEmptyString(record.competitiveMoatCheck) ||
              finalist.competitiveMoat ||
              "Competitive moat was not fully checked; treat as plausible but unverified.",
            legalCompliancePolicyFlag:
              toNonEmptyString(record.legalCompliancePolicyFlag) || "No explicit flag noted.",
            falsificationCriterion:
              toNonEmptyString(record.falsificationCriterion) ||
              finalist.testOrFalsifier ||
              "If the core measurement plan fails, treat the candidate as invalid.",
            viabilityThreshold:
              toNonEmptyString(record.viabilityThreshold) ||
              finalist.measurementPlan ||
              "Require external evidence to clear the measurement plan before moving to execution.",
            goNoGoDecision: normalizeGoNoGoDecision(record.goNoGoDecision, verificationStatus),
            verificationStatus,
            verificationSources,
          } satisfies ResearchVerificationPacketEntry;
        })
        .filter((entry): entry is ResearchVerificationPacketEntry => entry !== null)
    : [];

  const entries = uniqueBy(parsed, (entry) => entry.candidateId);
  for (const finalist of finalists) {
    if (entries.some((entry) => entry.candidateId === finalist.candidateId)) continue;
    entries.push(buildDefaultVerificationEntry(finalist, retrieval));
  }

  return entries;
}

async function runVerify(args: {
  messages: ChatMessage[];
  frame: ResearchFrame;
  finalists: ResearchFinalist[];
  rigor: Rigor;
}): Promise<VerificationRunResult> {
  const { messages, frame, finalists, rigor } = args;
  if (finalists.length === 0) {
    return {
      packet: [],
      retrieval: {
        mode: "thread",
        queries: [],
        context: "No finalists were provided for verification.",
        summary: "No finalists were provided for verification.",
        sources: [],
        limitations: [],
        usedExternalEvidence: false,
      },
    };
  }

  console.log(
    `[Hydra][Research] verify:start | rigor=${rigor} | finalists=${finalists.length}`
  );
  const retrieval = await gatherVerificationContext({ messages, finalists });
  const raw = await call(
    RESEARCH_MODELS.verify,
    [
      { role: "system", content: VERIFY_PROMPT },
      {
        role: "user",
        content: `Framing object:
${formatFrame(frame)}

Verification mode:
${retrieval.mode}

Verification queries:
${retrieval.queries.length > 0 ? retrieval.queries.join(" | ") : "None"}

Evidence summary:
${retrieval.summary}

Retrieved evidence:
${retrieval.context}

Known limitations:
${retrieval.limitations.length > 0 ? retrieval.limitations.map((item) => `- ${item}`).join("\n") : "- None named"}

Selected finalists to verify:
${finalists
  .map(
    (finalist) => `[${finalist.candidateId}] ${finalist.candidate}
Axis: ${finalist.axisLabel}
System: ${finalist.system}
Inputs: ${finalist.inputs}
Assumption: ${finalist.assumption}
Mechanism: ${finalist.mechanism}
Constraints: ${finalist.constraints}
Incentives: ${finalist.incentives}
Why it persists: ${finalist.whyItPersists}
Failure modes: ${finalist.failureModes}
Test or falsifier: ${finalist.testOrFalsifier}
Measurement plan: ${finalist.measurementPlan}
Competitive moat: ${finalist.competitiveMoat}
Execution barrier: ${finalist.executionBarrier}
Advanced because: ${finalist.advancedBecause}
Main objections: ${finalist.mainObjections.join(" | ") || "None captured"}`
  )
  .join("\n\n")}

Additional guidance:
- Be skeptical.
- If retrieval mode is thread-only, use plausible_but_unverified unless the story materially breaks.
- Confirmed requires evidence that actually supports the claim.
- Use the measurement plan to derive the viability threshold.
- Use the test or falsifier to derive the falsification criterion.`,
      },
    ],
    {
      maxTokens: rigor === "rigorous" ? 1_900 : 1_500,
      temperature: 0.15,
      timeoutMs: VERIFY_TIMEOUT_MS,
      reasoning: {
        effort: rigor === "rigorous" ? "low" : "minimal",
        exclude: true,
      },
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const packet = normalizeVerificationPacket(parsed.packet, finalists, retrieval);
  console.log(
    `[Hydra][Research] verify:done | mode=${retrieval.mode} | packet=${packet.length} | external=${retrieval.usedExternalEvidence}`
  );
  return {
    packet,
    retrieval,
  };
}

function formatDecisionForUser(decision: ResearchGoNoGoDecision | undefined) {
  if (decision === "go") return "Go";
  if (decision === "no-go") return "No-go";
  return "Watchlist";
}

function sanitizeResearchUserText(value: string) {
  return value
    .replace(/(^|\n)\s*\d+\.\s*/g, "$1")
    .replace(/(^|\n)\s*[-*]\s*/g, "$1")
    .replace(/\[(A\d+)\]\s*/g, "")
    .replace(/\bA\d+\b/g, "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function compactResearchLine(value: string, fallback: string, maxLength = 220) {
  const sanitized = sanitizeResearchUserText(value || fallback);
  if (!sanitized) return sanitizeResearchUserText(fallback);

  const withoutLeadNumbering = sanitized.replace(/^(?:\d+\.\s*)+/, "").trim();
  if (withoutLeadNumbering.length <= maxLength) {
    return withoutLeadNumbering;
  }

  const clipped = withoutLeadNumbering.slice(0, maxLength);
  const boundary = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("; "),
    clipped.lastIndexOf(", ")
  );

  return `${(boundary > 80 ? clipped.slice(0, boundary) : clipped).trim()}.`;
}

function firstSentence(value: string, fallback: string) {
  const sanitized = compactResearchLine(value, fallback, 260);
  if (!sanitized) return fallback;
  const match = sanitized.match(/.+?[.!?](?:\s|$)/);
  return match?.[0]?.trim() || sanitized;
}

function softenUnverifiedLine(value: string, fallback: string) {
  const sanitized = sanitizeResearchUserText(value || fallback);
  if (!sanitized) return sanitizeResearchUserText(fallback);

  return sanitized
    .replace(/[$€£]\s?\d[\d,.]*(?:\s?(?:[kKmMbB]|million|billion))?/g, "meaningful capital")
    .replace(/\b\d+(?:\.\d+)?\s*(?:-|to)\s*\d+(?:\.\d+)?%/g, "a meaningful spread")
    .replace(/\b\d+(?:\.\d+)?%/g, "a measurable threshold")
    .replace(/[<>]=?\s*\d+(?:\.\d+)?%?/g, "the required threshold")
    .replace(/\b(?:IRS|IRC|Sec(?:tion)?|§)\s*[A-Za-z0-9()./_-]+\b/gi, "a cited regulatory constraint");
}

function formatThresholdForUser(
  verification: ResearchVerificationPacketEntry | undefined,
  candidate: ResearchFinalist
) {
  if (verification?.verificationStatus === "confirmed") {
    return compactResearchLine(
      verification.viabilityThreshold || candidate.measurementPlan,
      "Grounded threshold not captured.",
      240
    );
  }

  return `Still needs live validation. Start by checking: ${softenUnverifiedLine(
    candidate.measurementPlan,
    "a live measurement plan tied to the core mechanism"
  )}`;
}

function formatFalsifierForUser(
  verification: ResearchVerificationPacketEntry | undefined,
  candidate: ResearchFinalist
) {
  const source = verification?.falsificationCriterion || candidate.testOrFalsifier;
  return compactResearchLine(
    softenUnverifiedLine(
      source,
      "If the measurement plan fails to support the mechanism, reject the idea."
    ),
    "If the measurement plan fails to support the mechanism, reject the idea.",
    220
  );
}

function buildOtherFinalistsLine(others: ResearchFinalist[]) {
  if (others.length === 0) {
    return "The rest of the field didn’t add a stronger alternative.";
  }

  const parts = others.map((candidate) => {
    const title = sanitizeResearchUserText(candidate.candidate) || "another finalist";
    const objection = firstSentence(
      candidate.mainObjections[0] || "",
      "it carried more unresolved objections."
    ).replace(/^it carried\s+/i, "");

    return `${title} had ${objection}`;
  });

  return `The others fell short because ${parts.join("; ")}.`;
}

function buildResearchIntro(packet: ResearchVerificationPacketEntry[]) {
  if (packet.some((entry) => entry.verificationStatus === "confirmed")) {
    return "Here are the two strongest opportunities after the tournament and verification pass.";
  }

  return "Here are the two strongest leads right now. They’re promising, but they still need real-world validation before you’d act on them.";
}

function buildVerificationFallbackAnswer(args: {
  finalists: ResearchFinalist[];
  selectedCandidateIds: string[];
  verificationPacket: ResearchVerificationPacketEntry[];
  explicitNoSecondWinner?: boolean;
}) {
  const finalistMap = new Map(args.finalists.map((item) => [item.candidateId, item]));
  const verificationMap = new Map(
    args.verificationPacket.map((item) => [item.candidateId, item])
  );
  const selected = args.selectedCandidateIds
    .map((candidateId) => finalistMap.get(candidateId))
    .filter((candidate): candidate is ResearchFinalist => Boolean(candidate));
  const others = args.finalists.filter(
    (candidate) => !args.selectedCandidateIds.includes(candidate.candidateId)
  );

  const winnerLines = selected.map((candidate, index) => {
    const verification = verificationMap.get(candidate.candidateId);
    const title = sanitizeResearchUserText(candidate.candidate) || `Winner ${index + 1}`;
    const mechanism =
      verification?.verificationStatus === "confirmed"
        ? compactResearchLine(candidate.mechanism, "Grounded mechanism not captured.", 260)
        : compactResearchLine(
            candidate.mechanism,
            "The mechanism still needs live validation before it should be treated as executable.",
            200
          );
    const whyItSurvived = compactResearchLine(
      candidate.advancedBecause,
      "It kept more of the mechanism and constraint story intact than the rest of the field.",
      180
    );
    return `${index + 1}. ${title}
How it works: ${mechanism}
Why it made the cut: ${whyItSurvived}
Status: ${formatDecisionForUser(verification?.goNoGoDecision)}
What you’d need to see before acting: ${formatThresholdForUser(verification, candidate)}
What would disprove it: ${formatFalsifierForUser(verification, candidate)}`;
  });

  const singleWinnerLine = args.explicitNoSecondWinner
    ? "No second candidate cleared verification strongly enough to surface as a winner."
    : "";

  return [
    buildResearchIntro(args.verificationPacket),
    winnerLines.join("\n\n"),
    singleWinnerLine,
    buildOtherFinalistsLine(others),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runFinalize(args: {
  frame: ResearchFrame;
  finalists: ResearchFinalist[];
  selectedCandidateIds: string[];
  verificationPacket: ResearchVerificationPacketEntry[];
  rigor: Rigor;
  explicitNoSecondWinner?: boolean;
}) {
  const {
    frame,
    finalists,
    selectedCandidateIds,
    verificationPacket,
    rigor,
    explicitNoSecondWinner,
  } = args;
  const finalistMap = new Map(finalists.map((finalist) => [finalist.candidateId, finalist]));
  const selectedFinalists = selectedCandidateIds
    .map((candidateId) => finalistMap.get(candidateId))
    .filter((candidate): candidate is ResearchFinalist => Boolean(candidate));
  const otherFinalists = finalists.filter(
    (candidate) => !selectedCandidateIds.includes(candidate.candidateId)
  );

  if (selectedFinalists.length === 0) return "";
  void frame;
  void rigor;
  void otherFinalists;
  return buildVerificationFallbackAnswer({
    finalists,
    selectedCandidateIds,
    verificationPacket,
    explicitNoSecondWinner,
  });
}

function buildVerifierFeedback(args: {
  selectedFinalists: ResearchFinalist[];
  verificationPacket: ResearchVerificationPacketEntry[];
}): ResearchRetryFeedback {
  const problematicEntries = args.verificationPacket.filter(
    (entry) => entry.verificationStatus !== "confirmed" || entry.goNoGoDecision !== "go"
  );
  const finalistMap = new Map(
    args.selectedFinalists.map((finalist) => [finalist.candidateId, finalist])
  );

  return {
    summary:
      problematicEntries.length > 0
        ? "The first winner set failed because one or more candidates could not clear measured verification."
        : "The first winner set did not clear measured verification cleanly.",
    failedAssumptions: uniqueStrings(
      problematicEntries.map((entry) => entry.assumptionCheck),
      5
    ),
    brokenMechanisms: uniqueStrings(
      problematicEntries.map((entry) => entry.mechanismCheck),
      5
    ),
    missingMeasurementPatterns: uniqueStrings(
      problematicEntries.map(
        (entry) => `${entry.measurementCheck} Threshold: ${entry.viabilityThreshold}`
      ),
      5
    ),
    moatExecutionMistakes: uniqueStrings(
      problematicEntries.map(
        (entry) =>
          `${entry.competitiveMoatCheck} Execution: ${entry.executionFeasibilityCheck}`
      ),
      5
    ),
    disallowedWeakPatterns: uniqueStrings(
      [
        "Do not rely on analogy, authority, or trend language in place of mechanism.",
        "Do not omit a concrete measurement plan or falsifier.",
        "Do not claim durability without a credible moat or execution barrier.",
        ...problematicEntries.flatMap((entry) => {
          const finalist = finalistMap.get(entry.candidateId);
          return finalist
            ? [`Do not repeat the failed pattern behind ${finalist.candidate}.`]
            : [];
        }),
      ],
      6
    ),
  };
}

function buildFailClosedAnswer(args: {
  query: string;
  verificationPacket: ResearchVerificationPacketEntry[];
  failClosedReason: string;
}) {
  const issueSummary =
    args.verificationPacket.length > 0
      ? args.verificationPacket
          .map(
            (entry) =>
              `${entry.candidateId} ended at ${entry.verificationStatus} with ${entry.goNoGoDecision}.`
          )
          .join(" ")
      : "No candidate cleared verification strongly enough to surface.";

  return `No candidate cleared verification strongly enough to recommend action on "${args.query.trim() || "this prompt"}". ${args.failClosedReason}

${issueSummary}`;
}

async function selectVerifiedWinners(args: {
  messages: ChatMessage[];
  frame: ResearchFrame;
  finalists: ResearchFinalist[];
  initialSelectedCandidateIds: string[];
  rigor: Rigor;
}) {
  const { messages, frame, finalists, initialSelectedCandidateIds, rigor } = args;
  const finalistMap = new Map(finalists.map((candidate) => [candidate.candidateId, candidate]));
  const finalistOrder = finalists.map((candidate) => candidate.candidateId);

  const selectedCandidateIds =
    initialSelectedCandidateIds.length > 0
      ? uniqueStrings(
          initialSelectedCandidateIds.filter((candidateId) => finalistMap.has(candidateId)),
          SELECTED_COUNT
        )
      : finalistOrder.slice(0, SELECTED_COUNT);

  const verificationResult = await runVerify({
    messages,
    frame,
    finalists,
    rigor,
  });
  const verificationMap = new Map(
    verificationResult.packet.map((entry) => [entry.candidateId, entry] as const)
  );

  const viableSelected: string[] = [];
  for (const candidateId of selectedCandidateIds) {
    const status = verificationMap.get(candidateId)?.verificationStatus;
    if (status && status !== "contradicted" && !viableSelected.includes(candidateId)) {
      viableSelected.push(candidateId);
    }
  }

  if (viableSelected.length < SELECTED_COUNT) {
    for (const candidateId of finalistOrder) {
      if (viableSelected.includes(candidateId)) continue;
      const status = verificationMap.get(candidateId)?.verificationStatus;
      if (status && status !== "contradicted") {
        viableSelected.push(candidateId);
      }
      if (viableSelected.length >= SELECTED_COUNT) break;
    }
  }

  const verificationPacket = finalistOrder
    .filter((candidateId) => verificationMap.has(candidateId))
    .map((candidateId) => verificationMap.get(candidateId)!)
    .filter(
      (entry, index, entries) =>
        entries.findIndex((item) => item.candidateId === entry.candidateId) === index
    );

  console.log(
    `[Hydra][Research] verify:selection | selected=${viableSelected.join(",") || "none"} | contradicted=${verificationPacket.filter((entry) => entry.verificationStatus === "contradicted").length}`
  );

  const verificationFallbackReason =
    viableSelected.length >= SELECTED_COUNT
      ? undefined
      : viableSelected.length === 1
        ? "Verification left only one non-contradicted winner after checking replacements."
        : "Verification contradicted the full winner set and no replacement candidate cleared the same checks.";

  return {
    selectedCandidateIds: viableSelected.slice(0, SELECTED_COUNT),
    verificationPacket,
    verificationFallbackReason,
    retryFeedback:
      viableSelected.length >= SELECTED_COUNT
        ? undefined
        : buildVerifierFeedback({
            selectedFinalists: finalists,
            verificationPacket,
          }),
  };
}

export async function draftResearch(
  messages: ChatMessage[],
  _rigor: Rigor = "balanced"
): Promise<EngineResponse> {
  void _rigor;
  const query = messages[messages.length - 1]?.content ?? "";
  if (!query.trim()) {
    return {
      content: RESEARCH_FALLBACK,
      status: "fallback",
      needsFollowup: false,
    };
  }

  return {
    content: RESEARCH_DRAFT,
    status: "draft",
    needsFollowup: true,
  };
}

export async function refineResearch(args: {
  messages: ChatMessage[];
  draft: string;
  rigor: Rigor;
  onProgress?: ProgressReporter;
}): Promise<EngineResponse> {
  const { messages, draft, rigor, onProgress } = args;
  const query = messages[messages.length - 1]?.content ?? "";
  const seed = draft.trim() || RESEARCH_FALLBACK;

  if (!query.trim()) {
    return {
      content: seed,
      status: "fallback",
      needsFollowup: false,
    };
  }

  await notifyProgress(onProgress, FRAME_STAGE);
  const frame = await runFrame(messages, rigor);

  let retryOccurred = false;
  let retryFeedback: ResearchRetryFeedback | undefined;
  let failClosedReason: string | undefined;
  let generatedCandidates: ResearchCandidate[] = [];
  let consensus: EliminationConsensusResult = {
    eliminationJudgments: [],
    finalists: [],
    rejected: [],
    consensusSummary: "Research did not reach consensus.",
  };
  let selectedCandidateIds: string[] = [];
  let verificationPacket: ResearchVerificationPacketEntry[] = [];
  const fallbackReasons: string[] = [];

  await notifyProgress(onProgress, CANDIDATE_SWARM_STAGE);
  generatedCandidates = await runCandidateSwarm({ frame, rigor });
  if (generatedCandidates.length < CANDIDATE_MINIMUM) {
    const fallbackReason = `Only ${generatedCandidates.length} of ${AXIS_COUNT} candidate workers returned usable outputs, so Hydra stopped before elimination.`;
    return {
      content: seed,
      status: "fallback",
      needsFollowup: false,
      trace: buildTrace({
        frame,
        generatedCandidates,
        consensus: {
          eliminationJudgments: [],
          finalists: [],
          rejected: [],
          consensusSummary:
            "Candidate swarm did not reach the minimum viable field for elimination.",
          fallbackReason,
        },
        selectedCandidateIds: [],
        verificationPacket: [],
        retryOccurred: false,
        fallbackReason,
      }),
    };
  }

  await notifyProgress(onProgress, ELIMINATION_SWARM_STAGE);
  consensus = await runEliminationSwarm({
    frame,
    candidates: generatedCandidates,
    rigor,
  });

  if (consensus.finalists.length === 0) {
    const fallbackReason =
      consensus.fallbackReason ||
      "The elimination swarm did not produce any usable finalists.";
    return {
      content: seed,
      status: "fallback",
      needsFollowup: false,
      trace: buildTrace({
        frame,
        generatedCandidates,
        consensus,
        selectedCandidateIds: [],
        verificationPacket: [],
        retryOccurred: false,
        fallbackReason,
      }),
    };
  }

  await notifyProgress(onProgress, SYNTHESIZE_STAGE);
  let synthesized = await runSynthesize({
    frame,
    finalists: consensus.finalists,
    rejected: consensus.rejected,
    consensusSummary: consensus.consensusSummary,
    rigor,
    fallbackReason: consensus.fallbackReason,
  });

  await notifyProgress(onProgress, VERIFY_STAGE);
  let selection = await selectVerifiedWinners({
    messages,
    frame,
    finalists: consensus.finalists,
    initialSelectedCandidateIds: synthesized.selectedCandidateIds,
    rigor,
  });

  if (consensus.fallbackReason) fallbackReasons.push(consensus.fallbackReason);
  if (selection.verificationFallbackReason) {
    fallbackReasons.push(selection.verificationFallbackReason);
  }

  selectedCandidateIds = selection.selectedCandidateIds;
  verificationPacket = selection.verificationPacket;

  if (selectedCandidateIds.length < SELECTED_COUNT && selection.retryFeedback) {
    retryOccurred = true;
    retryFeedback = selection.retryFeedback;

    generatedCandidates = await runCandidateSwarm({
      frame,
      rigor,
      verifierFeedback: retryFeedback,
    });

    if (generatedCandidates.length < CANDIDATE_MINIMUM) {
      const fallbackReason = `Only ${generatedCandidates.length} of ${AXIS_COUNT} retry candidate workers returned usable outputs after verifier feedback, so Hydra stopped before elimination.`;
      return {
        content: seed,
        status: "fallback",
        needsFollowup: false,
        trace: buildTrace({
          frame,
          generatedCandidates,
          consensus: {
            eliminationJudgments: [],
            finalists: [],
            rejected: [],
            consensusSummary:
              "Retry candidate swarm did not reach the minimum viable field for elimination.",
            fallbackReason,
          },
          selectedCandidateIds: [],
          verificationPacket,
          retryOccurred,
          retryFeedback,
          fallbackReason,
        }),
      };
    }

    consensus = await runEliminationSwarm({
      frame,
      candidates: generatedCandidates,
      rigor,
    });

    if (consensus.fallbackReason) fallbackReasons.push(consensus.fallbackReason);

    if (consensus.finalists.length === 0) {
      const fallbackReason =
        consensus.fallbackReason ||
        "The retry elimination swarm did not produce any usable finalists.";
      return {
        content: seed,
        status: "fallback",
        needsFollowup: false,
        trace: buildTrace({
          frame,
          generatedCandidates,
          consensus,
          selectedCandidateIds: [],
          verificationPacket,
          retryOccurred,
          retryFeedback,
          fallbackReason,
        }),
      };
    }

    synthesized = await runSynthesize({
      frame,
      finalists: consensus.finalists,
      rejected: consensus.rejected,
      consensusSummary: consensus.consensusSummary,
      rigor,
      fallbackReason: consensus.fallbackReason,
    });

    selection = await selectVerifiedWinners({
      messages,
      frame,
      finalists: consensus.finalists,
      initialSelectedCandidateIds: synthesized.selectedCandidateIds,
      rigor,
    });

    if (selection.verificationFallbackReason) {
      fallbackReasons.push(selection.verificationFallbackReason);
    }

    selectedCandidateIds = selection.selectedCandidateIds;
    verificationPacket = selection.verificationPacket;
  }

  if (selectedCandidateIds.length === 0) {
    failClosedReason =
      "Research failed closed because the winner set could not survive measured verification even after one retry.";

    const finalAnswer = buildFailClosedAnswer({
      query,
      verificationPacket,
      failClosedReason,
    });

    return {
      content: finalAnswer || seed,
      status: finalAnswer ? "final" : "fallback",
      needsFollowup: false,
      trace: buildTrace({
        frame,
        generatedCandidates,
        consensus,
        selectedCandidateIds,
        verificationPacket,
        retryOccurred,
        retryFeedback,
        failClosedReason,
        fallbackReason: fallbackReasons.join(" ") || undefined,
      }),
    };
  }

  const explicitNoSecondWinner = selectedCandidateIds.length < SELECTED_COUNT;
  const calibratedAnswer =
    (await runFinalize({
      frame,
      finalists: consensus.finalists,
      selectedCandidateIds,
      verificationPacket,
      rigor,
      explicitNoSecondWinner,
    })) ||
    buildVerificationFallbackAnswer({
      finalists: consensus.finalists,
      selectedCandidateIds,
      verificationPacket,
      explicitNoSecondWinner,
    });

  return {
    content: calibratedAnswer || seed,
    status: calibratedAnswer ? "final" : "fallback",
    needsFollowup: false,
    trace: buildTrace({
      frame,
      generatedCandidates,
      consensus,
      selectedCandidateIds,
      verificationPacket,
      retryOccurred,
      retryFeedback,
      ...(failClosedReason ? { failClosedReason } : {}),
      fallbackReason: fallbackReasons.join(" ") || undefined,
    }),
  };
}
