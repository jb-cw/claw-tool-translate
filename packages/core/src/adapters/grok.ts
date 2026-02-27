import type { CanonicalMessage } from "../canonical.js";
import { ingest as ingestOAI, emit as emitOAI } from "./openai.js";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&apos;": "'", "&#x2F;": "/", "&#47;": "/" };
const ENT_RE = /&(?:amp|lt|gt|quot|apos|#39|#x27|#x2F|#47);/g;
function decode(s: string) { return s.replace(ENT_RE, m => ENTITIES[m] || m); }
function fixArgs(a: Record<string, unknown>): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) f[k] = typeof v === "string" ? decode(v) : v;
  return f;
}
function parseGrokArgs(raw: string): Record<string, unknown> {
  try { return JSON.parse(decode(raw)); } catch { try { return JSON.parse(raw); } catch { return { _raw: raw }; } }
}

interface GrokMsg { role: string; content?: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>; tool_call_id?: string; name?: string; }

export function ingest(messages: GrokMsg[]): CanonicalMessage[] {
  const fixed = messages.map(m => {
    if (m.role === "assistant" && m.tool_calls) return { ...m, tool_calls: m.tool_calls.map(tc => ({ ...tc, function: { ...tc.function, arguments: JSON.stringify(parseGrokArgs(tc.function.arguments)) } })) };
    return m;
  });
  const canonical = ingestOAI(fixed);
  for (const m of canonical) {
    if (m.toolCalls) m.toolCalls = m.toolCalls.map(tc => ({ ...tc, arguments: fixArgs(tc.arguments) }));
    if (m._meta) m._meta.originalProvider = "grok";
  }
  return canonical;
}

export function emit(canonical: CanonicalMessage[]): GrokMsg[] { return emitOAI(canonical) as GrokMsg[]; }
