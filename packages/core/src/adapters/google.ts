import type { CanonicalMessage, ToolCall, ToolResult } from "../canonical.js";

interface FnCall { name: string; args: Record<string, unknown>; }
interface FnResp { name: string; response: Record<string, unknown>; }
interface Part { text?: string; functionCall?: FnCall; functionResponse?: FnResp; }
interface GMsg { role: string; parts: Part[]; }

const ALNUM = /[^a-zA-Z0-9]/g;
function sanitizeId(id: string) { return id.replace(ALNUM, "").slice(0, 40) || "call" + Math.random().toString(36).slice(2, 10); }

export function ingest(messages: GMsg[]): CanonicalMessage[] {
  const out: CanonicalMessage[] = [];
  for (const msg of messages) {
    const role = msg.role === "model" ? "assistant" : "user";
    const texts: string[] = [], tcs: ToolCall[] = [], trs: ToolResult[] = [];
    for (const p of msg.parts || []) {
      if (p.text) texts.push(p.text);
      if (p.functionCall) tcs.push({ id: sanitizeId(p.functionCall.name + Math.random().toString(36).slice(2, 10)), name: p.functionCall.name, arguments: p.functionCall.args || {} });
      if (p.functionResponse) trs.push({ toolCallId: sanitizeId(p.functionResponse.name), content: JSON.stringify(p.functionResponse.response || {}) });
    }
    if (role === "assistant") {
      const m: CanonicalMessage = { role: "assistant", _meta: { originalProvider: "google", originalRole: msg.role } };
      if (texts.length) m.content = texts.join("\n");
      if (tcs.length) m.toolCalls = tcs;
      out.push(m);
    } else {
      for (const tr of trs) out.push({ role: "tool_result", toolResult: tr, _meta: { originalProvider: "google", originalRole: "user" } });
      if (texts.length) out.push({ role: "user", content: texts.join("\n"), _meta: { originalProvider: "google", originalRole: "user" } });
    }
  }
  return out;
}

export function emit(canonical: CanonicalMessage[]): GMsg[] {
  const out: GMsg[] = [];
  for (const m of canonical) {
    if (m.role === "system" || m.role === "user") { out.push({ role: "user", parts: m.content ? [{ text: m.content }] : [] }); continue; }
    if (m.role === "assistant") {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.toolCalls) for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      out.push({ role: "model", parts }); continue;
    }
    if (m.role === "tool_result" && m.toolResult) {
      let resp: Record<string, unknown>;
      try { resp = JSON.parse(m.toolResult.content); } catch { resp = { result: m.toolResult.content }; }
      out.push({ role: "user", parts: [{ functionResponse: { name: m.toolResult.toolCallId.replace(ALNUM, ""), response: resp } }] });
    }
  }
  const merged: GMsg[] = [];
  for (const m of out) { const last = merged[merged.length - 1]; if (last?.role === m.role) last.parts.push(...m.parts); else merged.push({ ...m, parts: [...m.parts] }); }
  if (merged.length > 0 && merged[0].role === "model") merged.unshift({ role: "user", parts: [{ text: "" }] });
  return merged;
}
