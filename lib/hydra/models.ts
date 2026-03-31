export type ModelRole = "fast" | "reasoner" | "coder" | "generalist" | "critic" | "creative" | "fallback";

export interface ModelConfig {
  id: string;
  role: ModelRole;
  maxTokens: number;
  contextWindow: number;
  supportsStreaming: boolean;
}

export const MODELS: Record<string, ModelConfig> = {
  fast: {
    id: "qwen/qwen3-next-80b-a3b-instruct",
    role: "fast",
    maxTokens: 4096,
    contextWindow: 128000,
    supportsStreaming: true,
  },
  reasonerA: {
    id: "deepseek/deepseek-r1-0528",
    role: "reasoner",
    maxTokens: 8192,
    contextWindow: 164000,
    supportsStreaming: true,
  },
  reasonerB: {
    id: "qwen/qwen3-235b-a22b",
    role: "reasoner",
    maxTokens: 8192,
    contextWindow: 128000,
    supportsStreaming: true,
  },
  coder: {
    id: "qwen/qwen3-coder",
    role: "coder",
    maxTokens: 8192,
    contextWindow: 262000,
    supportsStreaming: true,
  },
  generalist: {
    id: "nvidia/nemotron-3-super-120b-a12b",
    role: "generalist",
    maxTokens: 8192,
    contextWindow: 262000,
    supportsStreaming: true,
  },
  critic: {
    id: "meta-llama/llama-3.3-70b-instruct",
    role: "critic",
    maxTokens: 4096,
    contextWindow: 128000,
    supportsStreaming: true,
  },
  creative: {
    id: "arcee-ai/trinity-large-preview",
    role: "creative",
    maxTokens: 8192,
    contextWindow: 131000,
    supportsStreaming: true,
  },
  fallback: {
    id: "openai/gpt-oss-120b",
    role: "fallback",
    maxTokens: 4096,
    contextWindow: 128000,
    supportsStreaming: true,
  },
};
