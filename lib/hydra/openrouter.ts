import OpenAI from "openai";

let _client: OpenAI | null = null;

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

export async function call(
  modelId: string,
  messages: { role: string; content: string }[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const client = getClient();
  try {
    const res = await client.chat.completions.create({
      model: modelId,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      stream: false,
    });
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
