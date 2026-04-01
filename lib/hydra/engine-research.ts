import { MODELS } from "./models";
import { call, parseJSON } from "./openrouter";
import type {
  ChatMessage,
  EngineResponse,
  ProgressReporter,
  ResearchCandidate,
  ResearchCandidateConfidence,
  ResearchFrame,
  ResearchRejected,
  ResearchSearchAxis,
  ResearchSurvivor,
  ResearchTrace,
  Rigor,
} from "./types";

const RESEARCH_MODELS = {
  frame: MODELS.researchFrame.id,
  swarm: MODELS.researchSwarm.id,
  filter: MODELS.researchFilter.id,
  synthesize: MODELS.researchSynthesize.id,
} as const;

export const RESEARCH_MODEL_ID = [
  `frame:${RESEARCH_MODELS.frame}`,
  `swarm:${RESEARCH_MODELS.swarm}`,
  `filter:${RESEARCH_MODELS.filter}`,
  `synthesize:${RESEARCH_MODELS.synthesize}`,
].join(" | ");

const RESEARCH_DRAFT =
  "Frame is defining the rules before Swarm explores multiple axes, Filter cuts weak candidates, and Synthesize packages the winners.";
const RESEARCH_FALLBACK =
  "Hydra could not complete the Research pass within the current request budget. Please try again.";

const FRAME_STAGE = "Frame is defining the rules";
const SWARM_STAGE = "Swarm is exploring the search axes";
const FILTER_STAGE = "Filter is cutting weak candidates";
const SYNTHESIZE_STAGE = "Synthesize is packaging the winners";

const FRAME_PROMPT = `Given the user prompt, do not answer it yet.
Construct a framing object with:
- objective
- successCriteria
- disqualifiers
- commonTraps
- interpretations
- governingInterpretation
- searchAxes
- outputShape

Output ONLY JSON:
{
  "objective": "...",
  "successCriteria": ["..."],
  "disqualifiers": ["..."],
  "commonTraps": ["..."],
  "interpretations": ["..."],
  "governingInterpretation": "...",
  "searchAxes": [
    { "id": "A1", "label": "...", "prompt": "..." }
  ],
  "outputShape": "..."
}

Rules:
- Keep it compact and operational.
- Define the task more clearly than a one-shot answer would.
- searchAxes must be orthogonal search directions, not paraphrases.
- Do not answer the user.`;

const SWARM_PROMPT = `Using the framing object and assigned search axis, generate candidate ideas.

Output ONLY JSON:
{
  "candidates": [
    {
      "candidate": "...",
      "mechanism": "...",
      "whyItMayPersist": "...",
      "whyCheapOrWeakModelsMayBeWrong": "...",
      "residualRisk": "...",
      "confidence": "low|medium|high"
    }
  ]
}

Rules:
- Do not write a final answer.
- Do not rank.
- Do not polish.
- Generate only structured candidate objects.
- Prefer diversity over certainty.
- Stay inside the assigned search axis.`;

const FILTER_PROMPT = `Using the framing object, evaluate all candidate objects.

Your job is only to:
- reject invalid ideas
- dedupe similar ideas
- cluster near-duplicates
- keep the strongest survivors

Reject if:
- violates governing interpretation
- speculative instead of structural
- no persistence mechanism
- bots can obviously execute it
- no clear execution moat
- hidden directional risk dominates
- duplicate of stronger candidate
- too vague to operationalize

Output ONLY JSON:
{
  "survivors": [
    {
      "candidateId": "A1-1",
      "persistenceSource": "...",
      "residualRisk": "...",
      "whySurvived": "..."
    }
  ],
  "rejected": [
    {
      "candidateId": "A1-2",
      "fatalFlaw": "..."
    }
  ],
  "filterSummary": "..."
}

Rules:
- Do not synthesize the final answer.
- Do not try to be helpful.
- Be harsh.
- Preserve the strongest 3 to 5 survivors only.`;

const SYNTHESIZE_PROMPT = `Using the framing object and surviving candidates, produce the final answer.

Output ONLY JSON:
{
  "selectedCandidateIds": ["A1-1", "A2-1"],
  "answer": "..."
}

Your job:
- identify the strongest ideas
- explain why they survive
- explain briefly why the others failed
- answer in clear user-facing language

Rules:
- Do not revisit ideas that were already rejected unless necessary.
- Keep the answer clean and user-facing.
- Select only the strongest finalists requested.`;

const SYNTHESIZE_FALLBACK_PROMPT = `Using the framing object and the best remaining candidates, produce the strongest plausible answer without overstating certainty.

Output ONLY JSON:
{
  "selectedCandidateIds": ["A1-1", "A2-1"],
  "answer": "..."
}

Rules:
- Frame these as strongest plausible directions, not proven winners.
- Keep the answer ranked, clear, and practical.
- Mention the uncertainty briefly.`;

const FRAME_TIMEOUT_MS = 20_000;
const SWARM_TIMEOUT_MS = 14_000;
const FILTER_TIMEOUT_MS = 20_000;
const SYNTHESIZE_TIMEOUT_MS = 22_000;

interface FilterResult {
  survivors: ResearchSurvivor[];
  rejected: ResearchRejected[];
  filterSummary: string;
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

function getAxisCount(rigor: Rigor) {
  return rigor === "rigorous" ? 8 : 6;
}

function getCandidatesPerAxis(rigor: Rigor) {
  return rigor === "rigorous" ? 3 : 2;
}

function getSurvivorCount(rigor: Rigor) {
  return rigor === "rigorous" ? 5 : 3;
}

function getFinalCount(rigor: Rigor) {
  return rigor === "rigorous" ? 3 : 2;
}

function formatConversation(messages: ChatMessage[]) {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join("\n\n");
}

function normalizeConfidence(value: unknown): ResearchCandidateConfidence {
  return value === "low" || value === "high" ? value : "medium";
}

function buildFallbackFrame(query: string, rigor: Rigor): ResearchFrame {
  const axes: ResearchSearchAxis[] = [
    {
      id: "A1",
      label: "Structural friction",
      prompt: `Find structurally protected ideas in "${query}" created by operational friction or process burden.`,
    },
    {
      id: "A2",
      label: "Time asymmetry",
      prompt: `Find ideas in "${query}" created by lockups, delays, sequencing, or waiting periods.`,
    },
    {
      id: "A3",
      label: "Participant segmentation",
      prompt: `Find ideas in "${query}" created by differences between retail, institutional, or specialist participants.`,
    },
    {
      id: "A4",
      label: "Venue fragmentation",
      prompt: `Find ideas in "${query}" created by fragmented venues, disconnected systems, or broken transfer paths.`,
    },
    {
      id: "A5",
      label: "Capital constraints",
      prompt: `Find ideas in "${query}" created by collateral separation, capital lockup, or balance-sheet constraints.`,
    },
    {
      id: "A6",
      label: "Regulatory boundary",
      prompt: `Find ideas in "${query}" created by compliance, KYC, banking, or jurisdictional boundaries.`,
    },
    {
      id: "A7",
      label: "Behavioral persistence",
      prompt: `Find ideas in "${query}" that persist because participants choose convenience, speed, or narrative over optimization.`,
    },
    {
      id: "A8",
      label: "Trap detector",
      prompt: `Generate borderline ideas in "${query}" that look attractive but may be fake edge, so the filter can kill them.`,
    },
  ].slice(0, getAxisCount(rigor));

  return {
    objective: query.trim() || "Answer the user's research prompt.",
    successCriteria: [
      "Return structurally defensible ideas, not obvious defaults.",
      "Name the mechanism, persistence source, and residual risk clearly.",
      "Keep the final answer ranked and actionable.",
    ],
    disqualifiers: [
      "Pure speculation",
      "Obvious crowded or bot-dominated ideas",
      "Ideas with no clear persistence mechanism",
    ],
    commonTraps: [
      "Generic brainstorming dressed up as insight",
      "Narrative-heavy ideas with no execution moat",
      "Duplicate variants of the same basic mechanism",
    ],
    interpretations: [
      "Find structurally strong opportunities",
      "Eliminate fake but plausible-looking ideas",
      "Rank only the survivors that remain operationally credible",
    ],
    governingInterpretation:
      "Search broadly for structurally defensible ideas, then aggressively reject anything speculative, crowded, or weakly mechanistic.",
    searchAxes: axes,
    outputShape:
      "A ranked shortlist with the strongest ideas first, including mechanism, persistence, residual risk, and brief comparison against rejected alternatives.",
  };
}

function normalizeAxes(value: unknown, limit: number): ResearchSearchAxis[] {
  if (!Array.isArray(value)) return [];

  const axes = value
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
    .slice(0, limit);

  return uniqueBy(axes, (axis) => `${axis.label}:${axis.prompt}`);
}

function normalizeFrame(value: unknown, query: string, rigor: Rigor): ResearchFrame {
  const fallback = buildFallbackFrame(query, rigor);
  if (typeof value !== "object" || value === null) return fallback;

  const record = value as Record<string, unknown>;
  const searchAxes = normalizeAxes(record.searchAxes, getAxisCount(rigor));

  return {
    objective: toNonEmptyString(record.objective) || fallback.objective,
    successCriteria: normalizeStringArray(record.successCriteria, 6).length > 0
      ? normalizeStringArray(record.successCriteria, 6)
      : fallback.successCriteria,
    disqualifiers: normalizeStringArray(record.disqualifiers, 6).length > 0
      ? normalizeStringArray(record.disqualifiers, 6)
      : fallback.disqualifiers,
    commonTraps: normalizeStringArray(record.commonTraps, 6).length > 0
      ? normalizeStringArray(record.commonTraps, 6)
      : fallback.commonTraps,
    interpretations: normalizeStringArray(record.interpretations, 4).length > 0
      ? normalizeStringArray(record.interpretations, 4)
      : fallback.interpretations,
    governingInterpretation:
      toNonEmptyString(record.governingInterpretation) || fallback.governingInterpretation,
    searchAxes: searchAxes.length >= 4 ? searchAxes : fallback.searchAxes,
    outputShape: toNonEmptyString(record.outputShape) || fallback.outputShape,
  };
}

function formatFrame(frame: ResearchFrame) {
  return `Objective:
${frame.objective}

Success criteria:
${frame.successCriteria.map((item) => `- ${item}`).join("\n")}

Disqualifiers:
${frame.disqualifiers.map((item) => `- ${item}`).join("\n")}

Common traps:
${frame.commonTraps.map((item) => `- ${item}`).join("\n")}

Interpretations:
${frame.interpretations.map((item) => `- ${item}`).join("\n")}

Governing interpretation:
${frame.governingInterpretation}

Output shape:
${frame.outputShape}`;
}

function formatCandidate(candidate: ResearchCandidate) {
  return `[${candidate.id}] ${candidate.candidate}
Axis: ${candidate.axisLabel}
Mechanism: ${candidate.mechanism}
Why it may persist: ${candidate.whyItMayPersist}
Why weak models may be wrong: ${candidate.whyCheapOrWeakModelsMayBeWrong}
Residual risk: ${candidate.residualRisk}
Confidence: ${candidate.confidence}`;
}

function normalizeCandidates(
  value: unknown,
  axis: ResearchSearchAxis,
  perAxis: number
): ResearchCandidate[] {
  const raw =
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).candidates)
      ? ((value as Record<string, unknown>).candidates as unknown[])
      : [];

  const candidates = raw
    .map((entry, index) => {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const candidate = toNonEmptyString(record.candidate);
      const mechanism = toNonEmptyString(record.mechanism);
      const whyItMayPersist = toNonEmptyString(record.whyItMayPersist);
      const whyCheapOrWeakModelsMayBeWrong = toNonEmptyString(
        record.whyCheapOrWeakModelsMayBeWrong
      );
      const residualRisk = toNonEmptyString(record.residualRisk);

      if (!candidate || !mechanism || !whyItMayPersist) return null;

      return {
        id: `${axis.id}-${index + 1}`,
        axisId: axis.id,
        axisLabel: axis.label,
        candidate,
        mechanism,
        whyItMayPersist,
        whyCheapOrWeakModelsMayBeWrong:
          whyCheapOrWeakModelsMayBeWrong || "The mechanism may collapse if the friction is weaker than it looks.",
        residualRisk: residualRisk || "Residual execution or directional risk remains.",
        confidence: normalizeConfidence(record.confidence),
      } satisfies ResearchCandidate;
    })
    .filter((entry): entry is ResearchCandidate => entry !== null)
    .slice(0, perAxis);

  return uniqueBy(candidates, (item) => `${item.candidate}:${item.mechanism}`);
}

function buildFallbackFilter(candidates: ResearchCandidate[], rigor: Rigor): FilterResult {
  const survivorLimit = getSurvivorCount(rigor);
  const deduped = uniqueBy(candidates, (item) => `${item.candidate}:${item.mechanism}`);
  const survivors = deduped.slice(0, survivorLimit).map((candidate) => ({
    candidateId: candidate.id,
    axisId: candidate.axisId,
    axisLabel: candidate.axisLabel,
    candidate: candidate.candidate,
    mechanism: candidate.mechanism,
    persistenceSource: candidate.whyItMayPersist,
    residualRisk: candidate.residualRisk,
    whySurvived: "Retained by fallback heuristic because the structured filter output was unavailable.",
  }));
  const survivorIds = new Set(survivors.map((item) => item.candidateId));
  const rejected = deduped
    .filter((candidate) => !survivorIds.has(candidate.id))
    .map((candidate) => ({
      candidateId: candidate.id,
      axisId: candidate.axisId,
      axisLabel: candidate.axisLabel,
      candidate: candidate.candidate,
      fatalFlaw: "Rejected by fallback heuristic because a stronger or earlier candidate took the slot.",
    }));

  return {
    survivors,
    rejected,
    filterSummary:
      "The filter step fell back to a heuristic shortlist because the structured loser-slashing output was unavailable.",
  };
}

function normalizeFilterResult(
  value: unknown,
  candidates: ResearchCandidate[],
  rigor: Rigor
): FilterResult {
  const fallback = buildFallbackFilter(candidates, rigor);
  if (typeof value !== "object" || value === null) return fallback;

  const record = value as Record<string, unknown>;
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  const survivors = Array.isArray(record.survivors)
    ? record.survivors
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const item = entry as Record<string, unknown>;
          const candidateId = toNonEmptyString(item.candidateId);
          const source = candidateMap.get(candidateId);
          if (!source) return null;

          return {
            candidateId,
            axisId: source.axisId,
            axisLabel: source.axisLabel,
            candidate: source.candidate,
            mechanism: source.mechanism,
            persistenceSource:
              toNonEmptyString(item.persistenceSource) || source.whyItMayPersist,
            residualRisk: toNonEmptyString(item.residualRisk) || source.residualRisk,
            whySurvived:
              toNonEmptyString(item.whySurvived) ||
              "The filter retained this candidate as one of the strongest survivors.",
          } satisfies ResearchSurvivor;
        })
        .filter((entry): entry is ResearchSurvivor => entry !== null)
    : [];

  const rejected = Array.isArray(record.rejected)
    ? record.rejected
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const item = entry as Record<string, unknown>;
          const candidateId = toNonEmptyString(item.candidateId);
          const source = candidateMap.get(candidateId);
          if (!source) return null;

          return {
            candidateId,
            axisId: source.axisId,
            axisLabel: source.axisLabel,
            candidate: source.candidate,
            fatalFlaw:
              toNonEmptyString(item.fatalFlaw) ||
              "Rejected because the filter did not return a defensible rationale.",
          } satisfies ResearchRejected;
        })
        .filter((entry): entry is ResearchRejected => entry !== null)
    : [];

  const normalizedSurvivors = uniqueBy(survivors, (item) => item.candidateId).slice(
    0,
    getSurvivorCount(rigor)
  );

  if (normalizedSurvivors.length === 0) return fallback;

  const normalizedRejected = uniqueBy(
    [
      ...rejected,
      ...candidates
        .filter((candidate) => !normalizedSurvivors.some((item) => item.candidateId === candidate.id))
        .map((candidate) => ({
          candidateId: candidate.id,
          axisId: candidate.axisId,
          axisLabel: candidate.axisLabel,
          candidate: candidate.candidate,
          fatalFlaw: "Rejected because a stronger survivor displaced it.",
        })),
    ],
    (item) => item.candidateId
  );

  return {
    survivors: normalizedSurvivors,
    rejected: normalizedRejected,
    filterSummary:
      toNonEmptyString(record.filterSummary) ||
      `The filter reduced ${candidates.length} raw candidates to ${normalizedSurvivors.length} survivors.`,
  };
}

function buildTrace(args: {
  frame: ResearchFrame;
  generatedCandidates: ResearchCandidate[];
  filter: FilterResult;
  selectedCandidateIds: string[];
  fallbackReason?: string;
}): ResearchTrace {
  return {
    kind: "research",
    frame: args.frame,
    axes: args.frame.searchAxes,
    generatedCandidates: args.generatedCandidates,
    survivors: args.filter.survivors,
    rejected: args.filter.rejected,
    selectedCandidateIds: args.selectedCandidateIds,
    filterSummary: args.filter.filterSummary,
    ...(args.fallbackReason ? { fallbackReason: args.fallbackReason } : {}),
  };
}

async function notifyProgress(onProgress: ProgressReporter | undefined, label: string) {
  if (!onProgress) return;
  await onProgress({ label });
}

async function runFrame(messages: ChatMessage[], rigor: Rigor) {
  const query = messages[messages.length - 1]?.content ?? "";
  const axisCount = getAxisCount(rigor);

  const raw = await call(
    RESEARCH_MODELS.frame,
    [
      { role: "system", content: FRAME_PROMPT },
      {
        role: "user",
        content: `Conversation:
${formatConversation(messages)}

Additional guidance:
- Return exactly ${axisCount} search axes.
- Keep the framing compact and operational.
- Balanced should stay lean. Rigorous can search a bit wider.`,
      },
    ],
    {
      maxTokens: rigor === "rigorous" ? 1_200 : 900,
      temperature: 0.1,
      timeoutMs: FRAME_TIMEOUT_MS,
      reasoning: {
        effort: rigor === "rigorous" ? "low" : "minimal",
        exclude: true,
      },
    }
  );

  return normalizeFrame(parseJSON<Record<string, unknown>>(raw, {}), query, rigor);
}

async function runSwarm(args: {
  frame: ResearchFrame;
  rigor: Rigor;
}) {
  const { frame, rigor } = args;
  const perAxis = getCandidatesPerAxis(rigor);

  const settled = await Promise.allSettled(
    frame.searchAxes.map(async (axis) => {
      const raw = await call(
        RESEARCH_MODELS.swarm,
        [
          { role: "system", content: SWARM_PROMPT },
          {
            role: "user",
            content: `Framing object:
${formatFrame(frame)}

Assigned search axis:
${axis.label}

Axis prompt:
${axis.prompt}

Additional guidance:
- Return up to ${perAxis} candidates for this axis.
- Generate candidate objects only.`,
          },
        ],
        {
          maxTokens: rigor === "rigorous" ? 700 : 550,
          temperature: rigor === "rigorous" ? 0.45 : 0.35,
          timeoutMs: SWARM_TIMEOUT_MS,
          reasoning: {
            effort: "none",
            exclude: true,
          },
        }
      );

      return normalizeCandidates(parseJSON<Record<string, unknown>>(raw, {}), axis, perAxis);
    })
  );

  return uniqueBy(
    settled.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    (candidate) => `${candidate.candidate}:${candidate.mechanism}`
  );
}

async function runFilter(args: {
  frame: ResearchFrame;
  candidates: ResearchCandidate[];
  rigor: Rigor;
}) {
  const { frame, candidates, rigor } = args;
  if (candidates.length === 0) return buildFallbackFilter([], rigor);

  const raw = await call(
    RESEARCH_MODELS.filter,
    [
      { role: "system", content: FILTER_PROMPT },
      {
        role: "user",
        content: `Framing object:
${formatFrame(frame)}

Candidates:
${candidates.map((candidate) => formatCandidate(candidate)).join("\n\n")}

Additional guidance:
- Keep at most ${getSurvivorCount(rigor)} survivors.
- Reject aggressively.`,
      },
    ],
    {
      maxTokens: rigor === "rigorous" ? 1_500 : 1_100,
      temperature: 0.1,
      timeoutMs: FILTER_TIMEOUT_MS,
      reasoning: {
        effort: rigor === "rigorous" ? "medium" : "low",
        exclude: true,
      },
    }
  );

  return normalizeFilterResult(parseJSON<Record<string, unknown>>(raw, {}), candidates, rigor);
}

async function runSynthesize(args: {
  frame: ResearchFrame;
  filter: FilterResult;
  rigor: Rigor;
  fallbackMode?: boolean;
  fallbackReason?: string;
}) {
  const { frame, filter, rigor, fallbackMode, fallbackReason } = args;
  const finalCount = getFinalCount(rigor);
  const prompt = fallbackMode ? SYNTHESIZE_FALLBACK_PROMPT : SYNTHESIZE_PROMPT;

  const raw = await call(
    RESEARCH_MODELS.synthesize,
    [
      { role: "system", content: prompt },
      {
        role: "user",
        content: `Framing object:
${formatFrame(frame)}

Survivors:
${filter.survivors
  .map(
    (survivor) => `[${survivor.candidateId}] ${survivor.candidate}
Axis: ${survivor.axisLabel}
Mechanism: ${survivor.mechanism}
Persistence source: ${survivor.persistenceSource}
Residual risk: ${survivor.residualRisk}
Why it survived: ${survivor.whySurvived}`
  )
  .join("\n\n")}

Rejected summary:
${filter.rejected.length > 0 ? filter.rejected.map((item) => `- ${item.candidateId}: ${item.fatalFlaw}`).join("\n") : "- No rejected candidates were returned."}

Filter summary:
${filter.filterSummary}

${fallbackReason ? `Fallback reason:\n${fallbackReason}\n\n` : ""}Additional guidance:
- Choose at most ${finalCount} finalists.
- Follow this output shape: ${frame.outputShape}`,
      },
    ],
    {
      maxTokens: rigor === "rigorous" ? 1_800 : 1_400,
      temperature: 0.2,
      timeoutMs: SYNTHESIZE_TIMEOUT_MS,
      reasoning: {
        effort: rigor === "rigorous" ? "low" : "minimal",
        exclude: true,
      },
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const answer = toNonEmptyString(parsed.answer) || raw.trim();
  const selectedCandidateIds = Array.isArray(parsed.selectedCandidateIds)
    ? (parsed.selectedCandidateIds as unknown[])
        .filter((item): item is string => typeof item === "string")
        .slice(0, finalCount)
    : [];

  return {
    answer,
    selectedCandidateIds:
      selectedCandidateIds.length > 0
        ? selectedCandidateIds
        : filter.survivors.slice(0, finalCount).map((item) => item.candidateId),
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

  await notifyProgress(onProgress, SWARM_STAGE);
  const generatedCandidates = await runSwarm({ frame, rigor });
  if (generatedCandidates.length === 0) {
    return {
      content: seed,
      status: "fallback",
      needsFollowup: false,
      trace: buildTrace({
        frame,
        generatedCandidates: [],
        filter: {
          survivors: [],
          rejected: [],
          filterSummary: "Swarm did not return any usable candidates.",
        },
        selectedCandidateIds: [],
        fallbackReason: "Swarm did not produce any structured candidate ideas.",
      }),
    };
  }

  await notifyProgress(onProgress, FILTER_STAGE);
  const filter = await runFilter({ frame, candidates: generatedCandidates, rigor });

  await notifyProgress(onProgress, SYNTHESIZE_STAGE);
  const survivors =
    filter.survivors.length > 0
      ? filter.survivors
      : buildFallbackFilter(generatedCandidates, rigor).survivors;
  const fallbackReason =
    filter.survivors.length > 0
      ? undefined
      : "Filter rejected or lost every candidate, so Hydra is returning the strongest plausible shortlist.";

  const synthesized = await runSynthesize({
    frame,
    filter: {
      ...filter,
      survivors,
    },
    rigor,
    fallbackMode: filter.survivors.length === 0,
    fallbackReason,
  });

  return {
    content: synthesized.answer || seed,
    status: synthesized.answer ? "final" : "fallback",
    needsFollowup: false,
    trace: buildTrace({
      frame,
      generatedCandidates,
      filter: {
        ...filter,
        survivors,
      },
      selectedCandidateIds: synthesized.selectedCandidateIds,
      fallbackReason,
    }),
  };
}
