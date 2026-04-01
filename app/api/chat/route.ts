import { NextRequest, NextResponse } from "next/server";
import { classify, normalizeRigor } from "@/lib/hydra/controller";
import { fast } from "@/lib/hydra/engine-fast";
import { draftThink } from "@/lib/hydra/engine-think";
import { draftDiscover } from "@/lib/hydra/engine-discover";
import { isChatMessage } from "@/lib/hydra/types";

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

    const rigor = normalizeRigor(body.rigor);
    const plan = await classify(last, rigor);
    const start = Date.now();

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
        topology: plan.topology,
        rigor,
        latencyMs: Date.now() - start,
        status: result.status,
        needsFollowup: result.needsFollowup,
      },
    });
  } catch (error) {
    console.error("[Hydra] Error:", error);
    return NextResponse.json({ error: "Hydra encountered an error." }, { status: 500 });
  }
}
