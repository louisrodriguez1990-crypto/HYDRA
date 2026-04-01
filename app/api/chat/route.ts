import { NextRequest, NextResponse } from "next/server";
import { classify, normalizeRigor } from "@/lib/hydra/controller";
import { fast } from "@/lib/hydra/engine-fast";
import { draftThink } from "@/lib/hydra/engine-think";
import { draftDiscover } from "@/lib/hydra/engine-discover";
import {
  draftThreePhase,
  THREE_PHASE_MODEL_ID,
} from "@/lib/hydra/engine-three-phase";
import {
  draftResearch,
  RESEARCH_MODEL_ID,
} from "@/lib/hydra/engine-research";
import { isChatMessage, isChatMode } from "@/lib/hydra/types";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages)
      ? body.messages.filter(isChatMessage)
      : [];

    const last = messages[messages.length - 1]?.content ?? "";
    if (!last) {
      return NextResponse.json({ error: "A user message is required." }, { status: 400 });
    }

    const mode = isChatMode(body.mode) ? body.mode : "hydra";
    const rigor = normalizeRigor(body.rigor);
    const start = Date.now();

    if (mode === "three_phase") {
      console.log(`[Hydra] initial three_phase | rigor: ${rigor}`);
      const result = await draftThreePhase(messages, rigor);

      return NextResponse.json({
        content: result.content,
        metadata: {
          mode,
          pipeline: "Director > Architect > Worker",
          modelId: THREE_PHASE_MODEL_ID,
          rigor,
          latencyMs: Date.now() - start,
          status: result.status,
          needsFollowup: result.needsFollowup,
          trace: result.trace,
        },
      });
    }

    if (mode === "research") {
      console.log(`[Hydra] initial research | rigor: ${rigor}`);
      const result = await draftResearch(messages, rigor);

      return NextResponse.json({
        content: result.content,
        metadata: {
          mode,
          pipeline: "Frame > Candidate Swarm > Elimination Swarm > Consensus > Synthesize > Verify",
          modelId: RESEARCH_MODEL_ID,
          rigor,
          latencyMs: Date.now() - start,
          status: result.status,
          needsFollowup: result.needsFollowup,
          trace: result.trace,
        },
      });
    }

    const plan = await classify(last, rigor);

    console.log(`[Hydra] initial ${plan.topology} | rigor: ${rigor}`);

    const result =
      plan.topology === "fast"
        ? await fast(messages, rigor)
        : plan.topology === "discover"
          ? await draftDiscover(messages, rigor)
          : await draftThink(messages, rigor);

    return NextResponse.json({
      content: result.content,
      metadata: {
        mode,
        topology: plan.topology,
        rigor,
        latencyMs: Date.now() - start,
        status: result.status,
        needsFollowup: result.needsFollowup,
        trace: result.trace,
      },
    });
  } catch (error) {
    console.error("[Hydra] Error:", error);
    return NextResponse.json({ error: "Hydra encountered an error." }, { status: 500 });
  }
}
