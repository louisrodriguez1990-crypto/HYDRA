import { call } from "./openrouter";
import { MODELS } from "./models";
import { reviewAndRevise, type ReviewSpec } from "./verify";
import type { ChatMessage, EngineResponse, Rigor } from "./types";

const THINK_DRAFT_FALLBACK =
  "Hydra could not finish the deeper analysis within the serverless time budget. Please retry if you want another pass.";

const THINK_REVISION_INSTRUCTIONS = `Revise the answer so it is direct, grounded, and concise.
- Lead with the answer.
- Preserve the strongest tradeoffs and constraints.
- Keep the answer readable without sounding robotic.`;

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
