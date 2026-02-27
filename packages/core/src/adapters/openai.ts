import type { CanonicalMessage, ToolCall } from "../canonical.js";

interface OAIToolCall { id: string; type: "function"; function: { name: string; arguments: string }; }
interface OAIMsg { role: string; content?: string | null; function_call?: { name: string; arguments: string }; tool_calls?: OAIToolCall[]; tool_call_id?: string; name?: string; }

function safeArgs(s: string): Record<string, unknown> { try { return JSON.parse(s); } catch { return { _raw: s }; } }

export function ingest(messages: OAIMsg[]): CanonicalMessage[] {
  const out: CanonicalMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") { out.push({ role: "system", content: m.content || "", _meta: { originalProvider: "openai", originalRole: "system" } }); continue; }
    if (m.role === "user") { out.push({ role: "user", content: m.content || "", _meta: { originalProvider: "openai", originalRole: "user" } }); continue; }
    if (m.role === "assistant") {
      const c: CanonicalMessage = { role: "assistant", _meta: { originalProvider: "openai", originalRole: "assistant" } };
      if (m.content) c.content = m.content;
      const tcs: ToolCall[] = [];
      if (m.tool_calls) for (const tc of m.tool_calls) tcs.push({ id: tc.id, name: tc.function.name, arguments: safeArgs(tc.function.arguments) });
      if (m.function_call) tcs.push({ id: `fc_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name: m.function_call.name, arguments: safeArgs(m.function_call.arguments) });
      if (tcs.length) c.toolCalls = tcs;
      out.push(c); continue;
    }
    if (m.role === "tool" && m.tool_call_id) { out.push({ role: "tool_result", toolResult: { toolCallId: m.tool_call_id, content: m.content || "" }, _meta: { originalProvider: "openai", originalRole: "tool" } }); continue; }
    if (m.role === "function") { out.push({ role: "tool_result", toolResult: { toolCallId: m.name || "unknown", content: m.content || "" }, _meta: { originalProvider: "openai", originalRole: "function" } }); }
  }
  return out;
}

export function emit(canonical: CanonicalMessage[]): OAIMsg[] {
  const out: OAIMsg[] = [];
  for (const m of canonical) {
    if (m.role === "system") { out.push({ role: "system", content: m.content || "" }); continue; }
    if (m.role === "user") { out.push({ role: "user", content: m.content || "" }); continue; }
    if (m.role === "assistant") {
      const o: OAIMsg = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) o.tool_calls = m.toolCalls.map(tc => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } }));
      out.push(o); continue;
    }
    if (m.role === "tool_result" && m.toolResult) { out.push({ role: "tool", tool_call_id: m.toolResult.toolCallId, content: m.toolResult.content }); }
  }
  return out;
}
