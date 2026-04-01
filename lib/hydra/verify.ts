import { MODELS } from "./models";
import { call, parseJSON } from "./openrouter";
import type { Rigor, Topology, VerificationResult } from "./types";

interface ReviewSpec {
  label: string;
  modelId: string;
  prompt: string;
}

interface RevisionPayload {
  changed: boolean;
  findings: number;
  answer: string;
}

const ADVERSARIAL_REVIEW = `You are a rigorous adversarial reviewer.
Inspect the draft answer for:
- unsupported leaps
- hidden assumptions
- missed constraints
- weak tradeoff analysis
- contradictions or ambiguity
- overclaiming certainty

Be specific. Prioritize the few highest-value corrections.
Lead with the most important issue.`;

const COVERAGE_REVIEW = `You are a completeness auditor.
Check whether the draft:
- answers the user's question directly
- preserves the strongest ideas instead of flattening them
- distinguishes what is ready now versus speculative when needed
- gives concrete next steps instead of vague advice
- is systematic enough to be reproduced

Return a concise review focused on what is still missing.`;

const REVISION_PROMPT = `You are the final verification-and-revision editor.
You will receive:
- the user's question
- a draft answer
- review notes

Your job is to preserve genuinely strong ideas while increasing rigor.

Rules:
- Answer the question directly.
- Keep one clear voice.
- Fix unsupported leaps, contradictions, and missing constraints.
- Preserve useful originality. Do not flatten everything into generic advice.
- If some ideas are speculative, label them honestly.
- Keep the answer concise but concrete.

Output ONLY JSON, no fences:
{"changed":true|false,"findings":2,"answer":"final answer"}`;

function getReviewSpecs(rigor: Rigor): ReviewSpec[] {
  const specs: ReviewSpec[] = [
    {
      label: "Adversarial Review",
      modelId: MODELS.critic.id,
      prompt: ADVERSARIAL_REVIEW,
    },
  ];

  if (rigor === "rigorous") {
    specs.push({
      label: "Coverage Audit",
      modelId: MODELS.analyst.id,
      prompt: COVERAGE_REVIEW,
    });
  }

  return specs;
}

export async function verifyAnswer(args: {
  query: string;
  draft: string;
  topology: Topology;
  rigor: Rigor;
}): Promise<VerificationResult> {
  const { query, draft, topology, rigor } = args;

  if (!draft.trim()) {
    return { content: draft, revised: false, findings: 0 };
  }

  const reviewSpecs = getReviewSpecs(rigor);
  const settled = await Promise.allSettled(
    reviewSpecs.map((spec) =>
      call(
        spec.modelId,
        [
          { role: "system", content: spec.prompt },
          {
            role: "user",
            content: `Topology: ${topology}\n\nQuestion:\n${query}\n\nDraft answer:\n${draft}`,
          },
        ],
        { maxTokens: 1400, temperature: 0.2 }
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

  const raw = await call(
    MODELS.reasoner.id,
    [
      { role: "system", content: REVISION_PROMPT },
      {
        role: "user",
        content: `Question:\n${query}\n\nDraft answer:\n${draft}\n\nReview notes:\n${notes.join("\n\n")}`,
      },
    ],
    { maxTokens: 3000, temperature: 0.2 }
  );

  const parsed = parseJSON<RevisionPayload>(raw, {
    changed: false,
    findings: notes.length,
    answer: draft,
  });

  const answer = parsed.answer?.trim() ? parsed.answer.trim() : draft;

  return {
    content: answer,
    revised: Boolean(parsed.changed),
    findings: Math.max(parsed.findings ?? 0, notes.length),
  };
}
