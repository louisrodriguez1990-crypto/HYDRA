import { MODELS } from "./models";
import { call, parseJSON } from "./openrouter";
import { runRepoContextQueries } from "./repo-context";
import { runSearchQueries } from "./search";
import type {
  ChatMessage,
  EngineResponse,
  ProgressReporter,
  Rigor,
  ThreePhaseArchitectTrace,
  ThreePhaseDirectorTrace,
  ThreePhaseScopingDocument,
  ThreePhaseTrace,
  ThreePhaseWorkerBrief,
  ThreePhaseWorkerTrace,
} from "./types";

export const THREE_PHASE_MODEL_ID = MODELS.reasoner.id;

const THREE_PHASE_DRAFT =
  "Director is gathering context and shaping the brief before Architect and Worker take over.";
const THREE_PHASE_FALLBACK =
  "Hydra could not complete the Director > Architect > Worker pass within the current request budget. Please try again.";

const CODE_CONTEXT_PATTERN =
  /```|\b(repo|repository|codebase|component|module|function|file|folder|route|api|app\/|lib\/|package\.json|next\.config|vercel\.json|tsx?|jsx?|bug|build|lint|test|typecheck|compile|refactor|implement|fix)\b/i;
const WEB_CONTEXT_PATTERN =
  /\b(latest|current|today|recent|news|look up|lookup|search online|search the web|verify|fact check|release|version|price|pricing|president|ceo|weather|score|schedule|stock|market|as of)\b/i;

const DIRECTOR_PLAN_PROMPT = `You are Director.

Your job is to gather the relevant context and decide what the downstream layers need.
You do NOT answer the user's question.

Output ONLY JSON with this shape:
{
  "scopingDocument": {
    "realProblem": "...",
    "frames": ["..."],
    "lazyMisses": ["..."],
    "criticalConstraints": ["..."],
    "dataNeededNext": ["..."]
  },
  "retrievalPlan": {
    "needsRepoContext": true,
    "needsWebContext": false,
    "repoQueries": ["..."],
    "webQueries": ["..."],
    "reason": "..."
  }
}

Rules:
- Use the full thread, not just the last message.
- Use repo context when the task is codebase- or file-oriented.
- Use web context when the task is current, factual, or explicitly asks to look something up.
- Skip external retrieval for generic prompts that can be answered from the thread alone.
- Keep queries short and targeted.
- Return at most 3 repo queries and 3 web queries.
- Be concrete and concise.
- Do not answer the question.`;

const DIRECTOR_CONSOLIDATE_PROMPT = `You are Director.

You already scoped the problem and have now seen any retrieved context.
Produce the final brief for Architect.

Output ONLY JSON with this shape:
{
  "scopingDocument": {
    "realProblem": "...",
    "frames": ["..."],
    "lazyMisses": ["..."],
    "criticalConstraints": ["..."],
    "dataNeededNext": ["..."]
  },
  "architectBrief": "...",
  "retrievedContextSummary": "...",
  "limitations": ["..."]
}

Rules:
- The architectBrief should explain what matters, what to optimize for, and what not to ignore.
- Limitations should mention missing, failed, weak, or uncertain context when relevant.
- If retrieval failed, still produce a usable brief.
- Do not answer the user's question.`;

const ARCHITECT_ANALYSIS_PROMPT = `You are Architect.

The Director brief is binding. Your job is to reason deeply inside that scope.

Output ONLY JSON with this shape:
{
  "analysis": "...",
  "degradedAnswer": "..."
}

Rules:
- analysis should do the real reasoning.
- degradedAnswer must be a safe user-facing fallback only if Worker fails later.
- Keep degradedAnswer shorter and cleaner than analysis.
- Do not mention Director, Architect, Worker, or internal process.`;

const ARCHITECT_WORKER_BRIEF_PROMPT = `You are Architect.

Use the Director brief and your own analysis to prompt-engineer the Worker.

Output ONLY JSON with this shape:
{
  "answerShape": "...",
  "mustInclude": ["..."],
  "mustAvoid": ["..."],
  "tone": "...",
  "uncertaintyHandling": "...",
  "instructions": ["..."]
}

Rules:
- Tell the Worker exactly how the answer should be shaped.
- mustInclude should capture the non-negotiable ideas.
- mustAvoid should name the failure modes in the final answer style.
- instructions should be concrete and execution-ready.
- Do not answer the user's question yourself.`;

const WORKER_PROMPT = `You are Worker.

You do not do fresh reasoning. You execute the Architect brief using the provided analysis.

Rules:
- Start with the answer.
- Follow the answerShape, mustInclude, mustAvoid, tone, uncertaintyHandling, and instructions exactly.
- Use the analysis only as support; do not expose the internal scaffolding.
- If the analysis is uncertain, follow the uncertaintyHandling guidance instead of inventing certainty.
- Do not mention Director, Architect, Worker, or the internal pipeline.`;

interface DirectorRetrievalPlan {
  needsRepoContext: boolean;
  needsWebContext: boolean;
  repoQueries: string[];
  webQueries: string[];
  reason: string;
}

interface DirectorPlanResponse {
  scopingDocument: ThreePhaseScopingDocument;
  retrievalPlan: DirectorRetrievalPlan;
}

interface DirectorConsolidationResponse {
  scopingDocument: ThreePhaseScopingDocument;
  architectBrief: string;
  retrievedContextSummary: string;
  limitations: string[];
}

interface ArchitectAnalysisResponse {
  analysis: string;
  degradedAnswer: string;
}

interface RetrievalOutcome {
  retrievalQueries: string[];
  retrievalContext: string;
  retrievedContextSummary: string;
  limitations: string[];
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown, limit = 6) {
  if (!Array.isArray(value)) return [];

  const items = value
    .map((item) => toNonEmptyString(item))
    .filter(Boolean);

  return [...new Set(items)].slice(0, limit);
}

function normalizeScopingDocument(value: unknown): ThreePhaseScopingDocument | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const realProblem = toNonEmptyString(record.realProblem);
  const frames = normalizeStringArray(record.frames, 5);
  const lazyMisses = normalizeStringArray(record.lazyMisses, 5);
  const criticalConstraints = normalizeStringArray(record.criticalConstraints, 5);
  const dataNeededNext = normalizeStringArray(record.dataNeededNext, 5);

  if (!realProblem) return null;

  return {
    realProblem,
    frames,
    lazyMisses,
    criticalConstraints,
    dataNeededNext,
  };
}

function normalizeRetrievalPlan(value: unknown): DirectorRetrievalPlan | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;

  return {
    needsRepoContext: record.needsRepoContext === true,
    needsWebContext: record.needsWebContext === true,
    repoQueries: normalizeStringArray(record.repoQueries, 3),
    webQueries: normalizeStringArray(record.webQueries, 3),
    reason: toNonEmptyString(record.reason),
  };
}

function normalizeWorkerBrief(value: unknown): ThreePhaseWorkerBrief | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const answerShape = toNonEmptyString(record.answerShape);
  const tone = toNonEmptyString(record.tone);
  const uncertaintyHandling = toNonEmptyString(record.uncertaintyHandling);
  const mustInclude = normalizeStringArray(record.mustInclude, 6);
  const mustAvoid = normalizeStringArray(record.mustAvoid, 6);
  const instructions = normalizeStringArray(record.instructions, 8);

  if (!answerShape || !tone || !uncertaintyHandling) {
    return null;
  }

  return {
    answerShape,
    mustInclude,
    mustAvoid,
    tone,
    uncertaintyHandling,
    instructions,
  };
}

function formatConversation(messages: ChatMessage[]) {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join("\n\n");
}

function formatScopingDocument(scopingDocument: ThreePhaseScopingDocument) {
  return `Real problem:
${scopingDocument.realProblem}

Frames:
${scopingDocument.frames.length > 0 ? scopingDocument.frames.map((item) => `- ${item}`).join("\n") : "- None named"}

What a lazy answer would miss:
${scopingDocument.lazyMisses.length > 0 ? scopingDocument.lazyMisses.map((item) => `- ${item}`).join("\n") : "- None named"}

Critical constraints:
${scopingDocument.criticalConstraints.length > 0 ? scopingDocument.criticalConstraints.map((item) => `- ${item}`).join("\n") : "- None named"}

Data needed next:
${scopingDocument.dataNeededNext.length > 0 ? scopingDocument.dataNeededNext.map((item) => `- ${item}`).join("\n") : "- None named"}`;
}

function formatWorkerBrief(workerBrief: ThreePhaseWorkerBrief) {
  return `Answer shape:
${workerBrief.answerShape}

Tone:
${workerBrief.tone}

Uncertainty handling:
${workerBrief.uncertaintyHandling}

Must include:
${workerBrief.mustInclude.length > 0 ? workerBrief.mustInclude.map((item) => `- ${item}`).join("\n") : "- None named"}

Must avoid:
${workerBrief.mustAvoid.length > 0 ? workerBrief.mustAvoid.map((item) => `- ${item}`).join("\n") : "- None named"}

Instructions:
${workerBrief.instructions.length > 0 ? workerBrief.instructions.map((item) => `- ${item}`).join("\n") : "- None named"}`;
}

function buildDraftResponse(): EngineResponse {
  return {
    content: THREE_PHASE_DRAFT,
    status: "draft",
    needsFollowup: true,
  };
}

function buildTrace(args: {
  director: ThreePhaseDirectorTrace;
  architect?: ThreePhaseArchitectTrace;
  worker?: ThreePhaseWorkerTrace;
}): ThreePhaseTrace {
  return {
    kind: "three_phase",
    director: args.director,
    ...(args.architect ? { architect: args.architect } : {}),
    ...(args.worker ? { worker: args.worker } : {}),
  };
}

function buildFallbackScopingDocument(query: string): ThreePhaseScopingDocument {
  return {
    realProblem: query.trim() || "Answer the user's request directly.",
    frames: ["Answer the question directly", "Preserve the key constraint or tradeoff"],
    lazyMisses: ["Missing the real constraint", "Answering too generically"],
    criticalConstraints: [],
    dataNeededNext: [],
  };
}

function buildFallbackDirectorPlan(query: string, needsRepoContext: boolean, needsWebContext: boolean): DirectorPlanResponse {
  return {
    scopingDocument: buildFallbackScopingDocument(query),
    retrievalPlan: {
      needsRepoContext,
      needsWebContext,
      repoQueries: needsRepoContext ? [query] : [],
      webQueries: needsWebContext ? [query] : [],
      reason: "Fallback heuristics were used because the Director planning output was unavailable.",
    },
  };
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function looksCodebaseOrFileTask(messages: ChatMessage[]) {
  const thread = messages.map((message) => message.content).join("\n");
  return CODE_CONTEXT_PATTERN.test(thread);
}

function looksWebFactTask(messages: ChatMessage[]) {
  const thread = messages.map((message) => message.content).join("\n");
  return WEB_CONTEXT_PATTERN.test(thread);
}

function buildWebWindow(messages: ChatMessage[]): "recent" | "any" {
  const thread = messages.map((message) => message.content).join("\n");
  return /\b(latest|current|today|recent|news|release|version|price|pricing|president|ceo|score|schedule|weather|stock|market|as of)\b/i.test(
    thread
  )
    ? "recent"
    : "any";
}

function buildDirectorPlanUserPrompt(messages: ChatMessage[], rigor: Rigor) {
  return `Conversation:
${formatConversation(messages)}

Additional guidance:
${rigor === "rigorous"
  ? "Be strict about hidden constraints, missing variables, and when retrieval is actually needed."
  : "Keep the scope sharp and practical."}`;
}

function buildDirectorConsolidationUserPrompt(args: {
  messages: ChatMessage[];
  plan: DirectorPlanResponse;
  retrieval: RetrievalOutcome;
  rigor: Rigor;
}) {
  const { messages, plan, retrieval, rigor } = args;
  return `Conversation:
${formatConversation(messages)}

Initial scoping:
${formatScopingDocument(plan.scopingDocument)}

Retrieval plan:
Reason: ${plan.retrievalPlan.reason || "Not specified"}
Repo queries: ${plan.retrievalPlan.repoQueries.length > 0 ? plan.retrievalPlan.repoQueries.join(" | ") : "None"}
Web queries: ${plan.retrievalPlan.webQueries.length > 0 ? plan.retrievalPlan.webQueries.join(" | ") : "None"}

Retrieved context:
${retrieval.retrievalContext}

Known limitations:
${retrieval.limitations.length > 0 ? retrieval.limitations.map((item) => `- ${item}`).join("\n") : "- None named"}

Additional guidance:
${rigor === "rigorous"
  ? "Make the brief systematic and explicit about what the Architect must not ignore."
  : "Keep the brief direct and high-signal."}`;
}

function buildArchitectAnalysisUserPrompt(messages: ChatMessage[], directorBrief: string, rigor: Rigor) {
  return `Conversation:
${formatConversation(messages)}

Director brief:
${directorBrief}

Additional guidance:
${rigor === "rigorous"
  ? "Stress-test the answer and name the strongest objection before settling."
  : "Reason deeply, but stay practical."}`;
}

function buildArchitectWorkerBriefUserPrompt(args: {
  messages: ChatMessage[];
  directorBrief: string;
  analysis: string;
}) {
  const { messages, directorBrief, analysis } = args;
  return `Conversation:
${formatConversation(messages)}

Director brief:
${directorBrief}

Architect analysis:
${analysis}`;
}

function buildWorkerUserPrompt(args: {
  messages: ChatMessage[];
  analysis: string;
  workerBrief: ThreePhaseWorkerBrief;
}) {
  const { messages, analysis, workerBrief } = args;
  return `Conversation:
${formatConversation(messages)}

Architect analysis:
${analysis}

Worker brief:
${formatWorkerBrief(workerBrief)}`;
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

async function gatherRetrieval(args: {
  messages: ChatMessage[];
  plan: DirectorPlanResponse;
}): Promise<RetrievalOutcome> {
  const { messages, plan } = args;
  const query = messages[messages.length - 1]?.content ?? "";
  const needsRepoByHeuristic = looksCodebaseOrFileTask(messages);
  const needsWebByHeuristic = looksWebFactTask(messages);

  const repoQueries = uniqueStrings([
    ...(plan.retrievalPlan.needsRepoContext || needsRepoByHeuristic
      ? plan.retrievalPlan.repoQueries
      : []),
    ...(plan.retrievalPlan.needsRepoContext || needsRepoByHeuristic ? [query] : []),
  ]).slice(0, 3);
  const webQueries = uniqueStrings([
    ...(plan.retrievalPlan.needsWebContext || needsWebByHeuristic
      ? plan.retrievalPlan.webQueries
      : []),
    ...(plan.retrievalPlan.needsWebContext || needsWebByHeuristic ? [query] : []),
  ]).slice(0, 3);

  const retrievalQueries = [...repoQueries, ...webQueries];
  const limitations: string[] = [];
  const contextBlocks: string[] = [];
  const summaryLines: string[] = [];

  const [repoContext, webContext] = await Promise.all([
    repoQueries.length > 0 ? runRepoContextQueries(repoQueries) : Promise.resolve(null),
    webQueries.length > 0 ? runSearchQueries(webQueries, buildWebWindow(messages)) : Promise.resolve(null),
  ]);

  if (repoContext) {
    contextBlocks.push(formatRepoContext(repoContext));
    const repoMatches = repoContext.queries.reduce(
      (count, item) => count + item.matches.length,
      0
    );
    summaryLines.push(
      repoMatches > 0
        ? `Repo retrieval found ${repoMatches} relevant file snippets.`
        : "Repo retrieval did not find relevant file snippets."
    );

    if (!repoContext.available && repoContext.error) {
      limitations.push(`Repo retrieval was limited: ${repoContext.error}`);
    }
  }

  if (webContext) {
    contextBlocks.push(formatWebContext(webContext));
    const webMatches = webContext.queries.reduce(
      (count, item) => count + item.results.length,
      0
    );
    summaryLines.push(
      webMatches > 0
        ? `Web retrieval found ${webMatches} relevant results.`
        : "Web retrieval did not find relevant results."
    );

    if (!webContext.available && webContext.error) {
      limitations.push(`Web retrieval was limited: ${webContext.error}`);
    }
  }

  if (retrievalQueries.length === 0) {
    summaryLines.push("No extra retrieval was needed beyond the thread context.");
  }

  return {
    retrievalQueries,
    retrievalContext:
      contextBlocks.length > 0
        ? contextBlocks.filter(Boolean).join("\n\n")
        : "No extra retrieval context was used.",
    retrievedContextSummary: summaryLines.join(" "),
    limitations,
  };
}

function buildDirectorTrace(args: {
  consolidated: DirectorConsolidationResponse;
  retrieval: RetrievalOutcome;
}): ThreePhaseDirectorTrace {
  const { consolidated, retrieval } = args;
  return {
    scopingDocument: consolidated.scopingDocument,
    retrievalQueries: retrieval.retrievalQueries,
    retrievedContextSummary:
      consolidated.retrievedContextSummary || retrieval.retrievedContextSummary,
    limitations: uniqueStrings([...retrieval.limitations, ...consolidated.limitations]),
  };
}

async function runDirectorPlan(messages: ChatMessage[], rigor: Rigor) {
  const query = messages[messages.length - 1]?.content ?? "";
  const raw = await call(
    THREE_PHASE_MODEL_ID,
    [
      { role: "system", content: DIRECTOR_PLAN_PROMPT },
      { role: "user", content: buildDirectorPlanUserPrompt(messages, rigor) },
    ],
    {
      maxTokens: rigor === "rigorous" ? 900 : 700,
      temperature: 0.15,
      timeoutMs: 20_000,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const scopingDocument = normalizeScopingDocument(parsed.scopingDocument);
  const retrievalPlan = normalizeRetrievalPlan(parsed.retrievalPlan);

  if (!scopingDocument || !retrievalPlan) {
    return buildFallbackDirectorPlan(
      query,
      looksCodebaseOrFileTask(messages),
      looksWebFactTask(messages)
    );
  }

  return {
    scopingDocument,
    retrievalPlan,
  } satisfies DirectorPlanResponse;
}

async function runDirectorConsolidation(args: {
  messages: ChatMessage[];
  plan: DirectorPlanResponse;
  retrieval: RetrievalOutcome;
  rigor: Rigor;
}) {
  const { messages, plan, retrieval, rigor } = args;
  const raw = await call(
    THREE_PHASE_MODEL_ID,
    [
      { role: "system", content: DIRECTOR_CONSOLIDATE_PROMPT },
      {
        role: "user",
        content: buildDirectorConsolidationUserPrompt({
          messages,
          plan,
          retrieval,
          rigor,
        }),
      },
    ],
    {
      maxTokens: rigor === "rigorous" ? 1_200 : 950,
      temperature: 0.1,
      timeoutMs: 24_000,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const scopingDocument = normalizeScopingDocument(parsed.scopingDocument);
  const architectBrief = toNonEmptyString(parsed.architectBrief);
  const retrievedContextSummary = toNonEmptyString(parsed.retrievedContextSummary);
  const limitations = normalizeStringArray(parsed.limitations, 6);

  if (!scopingDocument || !architectBrief) {
    return {
      scopingDocument: plan.scopingDocument,
      architectBrief: [
        plan.scopingDocument.realProblem,
        ...plan.scopingDocument.frames,
        ...plan.scopingDocument.criticalConstraints,
      ]
        .filter(Boolean)
        .join(" "),
      retrievedContextSummary: retrieval.retrievedContextSummary,
      limitations: uniqueStrings([
        ...retrieval.limitations,
        "Director consolidation fell back to the initial scoping plan.",
      ]),
    } satisfies DirectorConsolidationResponse;
  }

  return {
    scopingDocument,
    architectBrief,
    retrievedContextSummary:
      retrievedContextSummary || retrieval.retrievedContextSummary,
    limitations,
  } satisfies DirectorConsolidationResponse;
}

async function runArchitectAnalysis(args: {
  messages: ChatMessage[];
  directorBrief: string;
  rigor: Rigor;
}) {
  const raw = await call(
    THREE_PHASE_MODEL_ID,
    [
      { role: "system", content: ARCHITECT_ANALYSIS_PROMPT },
      {
        role: "user",
        content: buildArchitectAnalysisUserPrompt(
          args.messages,
          args.directorBrief,
          args.rigor
        ),
      },
    ],
    {
      maxTokens: args.rigor === "rigorous" ? 2_400 : 1_900,
      temperature: 0.2,
      timeoutMs: 40_000,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  const analysis = toNonEmptyString(parsed.analysis);
  const degradedAnswer = toNonEmptyString(parsed.degradedAnswer);

  if (!analysis) return null;

  return {
    analysis,
    degradedAnswer,
  } satisfies ArchitectAnalysisResponse;
}

async function runArchitectWorkerBrief(args: {
  messages: ChatMessage[];
  directorBrief: string;
  analysis: string;
}) {
  const raw = await call(
    THREE_PHASE_MODEL_ID,
    [
      { role: "system", content: ARCHITECT_WORKER_BRIEF_PROMPT },
      {
        role: "user",
        content: buildArchitectWorkerBriefUserPrompt({
          messages: args.messages,
          directorBrief: args.directorBrief,
          analysis: args.analysis,
        }),
      },
    ],
    {
      maxTokens: 1_200,
      temperature: 0.15,
      timeoutMs: 24_000,
    }
  );

  const parsed = parseJSON<Record<string, unknown>>(raw, {});
  return normalizeWorkerBrief(parsed);
}

async function runWorker(args: {
  messages: ChatMessage[];
  analysis: string;
  workerBrief: ThreePhaseWorkerBrief;
}) {
  const raw = await call(
    THREE_PHASE_MODEL_ID,
    [
      { role: "system", content: WORKER_PROMPT },
      {
        role: "user",
        content: buildWorkerUserPrompt({
          messages: args.messages,
          analysis: args.analysis,
          workerBrief: args.workerBrief,
        }),
      },
    ],
    {
      maxTokens: 1_400,
      temperature: 0.1,
      timeoutMs: 22_000,
    }
  );

  return raw.trim();
}

export async function draftThreePhase(
  messages: ChatMessage[],
  _rigor: Rigor = "balanced"
): Promise<EngineResponse> {
  void _rigor;
  const query = messages[messages.length - 1]?.content ?? "";
  if (!query.trim()) {
    return {
      content: THREE_PHASE_FALLBACK,
      status: "fallback",
      needsFollowup: false,
    };
  }

  return buildDraftResponse();
}

export async function refineThreePhase(args: {
  messages: ChatMessage[];
  draft: string;
  rigor: Rigor;
  onProgress?: ProgressReporter;
}): Promise<EngineResponse> {
  const { messages, draft, rigor, onProgress } = args;
  const query = messages[messages.length - 1]?.content ?? "";
  if (!query.trim()) {
    return {
      content: draft.trim() || THREE_PHASE_FALLBACK,
      status: "fallback",
      needsFollowup: false,
    };
  }

  await notifyProgress(onProgress, "Director is gathering context");
  const initialPlan = await runDirectorPlan(messages, rigor);
  const retrieval = await gatherRetrieval({ messages, plan: initialPlan });

  await notifyProgress(onProgress, "Director is shaping the brief");
  const consolidated = await runDirectorConsolidation({
    messages,
    plan: initialPlan,
    retrieval,
    rigor,
  });
  const directorTrace = buildDirectorTrace({ consolidated, retrieval });

  await notifyProgress(onProgress, "Architect is reasoning through the problem");
  const architectAnalysis = await runArchitectAnalysis({
    messages,
    directorBrief: consolidated.architectBrief,
    rigor,
  });

  if (!architectAnalysis) {
    return {
      content: draft.trim() || THREE_PHASE_FALLBACK,
      status: "fallback",
      needsFollowup: false,
      trace: buildTrace({ director: directorTrace }),
    };
  }

  await notifyProgress(onProgress, "Architect is preparing the worker brief");
  const workerBrief = await runArchitectWorkerBrief({
    messages,
    directorBrief: consolidated.architectBrief,
    analysis: architectAnalysis.analysis,
  });

  if (!workerBrief) {
    return {
      content: architectAnalysis.degradedAnswer || draft.trim() || THREE_PHASE_FALLBACK,
      status: "fallback",
      needsFollowup: false,
      trace: buildTrace({
        director: directorTrace,
        architect: {
          analysis: architectAnalysis.analysis,
          degradedAnswer: architectAnalysis.degradedAnswer || undefined,
          workerBrief: {
            answerShape: "Direct answer",
            mustInclude: [],
            mustAvoid: [],
            tone: "Clear and direct",
            uncertaintyHandling: "Acknowledge uncertainty briefly when needed.",
            instructions: [],
          },
        },
        worker: architectAnalysis.degradedAnswer
          ? {
              finalAnswer: architectAnalysis.degradedAnswer,
              source: "architect",
              degraded: true,
              note: "Worker brief generation failed, so the response fell back to the Architect's degraded answer.",
            }
          : {
              finalAnswer: draft.trim() || THREE_PHASE_FALLBACK,
              source: "fallback",
              degraded: true,
              note: "Worker brief generation failed before a user-safe degraded answer was available.",
            },
      }),
    };
  }

  const architectTrace: ThreePhaseArchitectTrace = {
    analysis: architectAnalysis.analysis,
    workerBrief,
    ...(architectAnalysis.degradedAnswer
      ? { degradedAnswer: architectAnalysis.degradedAnswer }
      : {}),
  };

  await notifyProgress(onProgress, "Worker is composing the final answer");
  const workerAnswer = await runWorker({
    messages,
    analysis: architectAnalysis.analysis,
    workerBrief,
  });

  if (!workerAnswer) {
    if (architectAnalysis.degradedAnswer) {
      return {
        content: architectAnalysis.degradedAnswer,
        status: "fallback",
        needsFollowup: false,
        trace: buildTrace({
          director: directorTrace,
          architect: architectTrace,
          worker: {
            finalAnswer: architectAnalysis.degradedAnswer,
            source: "architect",
            degraded: true,
            note: "Worker generation failed, so the response fell back to the Architect's degraded answer.",
          },
        }),
      };
    }

    return {
      content: THREE_PHASE_FALLBACK,
      status: "fallback",
      needsFollowup: false,
      trace: buildTrace({
        director: directorTrace,
        architect: architectTrace,
        worker: {
          finalAnswer: THREE_PHASE_FALLBACK,
          source: "fallback",
          degraded: true,
          note: "Worker generation failed and no Architect degraded answer was available.",
        },
      }),
    };
  }

  return {
    content: workerAnswer,
    status: "final",
    needsFollowup: false,
    trace: buildTrace({
      director: directorTrace,
      architect: architectTrace,
      worker: {
        finalAnswer: workerAnswer,
        source: "worker",
        degraded: false,
      },
    }),
  };
}
