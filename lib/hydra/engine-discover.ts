import { call } from "./openrouter";
import { MODELS } from "./models";
import { reviewAndRevise, type ReviewSpec } from "./verify";
import type { ChatMessage, EngineResponse, Rigor } from "./types";

const DISCOVER_DRAFT_FALLBACK =
  "Hydra could not finish the creative exploration within the serverless time budget. Please retry if you want another pass.";

const DISCOVER_REVISION_INSTRUCTIONS = `Revise the answer into a clear final response.
- Lead with the strongest unconventional idea first.
- Keep only the ideas that are actionable and defensible.
- Label speculative elements briefly when needed.
- Stay concise.`;

function buildDraftPrompt(query: string, rigorous: boolean) {
  return rigorous
    ? `Give a concise first-principles answer with 2 or 3 unconventional but practical approaches. Mention the biggest implementation risk once.\n\n${query}`
    : `Give a concise but creative answer with 2 or 3 unconventional approaches that could realistically work.\n\n${query}`;
}

function buildReviewSpecs(rigor: Rigor): ReviewSpec[] {
  const specs: ReviewSpec[] = [
    {
      label: "Constraint Review",
      modelId: MODELS.critic.id,
      prompt: `Review the draft answer.
- Find ideas that violate constraints, overreach, or sound hand-wavy.
- Return only the strongest corrective notes.`,
    },
    {
      label: "Creative Review",
      modelId: MODELS.wild.id,
      prompt: `Review the draft answer.
- Point out where the answer became generic or lost its most original useful idea.
- Return concise notes only.`,
    },
  ];

  if (rigor === "rigorous") {
    specs.push({
      label: "Practicality Review",
      modelId: MODELS.broad.id,
      prompt: `Audit the draft answer for feasibility and missing tradeoffs.
- Return concise notes on what to tighten, clarify, or cut.`,
    });
  }

  return specs;
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

  const revised = await reviewAndRevise({
    query,
    draft: seed,
    reviewSpecs: buildReviewSpecs(rigor),
    revisionInstructions: DISCOVER_REVISION_INSTRUCTIONS,
  });

  return {
    content: revised.content,
    status: revised.revised ? "final" : "fallback",
    needsFollowup: false,
  };
}
