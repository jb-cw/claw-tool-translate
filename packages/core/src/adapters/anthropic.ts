import type { CanonicalMessage, ToolCall, ToolResult } from "../canonical.js";

interface ContentBlock { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: string | ContentBlock[]; is_error?: boolean; }
interface Msg { role: string; content: string | ContentBlock[]; }

export function ingest(messages: Msg[]): CanonicalMessage[] {
  const out: CanonicalMessage[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      out.push({ role: msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user", content: msg.content, _meta: { originalProvider: "anthropic", originalRole: msg.role } });
      continue;
    }
    const blocks = msg.content || [];
    const texts: string[] = [], tcs: ToolCall[] = [], trs: ToolResult[] = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text) texts.push(b.text);
      else if (b.type === "tool_use" && b.id && b.name) tcs.push({ id: b.id, name: b.name, arguments: b.input || {} });
      else if (b.type === "tool_result" && b.tool_use_id) {
        const c = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.filter(x => x.type === "text").map(x => x.text || "").join("\n") : "";
        trs.push({ toolCallId: b.tool_use_id, content: c, isError: b.is_error || false });
      }
    }
    if (msg.role === "assistant") {
      const m: CanonicalMessage = { role: "assistant", _meta: { originalProvider: "anthropic", originalRole: "assistant" } };
      if (texts.length) m.content = texts.join("\n");
      if (tcs.length) m.toolCalls = tcs;
      out.push(m);
    } else if (msg.role === "user") {
      for (const tr of trs) out.push({ role: "tool_result", toolResult: tr, _meta: { originalProvider: "anthropic", originalRole: "user" } });
      if (texts.length) out.push({ role: "user", content: texts.join("\n"), _meta: { originalProvider: "anthropic", originalRole: "user" } });
    }
  }
  return out;
}

export function emit(canonical: CanonicalMessage[]): Msg[] {
  const out: Msg[] = [];
  let pending: ToolResult[] = [];
  function flush() {
    if (!pending.length) return;
    const blocks: ContentBlock[] = pending.map(tr => ({ type: "tool_result", tool_use_id: tr.toolCallId, content: tr.content, is_error: tr.isError || false }));
    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) (last.content as ContentBlock[]).push(...blocks);
    else out.push({ role: "user", content: blocks });
    pending = [];
  }
  for (const msg of canonical) {
    if (msg.role === "tool_result" && msg.toolResult) { pending.push(msg.toolResult); continue; }
    flush();
    if (msg.role === "system") { out.push({ role: "user", content: msg.content || "" }); continue; }
    if (msg.role === "user") {
      const last = out[out.length - 1];
      if (last?.role === "user" && typeof last.content === "string") last.content += "\n" + (msg.content || "");
      else out.push({ role: "user", content: msg.content || "" });
      continue;
    }
    if (msg.role === "assistant") {
      const blocks: ContentBlock[] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      if (msg.toolCalls) for (const tc of msg.toolCalls) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      out.push({ role: "assistant", content: blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text! : blocks });
    }
  }
  flush();
  const merged: Msg[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last?.role === m.role) {
      if (typeof last.content === "string" && typeof m.content === "string") last.content += "\n" + m.content;
      else {
        const a = typeof last.content === "string" ? [{ type: "text", text: last.content } as ContentBlock] : last.content;
        const b = typeof m.content === "string" ? [{ type: "text", text: m.content } as ContentBlock] : m.content;
        last.content = [...(a || []), ...(b || [])];
      }
    } else merged.push({ ...m });
  }
  return merged;
}
