import type { CanonicalMessage, CanonicalSession, Provider, TranslateOptions } from "./canonical.js";
import * as anthropicAdapter from "./adapters/anthropic.js";
import * as openaiAdapter from "./adapters/openai.js";
import * as grokAdapter from "./adapters/grok.js";
import * as googleAdapter from "./adapters/google.js";
import * as mistralAdapter from "./adapters/mistral.js";
import { sanitize, findOrphans } from "./sanitizer.js";

export type { CanonicalMessage, CanonicalSession, ToolCall, ToolResult, Provider, RepairStrategy, TranslateOptions } from "./canonical.js";
export { sanitize, findOrphans } from "./sanitizer.js";

export const adapters = { anthropic: anthropicAdapter, openai: openaiAdapter, grok: grokAdapter, google: googleAdapter, mistral: mistralAdapter } as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdapter(provider: Provider): { ingest: (msgs: any[]) => CanonicalMessage[]; emit: (canonical: CanonicalMessage[]) => any[] } {
  const a = adapters[provider]; if (!a) throw new Error(`Unknown provider: ${provider}`); return a;
}

export function ingest(provider: Provider, messages: unknown[]): CanonicalMessage[] { return getAdapter(provider).ingest(messages as any[]); }
export function emit(provider: Provider, canonical: CanonicalMessage[]): unknown[] { return getAdapter(provider).emit(canonical); }

export function translate(source: Provider, target: Provider, messages: unknown[], options?: TranslateOptions): unknown[] {
  return emit(target, sanitize(ingest(source, messages), options));
}

export class SessionTranslator {
  private messages: CanonicalMessage[] = [];
  private options: TranslateOptions;
  constructor(options: TranslateOptions = {}) { this.options = options; }
  addMessage(provider: Provider, messages: unknown[]): void { this.messages.push(...getAdapter(provider).ingest(messages as any[])); }
  addCanonical(messages: CanonicalMessage[]): void { this.messages.push(...messages); }
  emitFor(provider: Provider): unknown[] { return getAdapter(provider).emit(sanitize(this.messages, this.options)); }
  getCanonical(): CanonicalMessage[] { return sanitize(this.messages, this.options); }
  getOrphans() { return findOrphans(this.messages); }
  clear(): void { this.messages = []; }
  get length(): number { return this.messages.length; }
}
