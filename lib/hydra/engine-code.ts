import { callModel } from "./openrouter";
import { MODELS } from "./models";
import type OpenAI from "openai";

const CODE_SYSTEM = `You are an expert software engineer. Write clean, production-quality code. Always include comments for complex logic. If the user asks a question about code, explain clearly and show examples.`;

const CODE_REVIEW_PROMPT = `You are a senior code reviewer. Review the following code response for:
1. Correctness — any bugs or logical errors?
2. Edge cases — what could go wrong?
3. Best practices — is this idiomatic and clean?
4. Security — any vulnerabilities?

If you find issues, provide the corrected version. If the code is good, say "LGTM" and optionally suggest minor improvements. Be concise.`;

export async function executeCode(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  complexity: number
): Promise<string> {
  const codeResponse = await callModel(
    MODELS.coder.id,
    [{ role: "system", content: CODE_SYSTEM }, ...messages],
    { maxTokens: 8192, temperature: 0.3 }
  );

  if (complexity > 0.6) {
    const review = await callModel(
      MODELS.critic.id,
      [
        { role: "system", content: CODE_REVIEW_PROMPT },
        {
          role: "user",
          content: `User asked: ${messages[messages.length - 1].content}\n\nCode response:\n${codeResponse}\n\nReview this.`,
        },
      ],
      { maxTokens: 4096, temperature: 0.2 }
    );

    if (!review.toLowerCase().includes("lgtm")) {
      return callModel(
        MODELS.coder.id,
        [
          { role: "system", content: CODE_SYSTEM },
          ...messages,
          { role: "assistant", content: codeResponse },
          {
            role: "user",
            content: `A code reviewer found these issues:\n${review}\n\nPlease provide the corrected version.`,
          },
        ],
        { maxTokens: 8192, temperature: 0.2 }
      );
    }
  }

  return codeResponse;
}
