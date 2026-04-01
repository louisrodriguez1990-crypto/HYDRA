import { call, parseJSON } from "./openrouter";
import { MODELS } from "./models";
import { reviewAndRevise, type ReviewSpec } from "./verify";
import type { ChatMessage, CompoundTrace, CompoundTraceNode, EngineResponse, Rigor } from "./types";

const THINK_DRAFT_FALLBACK =
  "Hydra could not finish the deeper analysis within the serverless time budget. Please retry if you want another pass.";
const THINK_SUBPROBLEM_FALLBACK =
  "Hydra could not complete this subproblem within the request budget.";

const THINK_REVISION_INSTRUCTIONS = `Revise the answer so it is direct, grounded, and concise.
- Lead with the answer.
- Preserve the strongest tradeoffs and constraints.
- Keep the answer readable without sounding robotic.`;

const THINK_DECOMPOSE_PROMPT = `Decide whether this question should be split into a small dependency graph of analytical subproblems.

Rules:
- Only mark "divisible" true when decomposition will materially improve the answer.
- If divisible is true, return 2 or 3 subproblems maximum.
- Use "dependsOn" for dependencies.
- Each subproblem must be a real analytical question, not a restatement.
- Keep IDs short, like A, B, C.
- Prefer one dependency layer maximum.
- Output ONLY JSON with this shape:
{"divisible":true,"subproblems":[{"id":"A","question":"...","dependsOn":[]}]}
or
{"divisible":false,"subproblems":[]}`;

const SUBPROBLEM_PROPOSAL_PROMPT = `Solve exactly one subproblem within a larger analysis.

Rules:
- Answer only the assigned subproblem.
- Use dependency inputs when provided.
- Be concise, concrete, and grounded.
- Surface the most important tradeoff or constraint.
- Do not mention hidden reasoning or internal process.`;

const SUBPROBLEM_CRITIQUE_PROMPT = `Review this subproblem answer.

Rules:
- Find the strongest weakness, missing constraint, or incorrect assumption.
- Keep notes concise and actionable.
- Do not rewrite the answer.`;

const SUBPROBLEM_REVISION_PROMPT = `Revise the subproblem answer using the critique.

Rules:
- Keep the answer concise and direct.
- Fix only the highest-value issues.
- Preserve the strongest useful specifics.
- Do not mention reviewers or the revision process.`;

const THINK_MERGE_PROMPT = `Merge the subproblem analyses into one final answer.

Rules:
- Lead with the answer.
- Resolve conflicts between sub-answers.
- Explain where one sub-answer changes another.
- Surface what only becomes clear after combining them.
- Treat the original draft as a weak prior, not as ground truth.
- Keep the answer concise and readable.
- Do not expose internal reasoning steps or reviewer notes.`;

const FOLLOWUP_BUDGET_MS = 45_000;
const RESPONSE_RESERVE_MS = 5_000;
const DECOMPOSE_TIMEOUT_MS = 2_500;
const SUBPROBLEM_PROPOSAL_TIMEOUT_MS = 4_500;
const SUBPROBLEM_CRITIQUE_TIMEOUT_MS = 3_500;
const SUBPROBLEM_REVISION_TIMEOUT_MS = 4_500;
const MERGE_TIMEOUT_MS = 6_000;

const DECOMPOSE_MAX_TOKENS = 400;
const SUBPROBLEM_PROPOSAL_MAX_TOKENS = 900;
const SUBPROBLEM_CRITIQUE_MAX_TOKENS = 450;
const SUBPROBLEM_REVISION_MAX_TOKENS = 900;
const MERGE_MAX_TOKENS = 1_800;

interface ThinkSubproblem {
  id: string;
  question: string;
  dependsOn: string[];
}

interface DecompositionCandidate {
  divisible: boolean;
  subproblems?: unknown[];
}

interface TimeBudget {
  available: () => number;
  timeoutFor: (targetMs: number, minimumMs?: number) => number | null;
}

function buildDraftPrompt(query: string, rigorous: boolean) {
  return rigorous
    ? `Answer this quickly but systematically. Cover the main constraints, the best option, and the biggest tradeoff in one concise response.\n\n${query}`
    : `Give a strong first-pass answer. Keep it concise, but include the key tradeoff or caveat.\n\n${query}`;
}

function buildReviewSpecs(rigor: Rigor): ReviewSpec[] {
  const specs: ReviewSpec[] = [
    {
      label: "Critical Review",
      modelId: MODELS.critic.id,
      prompt: `Review the draft answer.
- Find the few highest-value issues.
- Focus on weak assumptions, shallow tradeoffs, or mistakes.
- Keep the notes concise and actionable.`,
    },
  ];

  if (rigor === "rigorous") {
    specs.push({
      label: "Coverage Review",
      modelId: MODELS.broad.id,
      prompt: `Audit the draft answer for missing constraints or incomplete tradeoff analysis.
- Do not rewrite the answer.
- Return only concise notes on what should change.`,
    });
  }

  return specs;
}

function createTimeBudget(totalMs: number, reserveMs: number): TimeBudget {
  const startedAt = Date.now();

  return {
    available() {
      return Math.max(0, totalMs - (Date.now() - startedAt) - reserveMs);
    },
    timeoutFor(targetMs: number, minimumMs = 1_000) {
      const availableMs = Math.max(0, totalMs - (Date.now() - startedAt) - reserveMs);
      if (availableMs < minimumMs) return null;
      return Math.min(targetMs, availableMs);
    },
  };
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDependsOn(value: unknown) {
  if (!Array.isArray(value)) return [];

  const dependsOn = value
    .map((item) => toNonEmptyString(item))
    .filter(Boolean);

  return [...new Set(dependsOn)];
}

function normalizeSubproblem(value: unknown): ThinkSubproblem | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const id = toNonEmptyString(record.id);
  const question = toNonEmptyString(record.question);
  const dependsOn = normalizeDependsOn(record.dependsOn ?? record.depends_on);

  if (!id || !question) return null;

  return { id, question, dependsOn };
}

function validateSubproblems(raw: unknown[]) {
  const subproblems = raw.map(normalizeSubproblem);
  if (subproblems.some((subproblem) => subproblem === null)) return null;

  const normalized = subproblems as ThinkSubproblem[];
  if (normalized.length < 2 || normalized.length > 3) return null;

  const ids = normalized.map((subproblem) => subproblem.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) return null;

  const subproblemMap = new Map(normalized.map((subproblem) => [subproblem.id, subproblem]));

  for (const subproblem of normalized) {
    if (subproblem.dependsOn.includes(subproblem.id)) return null;
    if (subproblem.dependsOn.some((dependencyId) => !subproblemMap.has(dependencyId))) {
      return null;
    }
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const getDepth = (subproblemId: string): number | null => {
    if (memo.has(subproblemId)) return memo.get(subproblemId) ?? 0;
    if (visiting.has(subproblemId)) return null;

    const subproblem = subproblemMap.get(subproblemId);
    if (!subproblem) return null;

    visiting.add(subproblemId);

    let depth = 0;
    for (const dependencyId of subproblem.dependsOn) {
      const dependencyDepth = getDepth(dependencyId);
      if (dependencyDepth === null) return null;
      depth = Math.max(depth, dependencyDepth + 1);
    }

    visiting.delete(subproblemId);
    memo.set(subproblemId, depth);
    return depth;
  };

  for (const subproblem of normalized) {
    const depth = getDepth(subproblem.id);
    if (depth === null || depth > 1) return null;
  }

  return normalized;
}

async function decomposeThink(query: string, budget: TimeBudget) {
  const timeoutMs = budget.timeoutFor(DECOMPOSE_TIMEOUT_MS, 800);
  if (timeoutMs === null) return null;

  const raw = await call(
    MODELS.fast.id,
    [
      { role: "system", content: THINK_DECOMPOSE_PROMPT },
      { role: "user", content: query },
    ],
    {
      maxTokens: DECOMPOSE_MAX_TOKENS,
      temperature: 0.1,
      timeoutMs,
    }
  );

  const parsed = parseJSON<DecompositionCandidate>(raw, {
    divisible: false,
    subproblems: [],
  });

  if (parsed.divisible !== true) return null;

  return validateSubproblems(parsed.subproblems ?? []);
}

function formatDependencyContext(
  subproblem: ThinkSubproblem,
  resolvedSubproblems: Map<string, CompoundTraceNode>
) {
  if (subproblem.dependsOn.length === 0) {
    return "None.";
  }

  return subproblem.dependsOn
    .map((dependencyId) => {
      const dependency = resolvedSubproblems.get(dependencyId);
      if (!dependency) {
        return `[${dependencyId}] unavailable`;
      }

      return `[${dependency.id}] (${dependency.status}) ${dependency.question}\n${dependency.answer}`;
    })
    .join("\n\n");
}

function buildSubproblemUserPrompt(
  query: string,
  subproblem: ThinkSubproblem,
  resolvedSubproblems: Map<string, CompoundTraceNode>
) {
  return `Original question:
${query}

Assigned subproblem [${subproblem.id}]:
${subproblem.question}

Dependency inputs:
${formatDependencyContext(subproblem, resolvedSubproblems)}`;
}

function buildPartialTraceNode(
  subproblem: ThinkSubproblem,
  answer: string,
  dependencyWasPartial = false
): CompoundTraceNode {
  return {
    id: subproblem.id,
    question: subproblem.question,
    dependsOn: subproblem.dependsOn,
    answer: answer.trim() || THINK_SUBPROBLEM_FALLBACK,
    status: dependencyWasPartial ? "partial" : "partial",
  };
}

async function solveSubproblem(args: {
  query: string;
  subproblem: ThinkSubproblem;
  resolvedSubproblems: Map<string, CompoundTraceNode>;
  budget: TimeBudget;
}) {
  const { query, subproblem, resolvedSubproblems, budget } = args;
  const dependencyWasPartial = subproblem.dependsOn.some((dependencyId) => {
    const dependency = resolvedSubproblems.get(dependencyId);
    return !dependency || dependency.status !== "complete";
  });
  const prompt = buildSubproblemUserPrompt(query, subproblem, resolvedSubproblems);

  const proposalTimeoutMs = budget.timeoutFor(SUBPROBLEM_PROPOSAL_TIMEOUT_MS);
  if (proposalTimeoutMs === null) {
    return buildPartialTraceNode(subproblem, "", dependencyWasPartial);
  }

  const proposal = await call(
    MODELS.broad.id,
    [
      { role: "system", content: SUBPROBLEM_PROPOSAL_PROMPT },
      { role: "user", content: prompt },
    ],
    {
      maxTokens: SUBPROBLEM_PROPOSAL_MAX_TOKENS,
      temperature: 0.35,
      timeoutMs: proposalTimeoutMs,
    }
  );

  if (!proposal.trim()) {
    return buildPartialTraceNode(subproblem, "", dependencyWasPartial);
  }

  const critiqueTimeoutMs = budget.timeoutFor(SUBPROBLEM_CRITIQUE_TIMEOUT_MS);
  if (critiqueTimeoutMs === null) {
    return buildPartialTraceNode(subproblem, proposal, dependencyWasPartial);
  }

  const critique = await call(
    MODELS.critic.id,
    [
      { role: "system", content: SUBPROBLEM_CRITIQUE_PROMPT },
      {
        role: "user",
        content: `${prompt}

Current subproblem answer:
${proposal}`,
      },
    ],
    {
      maxTokens: SUBPROBLEM_CRITIQUE_MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: critiqueTimeoutMs,
    }
  );

  if (!critique.trim()) {
    return buildPartialTraceNode(subproblem, proposal, dependencyWasPartial);
  }

  const revisionTimeoutMs = budget.timeoutFor(SUBPROBLEM_REVISION_TIMEOUT_MS);
  if (revisionTimeoutMs === null) {
    return buildPartialTraceNode(subproblem, proposal, dependencyWasPartial);
  }

  const revised = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: SUBPROBLEM_REVISION_PROMPT },
      {
        role: "user",
        content: `${prompt}

Current subproblem answer:
${proposal}

Critique:
${critique}`,
      },
    ],
    {
      maxTokens: SUBPROBLEM_REVISION_MAX_TOKENS,
      temperature: 0.25,
      timeoutMs: revisionTimeoutMs,
    }
  );

  if (!revised.trim()) {
    return buildPartialTraceNode(subproblem, proposal, dependencyWasPartial);
  }

  return {
    id: subproblem.id,
    question: subproblem.question,
    dependsOn: subproblem.dependsOn,
    answer: revised.trim(),
    status: dependencyWasPartial ? "partial" : "complete",
  } satisfies CompoundTraceNode;
}

function formatMergeInputs(subproblems: CompoundTraceNode[]) {
  return subproblems
    .map(
      (subproblem) => `[${subproblem.id}] (${subproblem.status})
Question: ${subproblem.question}
Dependencies: ${subproblem.dependsOn.length > 0 ? subproblem.dependsOn.join(", ") : "None"}
Answer: ${subproblem.answer}`
    )
    .join("\n\n");
}

function summarizeForFallback(answer: string) {
  const collapsed = answer.replace(/\s+/g, " ").trim();
  if (!collapsed) return THINK_SUBPROBLEM_FALLBACK;
  return collapsed.length > 180 ? `${collapsed.slice(0, 180).trimEnd()}...` : collapsed;
}

function buildBestAvailableThinkResponse(draft: string, traceNodes: CompoundTraceNode[]) {
  const completeNodes = traceNodes.filter((node) => node.answer.trim());
  if (completeNodes.length === 0) {
    return draft;
  }

  const findings = completeNodes
    .map((node) => `- [${node.id}] ${summarizeForFallback(node.answer)}`)
    .join("\n");

  return `${draft}\n\nBest available subproblem findings:\n${findings}`;
}

async function runCompoundThink(args: {
  query: string;
  draft: string;
  subproblems: ThinkSubproblem[];
  budget: TimeBudget;
}): Promise<EngineResponse> {
  const { query, draft, subproblems, budget } = args;
  const resolvedSubproblems = new Map<string, CompoundTraceNode>();
  const independentSubproblems = subproblems.filter((subproblem) => subproblem.dependsOn.length === 0);
  const dependentSubproblems = subproblems.filter((subproblem) => subproblem.dependsOn.length > 0);

  const independentResults = await Promise.all(
    independentSubproblems.map((subproblem) =>
      solveSubproblem({ query, subproblem, resolvedSubproblems, budget })
    )
  );

  independentResults.forEach((result) => {
    resolvedSubproblems.set(result.id, result);
  });

  if (dependentSubproblems.length > 0) {
    const dependentResults = await Promise.all(
      dependentSubproblems.map((subproblem) =>
        solveSubproblem({ query, subproblem, resolvedSubproblems, budget })
      )
    );

    dependentResults.forEach((result) => {
      resolvedSubproblems.set(result.id, result);
    });
  }

  const traceNodes = subproblems.map(
    (subproblem) =>
      resolvedSubproblems.get(subproblem.id) ??
      buildPartialTraceNode(subproblem, THINK_SUBPROBLEM_FALLBACK)
  );
  const trace: CompoundTrace = { kind: "compound", nodes: traceNodes };

  const mergeTimeoutMs = budget.timeoutFor(MERGE_TIMEOUT_MS, 1_200);
  if (mergeTimeoutMs === null) {
    return {
      content: buildBestAvailableThinkResponse(draft, traceNodes),
      status: "fallback",
      needsFollowup: false,
      trace,
    };
  }

  const merged = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: THINK_MERGE_PROMPT },
      {
        role: "user",
        content: `Original question:
${query}

Original draft (weak prior; correct or discard when needed):
${draft}

Subproblem results:
${formatMergeInputs(traceNodes)}`,
      },
    ],
    {
      maxTokens: MERGE_MAX_TOKENS,
      temperature: 0.25,
      timeoutMs: mergeTimeoutMs,
    }
  );

  if (!merged.trim()) {
    return {
      content: buildBestAvailableThinkResponse(draft, traceNodes),
      status: "fallback",
      needsFollowup: false,
      trace,
    };
  }

  return {
    content: merged.trim(),
    status: "final",
    needsFollowup: false,
    trace,
  };
}

export async function draftThink(
  messages: ChatMessage[],
  rigor: Rigor = "balanced"
): Promise<EngineResponse> {
  const query = messages[messages.length - 1]?.content ?? "";
  if (!query.trim()) {
    return {
      content: THINK_DRAFT_FALLBACK,
      status: "fallback",
      needsFollowup: false,
    };
  }

  const draft = await call(
    MODELS.broad.id,
    [
      ...messages.slice(0, -1),
      { role: "user", content: buildDraftPrompt(query, rigor === "rigorous") },
    ],
    {
      maxTokens: 1800,
      temperature: rigor === "rigorous" ? 0.3 : 0.45,
      timeoutMs: 18000,
    }
  );

  if (!draft.trim()) {
    return {
      content: THINK_DRAFT_FALLBACK,
      status: "fallback",
      needsFollowup: false,
    };
  }

  return {
    content: draft,
    status: "draft",
    needsFollowup: true,
  };
}

export async function refineThink(args: {
  messages: ChatMessage[];
  draft: string;
  rigor: Rigor;
}): Promise<EngineResponse> {
  const { messages, draft, rigor } = args;
  const query = messages[messages.length - 1]?.content ?? "";
  const seed = draft.trim() || THINK_DRAFT_FALLBACK;

  if (!query.trim()) {
    return {
      content: seed,
      status: "fallback",
      needsFollowup: false,
    };
  }

  if (rigor === "rigorous") {
    const budget = createTimeBudget(FOLLOWUP_BUDGET_MS, RESPONSE_RESERVE_MS);
    const decomposition = await decomposeThink(query, budget);

    if (decomposition && decomposition.length > 0) {
      return runCompoundThink({
        query,
        draft: seed,
        subproblems: decomposition,
        budget,
      });
    }
  }

  const revised = await reviewAndRevise({
    query,
    draft: seed,
    reviewSpecs: buildReviewSpecs(rigor),
    revisionInstructions: THINK_REVISION_INSTRUCTIONS,
  });

  return {
    content: revised.content,
    status: revised.revised ? "final" : "fallback",
    needsFollowup: false,
  };
}
