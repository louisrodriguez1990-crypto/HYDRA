import { call, parseJSON } from "./openrouter";
import { MODELS } from "./models";
import { reviewAndRevise, type ReviewSpec } from "./verify";
import type { ChatMessage, EngineResponse, Rigor } from "./types";

const DISCOVER_DRAFT_FALLBACK =
  "Hydra could not finish the creative exploration within the serverless time budget. Please retry if you want another pass.";

const DISCOVER_REVISION_INSTRUCTIONS = `Revise the answer into a clear final response.
- Lead with the strongest unconventional idea first.
- Keep only the ideas that are actionable and defensible.
- Label speculative elements briefly when needed.
- Preserve the logic that traces design choices back to real constraints.
- Stay concise.`;

const ASSUMPTION_BREAKER_PROMPT = `You will receive a question. Do NOT answer it.
Your job is to disassemble the question itself.

Step 1 — HARD CONSTRAINTS
List only physical, mathematical, legal, economic, or logical constraints that cannot be violated regardless of approach.
If you cannot name the law or principle, do not include it.

Step 2 — SOFT ASSUMPTIONS
List what the question takes for granted that is actually a choice.
For each, identify the assumption and a plausible alternative.

Step 3 — HIDDEN FRAME
Identify what category of solution the wording steers toward and what adjacent categories it excludes.
Rewrite the question three ways that would open different solution spaces.

Step 4 — DEPENDENCY MAP
Identify which assumptions the obvious answer depends on.
For each, rate whether breaking the assumption means the obvious answer would still_work, need_modification, or fail.

Output ONLY JSON with this shape:
{
  "hardConstraints": [{"law": "...", "constraint": "..."}],
  "softAssumptions": [{"assumption": "...", "alternative": "..."}],
  "hiddenFrame": {
    "steersToward": "...",
    "excludes": ["..."],
    "rewrites": ["...", "...", "..."]
  },
  "dependencyMap": [{"assumption": "...", "effect": "still_work|need_modification|fail", "note": "..."}]
}

No solutions. No recommendations. No preamble.`;

const PROPOSAL_PROMPT = `You will receive a question and an assumption analysis that identifies hard constraints and soft assumptions.

Work ONLY from the hard constraints.
Ignore conventions.
Ignore how this is usually done.

Step 1 — Given ONLY the hard constraints, identify the possible solution shapes.
Do not give specific implementations yet.

Step 2 — For each solution shape, design one specific implementation.
If it matches a well-known standard approach, it likely came from convention rather than constraints. Derive again.

Step 3 — For the strongest implementation, trace each major design choice back to a hard constraint.
If a design choice does not trace back to a hard constraint, call it an assumption and either remove it or justify it briefly.

Output in this structure:
1. Solution shapes
2. Candidate implementations
3. Strongest implementation
4. Constraint trace
5. Biggest implementation risk

Do not mention hidden reasoning or internal process.`;

const ADVERSARIAL_CRITIQUE_PROMPT = `You will receive a proposal. Your job is to break it.
You succeed when you find a specific, concrete reason it would fail.

For each major claim, apply these tests in order and stop at the first failure:

1. COUNTERPARTY TEST
If this creates value for the asker, who specifically loses, pays, or gives up leverage?
If no one can be named, the proposal has an unexamined assumption about where value comes from.

2. ACCESSIBILITY TEST
If this opportunity exists, what stops well-resourced incumbents from capturing it first?
If nothing stops them, explain why the asker would reach it first.

3. SURVIVAL TEST
Describe the most ordinary failure mode where someone follows this advice and it fails.
Not a black swan.

4. DERIVATION TEST
Is this proposal derived from the problem's constraints, or is it a familiar strategy applied to a new context?
If it resembles a common playbook from another domain, call that out explicitly.

Return only concise failure notes and what they imply about viability.`;

const NOVELTY_CRITIQUE_PROMPT = `You will receive an assumption analysis and a proposal.

Your job is to catch false novelty.
- Identify where the proposal sounds unconventional but is really a familiar playbook.
- Identify where it drifted back to industry-standard framing instead of using the alternate frames.
- Identify one more genuinely different constraint-derived direction if the proposal became generic.

Return concise notes only.`;

const PRACTICALITY_REVIEW_PROMPT = `You will receive an assumption analysis and a proposal.

Audit it for feasibility.
- Which hard constraints were underused or misapplied?
- Which required resources, timing assumptions, or execution dependencies were smuggled in?
- Which part is least likely to survive contact with the real world?

Return concise notes only.`;

const ANALYSIS_TIMEOUT_MS = 7000;
const PROPOSAL_TIMEOUT_MS = 8000;
const REVIEW_TIMEOUT_MS = 6000;
const REVISION_TIMEOUT_MS = 8000;

const ANALYSIS_MAX_TOKENS = 1200;
const PROPOSAL_MAX_TOKENS = 1800;
const REVIEW_MAX_TOKENS = 900;
const REVISION_MAX_TOKENS = 1800;

type DependencyEffect = "still_work" | "need_modification" | "fail";

interface HardConstraint {
  law: string;
  constraint: string;
}

interface SoftAssumption {
  assumption: string;
  alternative: string;
}

interface DependencyEntry {
  assumption: string;
  effect: DependencyEffect;
  note: string;
}

interface FirstPrinciplesAnalysis {
  hardConstraints: HardConstraint[];
  softAssumptions: SoftAssumption[];
  hiddenFrame: {
    steersToward: string;
    excludes: string[];
    rewrites: string[];
  };
  dependencyMap: DependencyEntry[];
}

interface CritiqueJob {
  label: string;
  modelId: string;
  prompt: string;
}

function buildDraftPrompt(query: string, rigorous: boolean) {
  return rigorous
    ? `Give a concise first-pass answer derived from hard constraints rather than convention.

Rules:
- Name 2 or 3 real hard constraints or non-negotiables first.
- Propose 2 or 3 unconventional but practical approaches.
- For each approach, briefly note which constraint it uses, satisfies, or works around.
- Mention the biggest implementation risk once.
- Stay concise.

Question:
${query}`
    : `Give a concise but creative answer derived from real constraints rather than standard playbooks.

Rules:
- Name the main non-negotiable constraints first.
- Propose 2 or 3 unconventional approaches that could realistically work.
- For each approach, briefly note why the constraints make it plausible.
- Stay concise.

Question:
${query}`;
}

function buildFallbackReviewSpecs(rigor: Rigor): ReviewSpec[] {
  const specs: ReviewSpec[] = [
    {
      label: "Constraint Review",
      modelId: MODELS.critic.id,
      prompt: `Review the draft answer.
- Find ideas that violate constraints, overreach, or sound hand-wavy.
- Call out where the answer relies on convention instead of deriving from named constraints.
- Return only the strongest corrective notes.`,
    },
    {
      label: "Novelty Review",
      modelId: MODELS.wild.id,
      prompt: `Review the draft answer.
- Point out where it only sounds unconventional but is actually familiar advice in disguise.
- Point out where it became generic or lost its strongest original useful idea.
- Return concise notes only.`,
    },
  ];

  if (rigor === "rigorous") {
    specs.push({
      label: "Practicality Review",
      modelId: MODELS.broad.id,
      prompt: `Audit the draft answer for feasibility and missing tradeoffs.
- Identify what hidden assumptions the answer depends on.
- Return concise notes on what to tighten, clarify, or cut.`,
    });
  }

  return specs;
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toNonEmptyString(item)).filter(Boolean);
}

function parseAnalysis(raw: string): FirstPrinciplesAnalysis | null {
  const parsed = parseJSON<Record<string, unknown>>(raw, {});

  const hardConstraints = Array.isArray(parsed.hardConstraints)
    ? parsed.hardConstraints
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const law = toNonEmptyString(record.law);
          const constraint = toNonEmptyString(record.constraint);
          return law && constraint ? { law, constraint } : null;
        })
        .filter((entry): entry is HardConstraint => entry !== null)
    : [];

  const softAssumptions = Array.isArray(parsed.softAssumptions)
    ? parsed.softAssumptions
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const assumption = toNonEmptyString(record.assumption);
          const alternative = toNonEmptyString(record.alternative);
          return assumption && alternative ? { assumption, alternative } : null;
        })
        .filter((entry): entry is SoftAssumption => entry !== null)
    : [];

  const hiddenFrameRecord =
    typeof parsed.hiddenFrame === "object" && parsed.hiddenFrame !== null
      ? (parsed.hiddenFrame as Record<string, unknown>)
      : null;

  const steersToward = toNonEmptyString(hiddenFrameRecord?.steersToward);
  const excludes = normalizeStringArray(hiddenFrameRecord?.excludes);
  const rewrites = normalizeStringArray(hiddenFrameRecord?.rewrites);

  const dependencyMap = Array.isArray(parsed.dependencyMap)
    ? parsed.dependencyMap
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const assumption = toNonEmptyString(record.assumption);
          const effect = record.effect;
          const note = toNonEmptyString(record.note);
          if (
            !assumption ||
            (effect !== "still_work" && effect !== "need_modification" && effect !== "fail")
          ) {
            return null;
          }

          return {
            assumption,
            effect,
            note,
          } satisfies DependencyEntry;
        })
        .filter((entry): entry is DependencyEntry => entry !== null)
    : [];

  if (hardConstraints.length === 0 || !steersToward || rewrites.length < 3) {
    return null;
  }

  return {
    hardConstraints,
    softAssumptions,
    hiddenFrame: {
      steersToward,
      excludes,
      rewrites: rewrites.slice(0, 3),
    },
    dependencyMap,
  };
}

function formatAnalysis(analysis: FirstPrinciplesAnalysis) {
  const hardConstraints = analysis.hardConstraints
    .map((entry) => `- ${entry.constraint} [law/principle: ${entry.law}]`)
    .join("\n");
  const softAssumptions =
    analysis.softAssumptions.length > 0
      ? analysis.softAssumptions
          .map(
            (entry) =>
              `- This assumes ${entry.assumption}, but someone could instead ${entry.alternative}.`
          )
          .join("\n")
      : "- No strong soft assumptions identified.";
  const hiddenFrame = [
    `Steers toward: ${analysis.hiddenFrame.steersToward}`,
    `Excludes: ${
      analysis.hiddenFrame.excludes.length > 0
        ? analysis.hiddenFrame.excludes.join("; ")
        : "None identified"
    }`,
    "Rewrites:",
    ...analysis.hiddenFrame.rewrites.map((rewrite) => `- ${rewrite}`),
  ].join("\n");
  const dependencyMap =
    analysis.dependencyMap.length > 0
      ? analysis.dependencyMap
          .map((entry) => `- ${entry.assumption} -> ${entry.effect}${entry.note ? ` (${entry.note})` : ""}`)
          .join("\n")
      : "- No obvious-answer dependency map identified.";

  return `Hard constraints:
${hardConstraints}

Soft assumptions:
${softAssumptions}

Hidden frame:
${hiddenFrame}

Dependency map:
${dependencyMap}`;
}

async function runAssumptionBreaker(query: string) {
  const raw = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: ASSUMPTION_BREAKER_PROMPT },
      { role: "user", content: query },
    ],
    {
      maxTokens: ANALYSIS_MAX_TOKENS,
      temperature: 0.15,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
    }
  );

  if (!raw.trim()) return null;

  return parseAnalysis(raw);
}

async function deriveConstraintFirstProposal(args: {
  query: string;
  analysis: FirstPrinciplesAnalysis;
  rigorous: boolean;
}) {
  const { query, analysis, rigorous } = args;
  const proposal = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: PROPOSAL_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

Assumption analysis:
${formatAnalysis(analysis)}

Additional guidance:
${rigorous ? "Be more exacting about the constraint trace and implementation risk." : "Keep the response nimble and concise."}`,
      },
    ],
    {
      maxTokens: PROPOSAL_MAX_TOKENS,
      temperature: rigorous ? 0.3 : 0.45,
      timeoutMs: PROPOSAL_TIMEOUT_MS,
    }
  );

  return proposal.trim();
}

async function critiqueProposal(args: {
  query: string;
  analysis: FirstPrinciplesAnalysis;
  proposal: string;
  rigor: Rigor;
}) {
  const { query, analysis, proposal, rigor } = args;
  const analysisBlock = formatAnalysis(analysis);

  const critiqueJobs: CritiqueJob[] = [
    {
      label: "Adversarial Critique",
      modelId: MODELS.critic.id,
      prompt: ADVERSARIAL_CRITIQUE_PROMPT,
    },
    {
      label: "Novelty Critique",
      modelId: MODELS.wild.id,
      prompt: NOVELTY_CRITIQUE_PROMPT,
    },
  ];

  if (rigor === "rigorous") {
    critiqueJobs.push({
      label: "Practicality Review",
      modelId: MODELS.broad.id,
      prompt: PRACTICALITY_REVIEW_PROMPT,
    });
  }

  const settled = await Promise.allSettled(
    critiqueJobs.map((job) =>
      call(
        job.modelId,
        [
          { role: "system", content: job.prompt },
          {
            role: "user",
            content: `Question:
${query}

Assumption analysis:
${analysisBlock}

Proposal:
${proposal}`,
          },
        ],
        {
          maxTokens: REVIEW_MAX_TOKENS,
          temperature: 0.2,
          timeoutMs: REVIEW_TIMEOUT_MS,
        }
      )
    )
  );

  return settled.flatMap((result, index) => {
    if (result.status !== "fulfilled") return [];
    const content = result.value.trim();
    if (!content) return [];

    return [`--- ${critiqueJobs[index].label} ---\n${content}`];
  });
}

async function reviseDiscoverFromAnalysis(args: {
  query: string;
  analysis: FirstPrinciplesAnalysis;
  proposal: string;
  notes: string[];
}) {
  const { query, analysis, proposal, notes } = args;
  const revised = await call(
    MODELS.analyst.id,
    [
      {
        role: "system",
        content: `You are revising a first-principles proposal into a final answer.

Rules:
- Keep one clear voice.
- Preserve the strongest unconventional idea only if it survives the critique.
- Remove any design choice that does not clearly trace back to a real constraint.
- If a claim depends on an assumption, state it briefly and honestly.
- Do not mention reviewers or the revision process.

${DISCOVER_REVISION_INSTRUCTIONS}`,
      },
      {
        role: "user",
        content: `Question:
${query}

Assumption analysis:
${formatAnalysis(analysis)}

Proposal:
${proposal}

Critique notes:
${notes.join("\n\n")}`,
      },
    ],
    {
      maxTokens: REVISION_MAX_TOKENS,
      temperature: 0.25,
      timeoutMs: REVISION_TIMEOUT_MS,
    }
  );

  return revised.trim();
}

export async function draftDiscover(
  messages: ChatMessage[],
  rigor: Rigor = "balanced"
): Promise<EngineResponse> {
  const query = messages[messages.length - 1]?.content ?? "";
  if (!query.trim()) {
    return {
      content: DISCOVER_DRAFT_FALLBACK,
      status: "fallback",
      needsFollowup: false,
    };
  }

  const draft = await call(
    MODELS.analyst.id,
    [
      ...messages.slice(0, -1),
      { role: "user", content: buildDraftPrompt(query, rigor === "rigorous") },
    ],
    {
      maxTokens: 1800,
      temperature: rigor === "rigorous" ? 0.35 : 0.55,
      timeoutMs: 18000,
    }
  );

  if (!draft.trim()) {
    return {
      content: DISCOVER_DRAFT_FALLBACK,
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

export async function refineDiscover(args: {
  messages: ChatMessage[];
  draft: string;
  rigor: Rigor;
}): Promise<EngineResponse> {
  const { messages, draft, rigor } = args;
  const query = messages[messages.length - 1]?.content ?? "";
  const seed = draft.trim() || DISCOVER_DRAFT_FALLBACK;

  if (!query.trim()) {
    return {
      content: seed,
      status: "fallback",
      needsFollowup: false,
    };
  }

  const analysis = await runAssumptionBreaker(query);
  if (!analysis) {
    const revised = await reviewAndRevise({
      query,
      draft: seed,
      reviewSpecs: buildFallbackReviewSpecs(rigor),
      revisionInstructions: DISCOVER_REVISION_INSTRUCTIONS,
    });

    return {
      content: revised.content,
      status: revised.revised ? "final" : "fallback",
      needsFollowup: false,
    };
  }

  const proposal = await deriveConstraintFirstProposal({
    query,
    analysis,
    rigorous: rigor === "rigorous",
  });

  if (!proposal) {
    const revised = await reviewAndRevise({
      query,
      draft: seed,
      reviewSpecs: buildFallbackReviewSpecs(rigor),
      revisionInstructions: DISCOVER_REVISION_INSTRUCTIONS,
    });

    return {
      content: revised.content,
      status: revised.revised ? "final" : "fallback",
      needsFollowup: false,
    };
  }

  const notes = await critiqueProposal({
    query,
    analysis,
    proposal,
    rigor,
  });

  if (notes.length === 0) {
    return {
      content: proposal,
      status: "final",
      needsFollowup: false,
    };
  }

  const revised = await reviseDiscoverFromAnalysis({
    query,
    analysis,
    proposal,
    notes,
  });

  return {
    content: revised || proposal,
    status: revised ? "final" : "fallback",
    needsFollowup: false,
  };
}
