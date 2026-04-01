import { NextRequest, NextResponse } from "next/server";
import { classify, normalizeRigor } from "@/lib/hydra/controller";
import { fast } from "@/lib/hydra/engine-fast";
import { think } from "@/lib/hydra/engine-think";
import { discover } from "@/lib/hydra/engine-discover";
import type { ChatMessage } from "@/lib/hydra/types";

export const maxDuration = 60;
export const runtime = "nodejs";

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    "content" in value &&
    typeof value.role === "string" &&
    typeof value.content === "string"
  );
}

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

    console.log(
      `[Hydra] ${plan.topology} | rigor: ${rigor} | complexity: ${plan.complexity}`
    );

    let content: string;
    switch (plan.topology) {
      case "fast":
        content = await fast(messages, rigor);
        break;
      case "think":
        content = await think(messages, rigor);
        break;
      case "discover":
        content = await discover(messages, rigor);
        break;
      default:
        content = await think(messages, rigor);
    }

    return NextResponse.json({
      content,
      metadata: {
        topology: plan.topology,
        complexity: plan.complexity,
        rigor,
        latencyMs: Date.now() - start,
      },
    });
  } catch (error) {
    console.error("[Hydra] Error:", error);
    return NextResponse.json({ error: "Hydra encountered an error." }, { status: 500 });
  }
}
