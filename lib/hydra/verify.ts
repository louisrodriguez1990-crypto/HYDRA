import { MODELS } from "./models";
import { call } from "./openrouter";
import type { ProgressReporter, VerificationResult } from "./types";

export interface ReviewSpec {
  label: string;
  modelId: string;
  prompt: string;
}

const REVIEW_MAX_TOKENS = 900;
const REVISION_MAX_TOKENS = 1800;
const REVIEW_TIMEOUT_MS = 20000;
const REVISION_TIMEOUT_MS = 25000;

const REVISION_PROMPT = `You are revising a draft answer using reviewer notes.

Rules:
- Keep one clear voice.
- Preserve useful specifics from the draft.
- Apply only the strongest corrections from the notes.
- If some uncertainty remains, state it briefly and honestly.
- Keep the answer concise and directly useful.
- Do not mention reviewers or the revision process.`;

export async function reviewAndRevise(args: {
  query: string;
  draft: string;
  reviewSpecs: ReviewSpec[];
  revisionInstructions: string;
  onProgress?: ProgressReporter;
}): Promise<VerificationResult> {
  const { query, draft, reviewSpecs, revisionInstructions, onProgress } = args;

  if (!draft.trim() || reviewSpecs.length === 0) {
    return { content: draft, revised: false, findings: 0 };
  }

  if (onProgress) {
    await onProgress({
      label: `Running ${reviewSpecs.map((spec) => spec.label.toLowerCase()).join(" and ")}`,
    });
  }

  const settled = await Promise.allSettled(
    reviewSpecs.map((spec) =>
      call(
        spec.modelId,
        [
          { role: "system", content: spec.prompt },
          {
            role: "user",
            content: `Question:\n${query}\n\nDraft answer:\n${draft}`,
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

  const notes = settled.flatMap((result, index) => {
    if (result.status !== "fulfilled") {
      return [];
    }

    const content = result.value.trim();
    if (!content) {
      return [];
    }

    return [`--- ${reviewSpecs[index].label} ---\n${content}`];
  });

  if (notes.length === 0) {
    return { content: draft, revised: false, findings: 0 };
  }

  if (onProgress) {
    await onProgress({ label: "Revising the answer" });
  }

  const revised = await call(
    MODELS.analyst.id,
    [
      {
        role: "system",
        content: `${REVISION_PROMPT}\n\n${revisionInstructions}`,
      },
      {
        role: "user",
        content: `Question:\n${query}\n\nDraft answer:\n${draft}\n\nReview notes:\n${notes.join("\n\n")}`,
      },
    ],
    {
      maxTokens: REVISION_MAX_TOKENS,
      temperature: 0.25,
      timeoutMs: REVISION_TIMEOUT_MS,
    }
  );

  const content = revised.trim() || draft;

  return {
    content,
    revised: Boolean(revised.trim()),
    findings: notes.length,
  };
}
