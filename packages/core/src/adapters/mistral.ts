import type { CanonicalMessage, ToolCall } from "../canonical.js";
import { ingest as ingestOAI, emit as emitOAI } from "./openai.js";

/**
 * Mistral uses OpenAI-compatible format but requires strict alphanumeric
 * tool call IDs of exactly 9 characters. OpenClaw's transcript hygiene docs
 * call this out as "strict9".
 *
 * This adapter: on ingest, normalises IDs to alphanumeric (preserving original
 * if valid); on emit, generates or truncates IDs to exactly 9 alphanumeric chars.
 */

const ALNUM_RE = /[^a-zA-Z0-9]/g;

function toStrict9(id: string): string {
  const clean = id.replace(ALNUM_RE, "");
  if (clean.length === 9) return clean;
  if (clean.length > 9) return clean.slice(0, 9);
  const pad = clean + Math.random().toString(36).slice(2);
  return pad.replace(ALNUM_RE, "").slice(0, 9);
}

function isStrict9(id: string): boolean {
  return /^[a-zA-Z0-9]{9}$/.test(id);
}

interface MistralMsg {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export function ingest(messages: MistralMsg[]): CanonicalMessage[] {
  const canonical = ingestOAI(messages);
  for (const m of canonical) {
    if (m._meta) m._meta.originalProvider = "mistral";
  }
  return canonical;
}

export function emit(canonical: CanonicalMessage[]): MistralMsg[] {
  const idMap = new Map<string, string>();

  function mapId(original: string): string {
    if (idMap.has(original)) return idMap.get(original)!;
    const strict = toStrict9(original);
    idMap.set(original, strict);
    return strict;
  }

  const sanitized = canonical.map((m) => {
    if (m.toolCalls) {
      return { ...m, toolCalls: m.toolCalls.map(tc => ({ ...tc, id: mapId(tc.id) })) };
    }
    if (m.role === "tool_result" && m.toolResult) {
      return { ...m, toolResult: { ...m.toolResult, toolCallId: mapId(m.toolResult.toolCallId) } };
    }
    return m;
  });

  return emitOAI(sanitized) as MistralMsg[];
}
