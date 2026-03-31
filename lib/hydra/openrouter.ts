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

export async function callModel(
  modelId: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  const client = getClient();
  try {
    const response = await client.chat.completions.create({
      model: modelId,
      messages,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      stream: false,
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (error) {
    console.error(`Model ${modelId} failed:`, error);
    // Fallback to the free auto-router
    const fallback = await client.chat.completions.create({
      model: "openrouter/auto",
      messages,
      max_tokens: options?.maxTokens ?? 4096,
      stream: false,
    });
    return fallback.choices[0]?.message?.content ?? "";
  }
}
