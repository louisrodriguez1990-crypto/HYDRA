import { MODELS } from "./models";
import { call, parseJSON } from "./openrouter";
import { runSearchQueries } from "./search";
import { reviewAndRevise, type ReviewSpec } from "./verify";
import type {
  ChatMessage,
  CollisionCandidate,
  CollisionCandidateGateResult,
  CollisionMapTrace,
  CollisionObviousAnswer,
  CollisionTrace,
  CollisionTraceFrame,
  EngineResponse,
  ProgressReporter,
  Rigor,
} from "./types";

const DISCOVER_DRAFT_FALLBACK =
  "Hydra could not finish the creative exploration within the current request budget. Please retry if you want another pass.";

const DISCOVER_REVISION_INSTRUCTIONS = `Revise the answer into a clear final response.
- Lead with the strongest unconventional idea first.
- Keep only the ideas that are actionable and defensible.
- Label speculative elements briefly when needed.
- Preserve logic that traces design choices back to real constraints.
- Stay concise.`;

const ASSUMPTION_BREAKER_PROMPT = `You will receive a question. Do NOT answer it. Disassemble it.

Return ONLY JSON:
{
  "hardConstraints":[{"law":"...","constraint":"..."}],
  "softAssumptions":[{"assumption":"...","alternative":"..."}],
  "hiddenFrame":{"steersToward":"...","excludes":["..."],"rewrites":["...","...","..."]},
  "dependencyMap":[{"assumption":"...","effect":"still_work|need_modification|fail","note":"..."}]
}

Rules:
- Hard constraints must be physical, mathematical, legal, economic, or logical.
- Soft assumptions must be choices, conventions, or framing defaults.
- Rewrites must open meaningfully different solution spaces.
- Dependency map must focus on what the obvious answer depends on.
- No preamble. No solutions.`;

const PROPOSAL_PROMPT = `You will receive a question and an assumption analysis.

Work from hard constraints, not conventions.

Output:
1. Solution shapes
2. Candidate implementations
3. Strongest implementation
4. Constraint trace
5. Biggest implementation risk

Rules:
- Derive from the named constraints.
- If a design choice does not trace back to a hard constraint, call it an assumption.
- Do not mention hidden reasoning or internal process.`;

const ADVERSARIAL_CRITIQUE_PROMPT = `You will receive a proposal. Break it.

For each major claim, apply these tests in order:
1. Counterparty test
2. Accessibility test
3. Survival test
4. Derivation test

Return only concise failure notes and what they imply about viability.`;

const NOVELTY_CRITIQUE_PROMPT = `You will receive an assumption analysis and a proposal.

Catch false novelty.
- Identify where the proposal is really a familiar playbook.
- Identify where it drifted back toward consensus framing.
- Suggest one more constraint-derived direction if it became generic.

Return concise notes only.`;

const PRACTICALITY_REVIEW_PROMPT = `You will receive an assumption analysis and a proposal.

Audit it for feasibility.
- Which constraints were underused or misapplied?
- Which resources, timing assumptions, or execution dependencies were smuggled in?
- Which part is least likely to survive contact with reality?

Return concise notes only.`;

const OBVIOUS_ANSWER_PROMPT = `You will receive a question, a first-pass draft, and an assumption analysis.

Extract the likely obvious answer the market or model would default toward.

Return ONLY JSON:
{
  "domain":"...",
  "obviousAnswer":"...",
  "mechanism":"...",
  "coreAssumptions":[{"id":"A1","label":"..."},{"id":"A2","label":"..."}],
  "changedConstraint":"...",
  "hiddenVariable":"..."
}

Rules:
- Use 1 to 3 core assumptions maximum.
- changedConstraint must be the actual variable that recently changed or matters most.
- hiddenVariable must be a variable the market may be underweighting.
- Be specific and concrete.`;

const COLLISION_FRAME_PROMPT = `You will analyze a problem from one forced frame.

Rules:
- Stay inside the assigned frame.
- Use the named hard constraints as anchors.
- Name the attacked or preserved assumptions explicitly.
- If this is a hostile frame, explain why the obvious answer becomes less valuable or harmful.
- Do not reconcile with other frames.
- Be concrete and mechanism-based.

Output:
1. Frame thesis
2. What is really happening in this frame
3. What becomes valuable, fragile, or overlooked
4. Why the obvious answer weakens or fails here
5. Strongest disconfirming signal`;

const FRAME_DIVERGENCE_PROMPT = `You will compare a baseline analysis and a hostile analysis.

Return ONLY JSON:
{"diverges":true,"note":"..."}

Rules:
- diverges=false if the hostile frame collapses back into the same core idea or mechanism as the baseline.
- diverges=true only if the hostile frame reaches a materially different implication.
- note should explain the key difference or the drift.`;

const CONTRADICTION_MINER_PROMPT = `You will receive several incompatible analyses of the same problem.

Do NOT reconcile them. Do NOT pick a winner.

Return ONLY JSON:
{
  "tensions":["..."],
  "agreements":["..."],
  "gaps":["..."],
  "productiveContradictions":["..."]
}

Rules:
- tensions must be specific contradictions
- agreements are only conclusions reached despite incompatible premises
- gaps are what none of the frames directly address
- productiveContradictions must say what becomes true if conflicting observations are both partially true`;

const CANDIDATE_GENERATOR_PROMPT = `You will receive a collision map.

Generate at most 2 asymmetric candidates.

Return ONLY JSON:
{
  "candidates":[
    {
      "id":"C1",
      "insight":"...",
      "mechanism":"...",
      "targetUser":"...",
      "valueCapture":"...",
      "supportingFrameIds":["A","B"],
      "contradiction":"...",
      "whyNotBaseline":"..."
    }
  ]
}

Rules:
- Each candidate must depend on at least one productive contradiction or robust agreement across incompatible frames.
- If a candidate is just the obvious answer restated, exclude it.
- Be concrete about mechanism and value capture.`;

const CANDIDATE_RANKING_PROMPT = `You will score asymmetric candidates.

Return ONLY JSON:
{
  "scores":[
    {
      "candidateId":"C1",
      "asymmetry":0,
      "mechanismSpecificity":0,
      "incumbencyExplanation":0,
      "constraintsFit":0,
      "score":0,
      "note":"..."
    }
  ]
}

Rules:
- Score each dimension from 0 to 5.
- Prefer ideas that are clearly not the baseline answer, explain why incumbents miss them, and fit the user's stated constraints.`;

const TRAINING_OVERLAP_PROMPT = `You will compare a candidate idea against a generic domain answer.

Return ONLY JSON:
{
  "mechanismMatch": true,
  "targetUserMatch": false,
  "valueCaptureMatch": true,
  "reason": "..."
}

Rules:
- Match means materially the same, not vaguely adjacent.
- If 2 or more dimensions match, the candidate is too consensus-shaped.`;

const WEB_OVERLAP_PROMPT = `You will compare a candidate idea against search results.

Return ONLY JSON:
{
  "matchingResults": 0,
  "matches":[{"url":"...","reason":"..."}]
}

Rules:
- Count a result only if it describes the same mechanism with substantially the same reasoning.
- Ignore loose topical overlap.
- Use the provided snippets only.`;

const SELECTED_SYNTHESIS_PROMPT = `You will receive a surviving asymmetric candidate and the evidence that supported it.

Write the final answer.

Rules:
- Lead with the insight itself.
- Explain the mechanism, who it serves, why incumbents are missing it, and the first practical move.
- Keep the answer concrete and readable.
- Do not mention hidden reasoning or internal process.`;

const FALLBACK_SYNTHESIS_PROMPT = `No candidate survived the asymmetry gate.

Write the best plausible idea without claiming hidden novelty.

Rules:
- Lead by saying this is the strongest plausible direction, not a proven asymmetric insight.
- Use only the robust agreements and strongest productive contradiction.
- Keep it specific and practical.
- Do not mention hidden reasoning or internal process.`;

const ANALYSIS_TIMEOUT_MS = 18_000;
const PROPOSAL_TIMEOUT_MS = 24_000;
const REVIEW_TIMEOUT_MS = 18_000;
const REVISION_TIMEOUT_MS = 24_000;
const OBVIOUS_TIMEOUT_MS = 16_000;
const FRAME_TIMEOUT_MS = 22_000;
const FRAME_JUDGE_TIMEOUT_MS = 12_000;
const COLLISION_MAP_TIMEOUT_MS = 18_000;
const CANDIDATE_TIMEOUT_MS = 18_000;
const RANK_TIMEOUT_MS = 14_000;
const TRAINING_TIMEOUT_MS = 12_000;
const WEB_MATCH_TIMEOUT_MS = 12_000;
const SYNTHESIS_TIMEOUT_MS = 20_000;

const ANALYSIS_MAX_TOKENS = 1200;
const PROPOSAL_MAX_TOKENS = 1800;
const REVIEW_MAX_TOKENS = 900;
const REVISION_MAX_TOKENS = 1800;
const OBVIOUS_MAX_TOKENS = 500;
const FRAME_MAX_TOKENS = 1100;
const FRAME_JUDGE_MAX_TOKENS = 220;
const COLLISION_MAP_MAX_TOKENS = 1000;
const CANDIDATE_MAX_TOKENS = 1200;
const RANK_MAX_TOKENS = 500;
const TRAINING_MAX_TOKENS = 700;
const WEB_MATCH_MAX_TOKENS = 700;
const SYNTHESIS_MAX_TOKENS = 1800;

const COLLISION_FRAME_FALLBACK =
  "Hydra could not complete this frame analysis within the available request budget.";

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

interface DynamicFrameSpec {
  id: string;
  kind: CollisionTraceFrame["kind"];
  title: string;
  premise: string;
  attackedAssumptionIds: string[];
  preservedAssumptionIds: string[];
  modelId: string;
  temperature: number;
  progressLabel: string;
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toNonEmptyString(item))
    .filter(Boolean)
    .slice(0, limit);
}

async function notifyProgress(onProgress: ProgressReporter | undefined, label: string) {
  if (!onProgress) return;
  await onProgress({ label });
}

function buildDraftPrompt(query: string, rigorous: boolean) {
  return rigorous
    ? `Give a concise first-pass answer derived from hard constraints rather than convention.

Rules:
- Name 2 or 3 real hard constraints first.
- Propose 2 or 3 unconventional but practical approaches.
- For each approach, note which constraint it uses, satisfies, or works around.
- Mention the biggest implementation risk once.
- Stay concise.

Question:
${query}`
    : `Give a concise but creative answer derived from real constraints rather than standard playbooks.

Rules:
- Name the main non-negotiable constraints first.
- Propose 2 or 3 unconventional approaches that could realistically work.
- For each approach, note why the constraints make it plausible.
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
- Point out where it became generic or lost its strongest original idea.
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
  const rewrites = normalizeStringArray(hiddenFrameRecord?.rewrites, 3);

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

          return { assumption, effect, note } satisfies DependencyEntry;
        })
        .filter((entry): entry is DependencyEntry => entry !== null)
    : [];

  if (hardConstraints.length === 0 || !steersToward || rewrites.length < 3) {
    return null;
  }

  return {
    hardConstraints,
    softAssumptions,
    hiddenFrame: { steersToward, excludes, rewrites },
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

async function runAssumptionBreaker(query: string, onProgress?: ProgressReporter) {
  await notifyProgress(onProgress, "I’m breaking the problem into hard constraints and soft assumptions");
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
  onProgress?: ProgressReporter;
}) {
  const { query, analysis, rigorous, onProgress } = args;
  await notifyProgress(onProgress, "I’m deriving options from the hard constraints");
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
${rigorous ? "Be exacting about the constraint trace and implementation risk." : "Keep the response nimble and concise."}`,
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
  onProgress?: ProgressReporter;
}) {
  const { query, analysis, proposal, rigor, onProgress } = args;
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

  await notifyProgress(onProgress, "I’m pressure-testing the strongest proposal");
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
  onProgress?: ProgressReporter;
}) {
  const { query, analysis, proposal, notes, onProgress } = args;
  await notifyProgress(onProgress, "I’m revising the answer around the strongest surviving logic");
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

function parseObviousAnswer(raw: string): CollisionObviousAnswer | null {
  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const domain = toNonEmptyString(parsed.domain);
  const obviousAnswer = toNonEmptyString(parsed.obviousAnswer);
  const mechanism = toNonEmptyString(parsed.mechanism);
  const changedConstraint = toNonEmptyString(parsed.changedConstraint);
  const hiddenVariable = toNonEmptyString(parsed.hiddenVariable);
  const coreAssumptions = Array.isArray(parsed.coreAssumptions)
    ? parsed.coreAssumptions
        .map((entry, index) => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const id = toNonEmptyString(record.id) || `A${index + 1}`;
          const label = toNonEmptyString(record.label);
          return id && label ? { id, label } : null;
        })
        .filter((entry): entry is CollisionObviousAnswer["coreAssumptions"][number] => entry !== null)
        .slice(0, 3)
    : [];

  if (
    !domain ||
    !obviousAnswer ||
    !mechanism ||
    !changedConstraint ||
    !hiddenVariable ||
    coreAssumptions.length === 0
  ) {
    return null;
  }

  return {
    domain,
    obviousAnswer,
    mechanism,
    coreAssumptions,
    changedConstraint,
    hiddenVariable,
  };
}

async function extractObviousAnswer(args: {
  query: string;
  draft: string;
  analysis: FirstPrinciplesAnalysis;
  onProgress?: ProgressReporter;
}) {
  const { query, draft, analysis, onProgress } = args;
  await notifyProgress(onProgress, "I’m identifying the obvious answer so I can actively work against it");
  const raw = await call(
    MODELS.fast.id,
    [
      { role: "system", content: OBVIOUS_ANSWER_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

First-pass draft:
${draft}

Assumption analysis:
${formatAnalysis(analysis)}`,
      },
    ],
    {
      maxTokens: OBVIOUS_MAX_TOKENS,
      temperature: 0.15,
      timeoutMs: OBVIOUS_TIMEOUT_MS,
    }
  );

  if (!raw.trim()) return null;
  return parseObviousAnswer(raw);
}

function buildDynamicFrames(obvious: CollisionObviousAnswer): DynamicFrameSpec[] {
  const assumptions = obvious.coreAssumptions;
  const first = assumptions[0];
  const second = assumptions[1] ?? first;
  const third = assumptions[2] ?? second ?? first;
  const allIds = assumptions.map((assumption) => assumption.id);

  return [
    {
      id: "A",
      kind: "baseline",
      title: "Baseline frame",
      premise: `Assume the obvious answer broadly works. The current consensus is directionally correct, the mechanism "${obvious.mechanism}" is valid, and the core assumptions hold.`,
      attackedAssumptionIds: [],
      preservedAssumptionIds: allIds,
      modelId: MODELS.broad.id,
      temperature: 0.25,
      progressLabel: "I’m testing the baseline view before trying to break it",
    },
    {
      id: "B",
      kind: "liability_inversion",
      title: "Liability inversion",
      premise: `Assume the obvious answer becomes a liability because assumption ${first.id} (${first.label}) fails. Explain why the same mechanism now creates drag, exposure, or hidden downside.`,
      attackedAssumptionIds: [first.id],
      preservedAssumptionIds: allIds.filter((id) => id !== first.id),
      modelId: MODELS.wild.id,
      temperature: 0.45,
      progressLabel: "I’m checking whether the obvious answer becomes a liability when one assumption breaks",
    },
    {
      id: "C",
      kind: "constraint_nullifier",
      title: "Constraint nullifier",
      premise: `Assume the changed constraint "${obvious.changedConstraint}" destroys the value of the obvious mechanism "${obvious.mechanism}". Use assumption ${second.id} (${second.label}) as the pivot and show what matters if the old mechanism no longer compounds.`,
      attackedAssumptionIds: [second.id],
      preservedAssumptionIds: allIds.filter((id) => id !== second.id),
      modelId: MODELS.analyst.id,
      temperature: 0.3,
      progressLabel: "I’m testing whether the changed constraint nullifies the obvious mechanism",
    },
    {
      id: "D",
      kind: "omission",
      title: "Omission frame",
      premise: `Assume the market is optimizing the wrong variable and the hidden variable "${obvious.hiddenVariable}" dominates. Use assumption ${third.id} (${third.label}) as the one that most likely blinds the obvious answer.`,
      attackedAssumptionIds: [third.id],
      preservedAssumptionIds: allIds.filter((id) => id !== third.id),
      modelId: MODELS.critic.id,
      temperature: 0.35,
      progressLabel: "I’m looking for what the market is optimizing incorrectly",
    },
  ];
}

async function runCollisionFrame(args: {
  query: string;
  analysis: FirstPrinciplesAnalysis;
  obvious: CollisionObviousAnswer;
  frame: DynamicFrameSpec;
  onProgress?: ProgressReporter;
}) {
  const { query, analysis, obvious, frame, onProgress } = args;
  await notifyProgress(onProgress, frame.progressLabel);

  const attacked = obvious.coreAssumptions
    .filter((assumption) => frame.attackedAssumptionIds.includes(assumption.id))
    .map((assumption) => `${assumption.id}: ${assumption.label}`)
    .join("; ");
  const preserved = obvious.coreAssumptions
    .filter((assumption) => frame.preservedAssumptionIds.includes(assumption.id))
    .map((assumption) => `${assumption.id}: ${assumption.label}`)
    .join("; ");

  const answer = await call(
    frame.modelId,
    [
      { role: "system", content: COLLISION_FRAME_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

Assumption analysis:
${formatAnalysis(analysis)}

Obvious answer:
${obvious.obviousAnswer}

Obvious mechanism:
${obvious.mechanism}

Attacked assumptions:
${attacked || "None"}

Preserved assumptions:
${preserved || "None"}

Forced frame [${frame.id}] ${frame.title}:
${frame.premise}`,
      },
    ],
    {
      maxTokens: FRAME_MAX_TOKENS,
      temperature: frame.temperature,
      timeoutMs: FRAME_TIMEOUT_MS,
    }
  );

  return {
    id: frame.id,
    kind: frame.kind,
    title: frame.title,
    premise: frame.premise,
    attackedAssumptionIds: frame.attackedAssumptionIds,
    preservedAssumptionIds: frame.preservedAssumptionIds,
    answer: answer.trim() || COLLISION_FRAME_FALLBACK,
    status: answer.trim() ? "complete" : "partial",
  } satisfies CollisionTraceFrame;
}

async function judgeFrameDivergence(args: {
  baseline: CollisionTraceFrame;
  hostile: CollisionTraceFrame;
  onProgress?: ProgressReporter;
}) {
  const { baseline, hostile, onProgress } = args;
  await notifyProgress(onProgress, `I’m checking whether ${hostile.title.toLowerCase()} actually escaped the baseline`);
  const raw = await call(
    MODELS.fast.id,
    [
      { role: "system", content: FRAME_DIVERGENCE_PROMPT },
      {
        role: "user",
        content: `Baseline frame:
${baseline.answer}

Hostile frame:
${hostile.answer}`,
      },
    ],
    {
      maxTokens: FRAME_JUDGE_MAX_TOKENS,
      temperature: 0.1,
      timeoutMs: FRAME_JUDGE_TIMEOUT_MS,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const diverges = parsed.diverges === true;
  const note = toNonEmptyString(parsed.note);

  if (diverges) {
    return hostile;
  }

  return {
    ...hostile,
    status: "partial",
    note: note || "This frame drifted back toward the baseline idea instead of producing a real inversion.",
  } satisfies CollisionTraceFrame;
}

function formatCollisionFrames(frames: CollisionTraceFrame[]) {
  return frames
    .map(
      (frame) => `[${frame.id}] ${frame.title} (${frame.status})
Premise: ${frame.premise}
Attacked assumptions: ${frame.attackedAssumptionIds.join(", ") || "None"}
Preserved assumptions: ${frame.preservedAssumptionIds.join(", ") || "None"}
Analysis:
${frame.answer}`
    )
    .join("\n\n");
}

function formatCollisionMapSection(title: string, items: string[]) {
  if (items.length === 0) {
    return `${title}:\n- None identified.`;
  }

  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function formatCollisionMap(collisionMap: CollisionMapTrace) {
  return [
    formatCollisionMapSection("Tensions", collisionMap.tensions),
    formatCollisionMapSection("Agreements", collisionMap.agreements),
    formatCollisionMapSection("Gaps", collisionMap.gaps),
    formatCollisionMapSection("Productive contradictions", collisionMap.productiveContradictions),
  ].join("\n\n");
}

function parseCollisionMap(raw: string): CollisionMapTrace | null {
  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const collisionMap: CollisionMapTrace = {
    tensions: normalizeStringArray(parsed.tensions),
    agreements: normalizeStringArray(parsed.agreements),
    gaps: normalizeStringArray(parsed.gaps, 4),
    productiveContradictions: normalizeStringArray(
      parsed.productiveContradictions ?? parsed.productive_contradictions
    ),
  };

  if (
    collisionMap.tensions.length === 0 &&
    collisionMap.agreements.length === 0 &&
    collisionMap.gaps.length === 0 &&
    collisionMap.productiveContradictions.length === 0
  ) {
    return null;
  }

  return collisionMap;
}

async function mineContradictions(args: {
  query: string;
  analysis: FirstPrinciplesAnalysis;
  obvious: CollisionObviousAnswer;
  frames: CollisionTraceFrame[];
  onProgress?: ProgressReporter;
}) {
  const { query, analysis, obvious, frames, onProgress } = args;
  await notifyProgress(onProgress, "I’m mining where the hostile frames agree, clash, or leave something out");
  const raw = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: CONTRADICTION_MINER_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

Obvious answer:
${obvious.obviousAnswer}

Assumption analysis:
${formatAnalysis(analysis)}

Frame analyses:
${formatCollisionFrames(frames)}`,
      },
    ],
    {
      maxTokens: COLLISION_MAP_MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: COLLISION_MAP_TIMEOUT_MS,
    }
  );

  if (!raw.trim()) return null;
  return parseCollisionMap(raw);
}

function parseCandidates(raw: string): CollisionCandidate[] {
  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  if (!Array.isArray(parsed.candidates)) return [];

  const candidates: CollisionCandidate[] = [];

  parsed.candidates.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const record = entry as Record<string, unknown>;
    const insight = toNonEmptyString(record.insight);
    const mechanism = toNonEmptyString(record.mechanism);
    const targetUser = toNonEmptyString(record.targetUser);
    const valueCapture = toNonEmptyString(record.valueCapture);
    const contradiction = toNonEmptyString(record.contradiction);
    const whyNotBaseline = toNonEmptyString(record.whyNotBaseline);
    const supportingFrameIds = normalizeStringArray(record.supportingFrameIds, 4);
    const id = toNonEmptyString(record.id) || `C${index + 1}`;

    if (
      !insight ||
      !mechanism ||
      !targetUser ||
      !valueCapture ||
      !contradiction ||
      !whyNotBaseline ||
      supportingFrameIds.length === 0
    ) {
      return;
    }

    candidates.push({
      id,
      insight,
      mechanism,
      targetUser,
      valueCapture,
      supportingFrameIds,
      contradiction,
      whyNotBaseline,
      status: "survived",
    });
  });

  return candidates.slice(0, 2);
}

async function generateAsymmetricCandidates(args: {
  query: string;
  obvious: CollisionObviousAnswer;
  frames: CollisionTraceFrame[];
  collisionMap: CollisionMapTrace;
  onProgress?: ProgressReporter;
}) {
  const { query, obvious, frames, collisionMap, onProgress } = args;
  await notifyProgress(onProgress, "I’m generating a couple of asymmetric candidates from the collision itself");
  const raw = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: CANDIDATE_GENERATOR_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

Obvious answer:
${obvious.obviousAnswer}

Obvious mechanism:
${obvious.mechanism}

Frame analyses:
${formatCollisionFrames(frames)}

Collision map:
${formatCollisionMap(collisionMap)}`,
      },
    ],
    {
      maxTokens: CANDIDATE_MAX_TOKENS,
      temperature: 0.3,
      timeoutMs: CANDIDATE_TIMEOUT_MS,
    }
  );

  return raw.trim() ? parseCandidates(raw) : [];
}

async function rankCandidates(args: {
  query: string;
  obvious: CollisionObviousAnswer;
  candidates: CollisionCandidate[];
  onProgress?: ProgressReporter;
}) {
  const { query, obvious, candidates, onProgress } = args;
  if (candidates.length === 0) return [];

  await notifyProgress(onProgress, "I’m ranking the candidates by asymmetry and practical fit");
  const raw = await call(
    MODELS.fast.id,
    [
      { role: "system", content: CANDIDATE_RANKING_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

Obvious answer:
${obvious.obviousAnswer}

Candidates:
${candidates
  .map(
    (candidate) => `[${candidate.id}] Insight: ${candidate.insight}
Mechanism: ${candidate.mechanism}
Target user: ${candidate.targetUser}
Value capture: ${candidate.valueCapture}
Why not baseline: ${candidate.whyNotBaseline}`
  )
  .join("\n\n")}`,
      },
    ],
    {
      maxTokens: RANK_MAX_TOKENS,
      temperature: 0.1,
      timeoutMs: RANK_TIMEOUT_MS,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
  const scoreMap = new Map<string, { score: number; note: string }>();

  for (const entry of scores) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const candidateId = toNonEmptyString(record.candidateId);
    const score = typeof record.score === "number" ? record.score : -1;
    const note = toNonEmptyString(record.note);
    if (!candidateId || score < 0) continue;
    scoreMap.set(candidateId, { score, note });
  }

  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      score: scoreMap.get(candidate.id)?.score ?? candidate.score ?? 0,
      whyNotBaseline:
        scoreMap.get(candidate.id)?.note || candidate.whyNotBaseline,
    }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

async function runTrainingCheck(args: {
  candidate: CollisionCandidate;
  obvious: CollisionObviousAnswer;
  onProgress?: ProgressReporter;
}) {
  const { candidate, obvious, onProgress } = args;
  await notifyProgress(onProgress, "I’m checking whether the leading idea still looks like generic consensus");

  const generic = await call(
    MODELS.fast.id,
    [
      {
        role: "system",
        content: `Answer concisely: what are the best opportunities in ${obvious.domain} right now? Focus on common consensus ideas.`,
      },
      {
        role: "user",
        content: `Domain: ${obvious.domain}`,
      },
    ],
    {
      maxTokens: TRAINING_MAX_TOKENS,
      temperature: 0.3,
      timeoutMs: TRAINING_TIMEOUT_MS,
    }
  );

  if (!generic.trim()) {
    return {
      passed: false,
      reasons: ["Hydra could not complete the model-side consensus check."],
    };
  }

  const raw = await call(
    MODELS.critic.id,
    [
      { role: "system", content: TRAINING_OVERLAP_PROMPT },
      {
        role: "user",
        content: `Generic domain answer:
${generic}

Candidate:
Insight: ${candidate.insight}
Mechanism: ${candidate.mechanism}
Target user: ${candidate.targetUser}
Value capture: ${candidate.valueCapture}`,
      },
    ],
    {
      maxTokens: 300,
      temperature: 0.1,
      timeoutMs: TRAINING_TIMEOUT_MS,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const dimensions = [
    parsed.mechanismMatch === true,
    parsed.targetUserMatch === true,
    parsed.valueCaptureMatch === true,
  ];
  const matchCount = dimensions.filter(Boolean).length;
  const reason = toNonEmptyString(parsed.reason);

  return {
    passed: matchCount < 2,
    reasons:
      matchCount < 2
        ? reason
          ? [reason]
          : ["The candidate did not materially overlap with the generic answer on two or more dimensions."]
        : [
            reason ||
              "The candidate overlapped too strongly with the generic answer on mechanism, target user, or value capture.",
          ],
  };
}

function dedupeSearchResults(
  response: Awaited<ReturnType<typeof runSearchQueries>>
) {
  const seen = new Set<string>();
  const results: Array<{ title: string; url: string; description: string }> = [];

  for (const query of response.queries) {
    for (const result of query.results) {
      const key = result.url.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push({
        title: result.title,
        url: result.url,
        description: result.description,
      });
    }
  }

  return results;
}

function formatSearchResults(
  results: Array<{ title: string; url: string; description: string }>
) {
  return results
    .map(
      (result, index) => `${index + 1}. ${result.title}
URL: ${result.url}
Snippet: ${result.description || "No snippet available."}`
    )
    .join("\n\n");
}

async function judgeSearchOverlap(args: {
  candidate: CollisionCandidate;
  results: Array<{ title: string; url: string; description: string }>;
}) {
  const { candidate, results } = args;
  if (results.length === 0) {
    return { matchingResults: 0, reasons: [] as string[] };
  }

  const raw = await call(
    MODELS.critic.id,
    [
      { role: "system", content: WEB_OVERLAP_PROMPT },
      {
        role: "user",
        content: `Candidate:
Insight: ${candidate.insight}
Mechanism: ${candidate.mechanism}
Target user: ${candidate.targetUser}
Value capture: ${candidate.valueCapture}

Search results:
${formatSearchResults(results)}`,
      },
    ],
    {
      maxTokens: WEB_MATCH_MAX_TOKENS,
      temperature: 0.1,
      timeoutMs: WEB_MATCH_TIMEOUT_MS,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const matchingResults =
    typeof parsed.matchingResults === "number" ? parsed.matchingResults : 0;
  const matches = Array.isArray(parsed.matches)
    ? parsed.matches
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return "";
          const record = entry as Record<string, unknown>;
          const url = toNonEmptyString(record.url);
          const reason = toNonEmptyString(record.reason);
          return url && reason ? `${url} — ${reason}` : "";
        })
        .filter(Boolean)
    : [];

  return {
    matchingResults,
    reasons: matches,
  };
}

async function runWebConsensusCheck(args: {
  candidate: CollisionCandidate;
  obvious: CollisionObviousAnswer;
  onProgress?: ProgressReporter;
}) {
  const { candidate, obvious, onProgress } = args;
  await notifyProgress(onProgress, "I’m checking the web to see whether this idea is already active consensus");

  const queries = [
    `${obvious.domain} ${candidate.insight}`,
    `${obvious.domain} ${candidate.mechanism}`,
    `${obvious.domain} ${candidate.mechanism} startup OR fund OR strategy`,
  ];

  const recent = await runSearchQueries(queries, "recent");
  const recentResults = dedupeSearchResults(recent);

  if (!recent.available && recentResults.length === 0) {
    return {
      state: "unavailable" as const,
      reasons: [
        recent.error ||
          "Hydra could not reach the Firecrawl search service for the active-consensus check.",
      ],
    };
  }

  const recentOverlap = await judgeSearchOverlap({
    candidate,
    results: recentResults.slice(0, 8),
  });

  if (recentOverlap.matchingResults >= 2) {
    return {
      state: "failed" as const,
      reasons:
        recentOverlap.reasons.length > 0
          ? recentOverlap.reasons
          : ["Recent web results already describe the same mechanism with the same reasoning."],
    };
  }

  const old = await runSearchQueries(queries, "old");
  const oldResults = dedupeSearchResults(old);
  const oldOverlap =
    oldResults.length > 0
      ? await judgeSearchOverlap({
          candidate,
          results: oldResults.slice(0, 8),
        })
      : { matchingResults: 0, reasons: [] as string[] };

  return {
    state: "passed" as const,
    reasons: recentOverlap.reasons,
    revivalNote:
      recentOverlap.matchingResults === 0 && oldOverlap.matchingResults > 0
        ? "Previously attempted — investigate why it faded and whether the changed constraints make it viable again."
        : undefined,
  };
}

async function synthesizeSelectedCandidate(args: {
  query: string;
  obvious: CollisionObviousAnswer;
  collisionMap: CollisionMapTrace;
  candidate: CollisionCandidate;
  gateResult?: CollisionCandidateGateResult;
  onProgress?: ProgressReporter;
}) {
  const { query, obvious, collisionMap, candidate, gateResult, onProgress } = args;
  await notifyProgress(onProgress, "I’m turning the surviving asymmetric candidate into a concrete answer");
  const content = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: SELECTED_SYNTHESIS_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

Obvious answer:
${obvious.obviousAnswer}

Selected candidate:
Insight: ${candidate.insight}
Mechanism: ${candidate.mechanism}
Target user: ${candidate.targetUser}
Value capture: ${candidate.valueCapture}
Supporting frames: ${candidate.supportingFrameIds.join(", ")}
Productive contradiction: ${candidate.contradiction}
Why it is not baseline: ${candidate.whyNotBaseline}

Collision map:
${formatCollisionMap(collisionMap)}

Gate notes:
${gateResult?.reasons.join("\n") || "No additional notes."}
${gateResult?.revivalNote ? `\nRevival note: ${gateResult.revivalNote}` : ""}`,
      },
    ],
    {
      maxTokens: SYNTHESIS_MAX_TOKENS,
      temperature: 0.25,
      timeoutMs: SYNTHESIS_TIMEOUT_MS,
    }
  );

  return content.trim();
}

async function synthesizeFallbackAnswer(args: {
  query: string;
  collisionMap: CollisionMapTrace;
  fallbackReason: string;
  onProgress?: ProgressReporter;
}) {
  const { query, collisionMap, fallbackReason, onProgress } = args;
  await notifyProgress(onProgress, "I’m packaging the strongest plausible answer without overclaiming novelty");
  const content = await call(
    MODELS.analyst.id,
    [
      { role: "system", content: FALLBACK_SYNTHESIS_PROMPT },
      {
        role: "user",
        content: `Question:
${query}

Fallback reason:
${fallbackReason}

Collision map:
${formatCollisionMap(collisionMap)}`,
      },
    ],
    {
      maxTokens: SYNTHESIS_MAX_TOKENS,
      temperature: 0.25,
      timeoutMs: SYNTHESIS_TIMEOUT_MS,
    }
  );

  return content.trim();
}

async function runAsymmetryGateDiscover(args: {
  query: string;
  draft: string;
  analysis: FirstPrinciplesAnalysis;
  onProgress?: ProgressReporter;
}): Promise<EngineResponse | null> {
  const { query, draft, analysis, onProgress } = args;
  const obvious = await extractObviousAnswer({ query, draft, analysis, onProgress });
  if (!obvious) return null;

  await notifyProgress(onProgress, "I’m generating hostile frames around the obvious answer");
  const frameSpecs = buildDynamicFrames(obvious);
  const rawFrames = await Promise.all(
    frameSpecs.map((frame) => runCollisionFrame({ query, analysis, obvious, frame, onProgress }))
  );

  const baseline = rawFrames.find((frame) => frame.kind === "baseline");
  if (!baseline) return null;

  const divergenceChecks = await Promise.all(
    rawFrames.map(async (frame) => {
      if (frame.kind === "baseline" || frame.status !== "complete") return frame;
      return judgeFrameDivergence({ baseline, hostile: frame, onProgress });
    })
  );

  const frames = rawFrames.map(
    (frame) => divergenceChecks.find((candidate) => candidate.id === frame.id) ?? frame
  );

  const usableFrames = frames.filter((frame) => frame.status === "complete");
  if (usableFrames.length < 2) return null;

  const collisionMap = await mineContradictions({
    query,
    analysis,
    obvious,
    frames,
    onProgress,
  });

  if (!collisionMap) return null;

  const candidates = await generateAsymmetricCandidates({
    query,
    obvious,
    frames,
    collisionMap,
    onProgress,
  });

  const ranked = await rankCandidates({
    query,
    obvious,
    candidates,
    onProgress,
  });

  const gateResults: CollisionCandidateGateResult[] = [];
  const updatedCandidates = [...ranked];
  let selectedCandidate: CollisionCandidate | undefined;

  for (const candidate of updatedCandidates.slice(0, 2)) {
    const training = await runTrainingCheck({ candidate, obvious, onProgress });
    if (!training.passed) {
      candidate.status = "killed";
      candidate.killedReason = training.reasons.join(" ");
      gateResults.push({
        candidateId: candidate.id,
        trainingCheck: "failed",
        webCheck: "not_run",
        reasons: training.reasons,
      });
      continue;
    }

    const web = await runWebConsensusCheck({ candidate, obvious, onProgress });
    if (web.state === "failed") {
      candidate.status = "killed";
      candidate.killedReason = web.reasons.join(" ");
      gateResults.push({
        candidateId: candidate.id,
        trainingCheck: "passed",
        webCheck: "failed",
        reasons: web.reasons,
      });
      continue;
    }

    if (web.state === "unavailable") {
      candidate.status = "fallback";
      candidate.killedReason = web.reasons.join(" ");
      gateResults.push({
        candidateId: candidate.id,
        trainingCheck: "passed",
        webCheck: "unavailable",
        reasons: web.reasons,
      });
      continue;
    }

    gateResults.push({
      candidateId: candidate.id,
      trainingCheck: "passed",
      webCheck: "passed",
      reasons: [...training.reasons, ...web.reasons].filter(Boolean),
      revivalNote: web.revivalNote,
    });
    selectedCandidate = candidate;
    break;
  }

  const trace: CollisionTrace = {
    kind: "collision",
    obviousAnswer: obvious,
    frames,
    collisionMap,
    candidates: updatedCandidates,
    gateResults,
    selectedCandidateId: selectedCandidate?.id,
    fallbackReason: selectedCandidate
      ? undefined
      : gateResults.some((result) => result.webCheck === "unavailable")
        ? "Hydra could not verify asymmetry on the web, so it returned the best plausible idea instead."
        : gateResults.length > 0
          ? "No candidate survived both the model-consensus check and the Firecrawl web-consensus check."
          : "Hydra could not generate a strong asymmetric candidate from the collision map.",
  };

  if (selectedCandidate) {
    const selectedGate = gateResults.find((result) => result.candidateId === selectedCandidate.id);
    const content = await synthesizeSelectedCandidate({
      query,
      obvious,
      collisionMap,
      candidate: selectedCandidate,
      gateResult: selectedGate,
      onProgress,
    });

    if (content) {
      return {
        content,
        status: "final",
        needsFollowup: false,
        trace,
      };
    }
  }

  const fallbackContent = await synthesizeFallbackAnswer({
    query,
    collisionMap,
    fallbackReason: trace.fallbackReason ?? "No candidate survived the asymmetry gate.",
    onProgress,
  });

  if (fallbackContent) {
    return {
      content: fallbackContent,
      status: "final",
      needsFollowup: false,
      trace,
    };
  }

  return {
    content: draft,
    status: "fallback",
    needsFollowup: false,
    trace,
  };
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
  onProgress?: ProgressReporter;
}): Promise<EngineResponse> {
  const { messages, draft, rigor, onProgress } = args;
  const query = messages[messages.length - 1]?.content ?? "";
  const seed = draft.trim() || DISCOVER_DRAFT_FALLBACK;

  if (!query.trim()) {
    return {
      content: seed,
      status: "fallback",
      needsFollowup: false,
    };
  }

  const analysis = await runAssumptionBreaker(query, onProgress);
  if (!analysis) {
    const revised = await reviewAndRevise({
      query,
      draft: seed,
      reviewSpecs: buildFallbackReviewSpecs(rigor),
      revisionInstructions: DISCOVER_REVISION_INSTRUCTIONS,
      onProgress,
    });

    return {
      content: revised.content,
      status: revised.revised ? "final" : "fallback",
      needsFollowup: false,
    };
  }

  if (rigor === "rigorous") {
    const asymmetry = await runAsymmetryGateDiscover({
      query,
      draft: seed,
      analysis,
      onProgress,
    });

    if (asymmetry) {
      return asymmetry;
    }
  }

  const proposal = await deriveConstraintFirstProposal({
    query,
    analysis,
    rigorous: rigor === "rigorous",
    onProgress,
  });

  if (!proposal) {
    const revised = await reviewAndRevise({
      query,
      draft: seed,
      reviewSpecs: buildFallbackReviewSpecs(rigor),
      revisionInstructions: DISCOVER_REVISION_INSTRUCTIONS,
      onProgress,
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
    onProgress,
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
    onProgress,
  });

  return {
    content: revised || proposal,
    status: revised ? "final" : "fallback",
    needsFollowup: false,
  };
}
