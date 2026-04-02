import { NextRequest, NextResponse } from "next/server";
import { normalizeRigor } from "@/lib/hydra/controller";
import { refineThink } from "@/lib/hydra/engine-think";
import { refineDiscover } from "@/lib/hydra/engine-discover";
import {
  refineThreePhase,
  THREE_PHASE_MODEL_ID,
} from "@/lib/hydra/engine-three-phase";
import {
  refineResearch,
  RESEARCH_MODEL_ID,
} from "@/lib/hydra/engine-research";
import {
  isChatMessage,
  isChatMode,
  isTopology,
  type ProgressUpdate,
} from "@/lib/hydra/types";

export const maxDuration = 300;
export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeEvent(event: string, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages)
      ? body.messages.filter(isChatMessage)
      : [];
    const draft = typeof body.draft === "string" ? body.draft : "";
    const mode = isChatMode(body.mode) ? body.mode : "hydra";
    const topology = isTopology(body.topology) ? body.topology : null;

    if (messages.length === 0 || !draft.trim()) {
      return NextResponse.json(
        { error: "Messages and a draft answer are required." },
        { status: 400 }
      );
    }

    if (mode === "hydra" && topology !== "think" && topology !== "discover") {
      return NextResponse.json(
        { error: "Follow-up refinement only supports think and discover responses." },
        { status: 400 }
      );
    }

    const rigor = normalizeRigor(body.rigor);
    const start = Date.now();
    const followupLabel =
      mode === "three_phase" ? "three_phase" : mode === "research" ? "research" : topology;

    console.log(`[Hydra] followup ${followupLabel} | rigor: ${rigor}`);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let lastLabel: string | null = null;

        const sendStage = (label: string) => {
          if (!label || label === lastLabel) return;
          lastLabel = label;
          controller.enqueue(encodeEvent("stage", { label }));
        };

        const onProgress = async (update: ProgressUpdate) => {
          sendStage(update.label);
        };

        try {
          sendStage(
            mode === "three_phase"
              ? "Director is gathering context"
              : mode === "research"
                ? "Frame is defining the rules"
              : "Preparing a deeper reasoning pass"
          );

          const result =
            mode === "three_phase"
              ? await refineThreePhase({ messages, draft, rigor, onProgress })
              : mode === "research"
                ? await refineResearch({ messages, draft, rigor, onProgress })
              : topology === "discover"
                ? await refineDiscover({ messages, draft, rigor, onProgress })
                : await refineThink({ messages, draft, rigor, onProgress });

          controller.enqueue(
            encodeEvent("final", {
              content: result.content,
              metadata: {
                mode,
                ...(topology ? { topology } : {}),
                ...(mode === "three_phase"
                  ? {
                      pipeline: "Director > Architect > Worker",
                      modelId: THREE_PHASE_MODEL_ID,
                    }
                  : mode === "research"
                    ? {
                        pipeline:
                          "Frame > Candidate Swarm > Elimination Swarm > Consensus > Synthesize > Verify",
                        modelId: RESEARCH_MODEL_ID,
                      }
                  : {}),
                rigor,
                latencyMs: Date.now() - start,
                status: result.status,
                needsFollowup: false,
                trace: result.trace,
              },
            })
          );
        } catch (error) {
          console.error("[Hydra] Follow-up error:", error);
          controller.enqueue(
            encodeEvent("error", {
              error: "Hydra follow-up encountered an error.",
            })
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Hydra] Follow-up error:", error);
    return NextResponse.json({ error: "Hydra follow-up encountered an error." }, { status: 500 });
  }
}
