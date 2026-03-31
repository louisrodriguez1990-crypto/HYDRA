import { NextRequest, NextResponse } from "next/server";
import { classify } from "@/lib/hydra/controller";
import { fast } from "@/lib/hydra/engine-fast";
import { think } from "@/lib/hydra/engine-think";
import { discover } from "@/lib/hydra/engine-discover";

export const maxDuration = 120;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const last = messages[messages.length - 1].content as string;
    const plan = await classify(last);
    const start = Date.now();

    console.log(`[Hydra] ${plan.topology} | complexity: ${plan.complexity}`);

    let content: string;
    switch (plan.topology) {
      case "fast":     content = await fast(messages); break;
      case "think":    content = await think(messages); break;
      case "discover": content = await discover(messages); break;
      default:         content = await think(messages);
    }

    return NextResponse.json({
      content,
      metadata: {
        topology: plan.topology,
        complexity: plan.complexity,
        latencyMs: Date.now() - start,
      },
    });
  } catch (error) {
    console.error("[Hydra] Error:", error);
    return NextResponse.json({ error: "Hydra encountered an error." }, { status: 500 });
  }
}
