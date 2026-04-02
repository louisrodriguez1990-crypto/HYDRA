import OpenAI from "openai";

let _client: OpenAI | null = null;

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  reasoning?: {
    effort?: ReasoningEffort;
    exclude?: boolean;
    enabled?: boolean;
  };
}

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY ?? "missing",
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "Hydra",
      },
    });
  }
  return _client;
}

function normalizeReasoningOptions(
  modelId: string,
  reasoning: CallOptions["reasoning"] | undefined
) {
  if (!reasoning) return undefined;

  if (modelId.startsWith("stepfun/")) {
    const effort =
      !reasoning.effort || reasoning.effort === "none"
        ? "minimal"
        : reasoning.effort;

    return { effort };
  }

  return reasoning;
}

export async function call(
  modelId: string,
  messages: { role: string; content: string }[],
  opts: CallOptions = {}
): Promise<string> {
  const client = getClient();
  try {
    const reasoning = normalizeReasoningOptions(modelId, opts.reasoning);
    const timeoutSignal =
      !opts.signal &&
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function" &&
      typeof opts.timeoutMs === "number"
        ? AbortSignal.timeout(opts.timeoutMs + 500)
        : undefined;
    const payload = {
      model: modelId,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      stream: false as const,
      ...(reasoning ? { reasoning } : {}),
    } as OpenAI.Chat.ChatCompletionCreateParams & {
      reasoning?: CallOptions["reasoning"];
    };

    const res = (await client.chat.completions.create(payload, {
      maxRetries: opts.maxRetries ?? 0,
      timeout: opts.timeoutMs,
      signal: opts.signal ?? timeoutSignal,
    })) as OpenAI.Chat.ChatCompletion;
    return res.choices[0]?.message?.content ?? "";
  } catch (err) {
    console.error(`[Hydra] ${modelId} failed:`, err);
    return "";
  }
}

export function parseJSON<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
  } catch {
    return fallback;
  }
}
