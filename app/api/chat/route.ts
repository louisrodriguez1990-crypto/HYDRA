import { NextRequest, NextResponse } from "next/server";
import { classifyQuery } from "@/lib/hydra/controller";
import { executeFast } from "@/lib/hydra/engine-fast";
import { executeReasoning } from "@/lib/hydra/engine-reasoning";
import { executeCode } from "@/lib/hydra/engine-code";
import { executeCreative } from "@/lib/hydra/engine-creative";
import { executeFull } from "@/lib/hydra/engine-full";
import type OpenAI from "openai";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const lastMessage = messages[messages.length - 1].content as string;

    const plan = await classifyQuery(lastMessage);
    console.log(
      `[Hydra] Topology: ${plan.topology} | Complexity: ${plan.complexity} | ${plan.reasoning}`
    );

    const typedMessages = messages as OpenAI.Chat.ChatCompletionMessageParam[];
    let response: string;

    switch (plan.topology) {
      case "fast":
        response = await executeFast(typedMessages);
        break;
      case "reasoning":
        response = await executeReasoning(typedMessages);
        break;
      case "code":
        response = await executeCode(typedMessages, plan.complexity);
        break;
      case "creative":
        response = await executeCreative(typedMessages);
        break;
      case "full":
        response = await executeFull(typedMessages);
        break;
      default:
        response = await executeFast(typedMessages);
    }

    return NextResponse.json({
      content: response,
      metadata: {
        topology: plan.topology,
        complexity: plan.complexity,
      },
    });
  } catch (error) {
    console.error("[Hydra] Error:", error);
    return NextResponse.json(
      { error: "Hydra encountered an error. Please try again." },
      { status: 500 }
    );
  }
}
