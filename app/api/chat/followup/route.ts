import { NextRequest, NextResponse } from "next/server";
import { normalizeRigor } from "@/lib/hydra/controller";
import { refineThink } from "@/lib/hydra/engine-think";
import { refineDiscover } from "@/lib/hydra/engine-discover";
import { isChatMessage, isTopology } from "@/lib/hydra/types";

export const maxDuration = 55;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages)
      ? body.messages.filter(isChatMessage)
      : [];
    const draft = typeof body.draft === "string" ? body.draft : "";
    const topology = isTopology(body.topology) ? body.topology : null;

    if (messages.length === 0 || !draft.trim()) {
      return NextResponse.json(
        { error: "Messages and a draft answer are required." },
        { status: 400 }
      );
    }

    if (topology !== "think" && topology !== "discover") {
      return NextResponse.json(
        { error: "Follow-up refinement only supports think and discover responses." },
        { status: 400 }
      );
    }

    const rigor = normalizeRigor(body.rigor);
    const start = Date.now();

    console.log(`[Hydra] followup ${topology} | rigor: ${rigor}`);

    const result =
      topology === "discover"
        ? await refineDiscover({ messages, draft, rigor })
        : await refineThink({ messages, draft, rigor });

    return NextResponse.json({
      content: result.content,
      metadata: {
        topology,
        rigor,
        latencyMs: Date.now() - start,
        status: result.status,
        needsFollowup: false,
      },
    });
  } catch (error) {
    console.error("[Hydra] Follow-up error:", error);
    return NextResponse.json({ error: "Hydra follow-up encountered an error." }, { status: 500 });
  }
}
