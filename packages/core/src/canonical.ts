export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type CanonicalRole = "user" | "assistant" | "tool_call" | "tool_result" | "system";

export interface CanonicalMessage {
  role: CanonicalRole;
  content?: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  _meta?: { originalProvider?: string; originalRole?: string; [key: string]: unknown };
}

export interface CanonicalSession {
  messages: CanonicalMessage[];
  metadata?: Record<string, unknown>;
}

export type Provider = "anthropic" | "openai" | "grok" | "google" | "mistral";

export type RepairStrategy = "inject" | "summarize" | "drop" | "auto";

export interface TranslateOptions {
  repairStrategy?: RepairStrategy;
  compressOlderThan?: number;
  deduplicateToolNames?: boolean;
}
