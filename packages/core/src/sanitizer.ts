import type { CanonicalMessage, RepairStrategy, TranslateOptions } from "./canonical.js";

export interface OrphanedToolCall { index: number; id: string; name: string; }
export interface OrphanedToolResult { index: number; toolCallId: string; }

export function findOrphans(messages: CanonicalMessage[]) {
  const callIds = new Set<string>(), resultIds = new Set<string>();
  for (const m of messages) {
    if (m.toolCalls) for (const tc of m.toolCalls) callIds.add(tc.id);
    if (m.role === "tool_result" && m.toolResult) resultIds.add(m.toolResult.toolCallId);
  }
  const orphanedCalls: OrphanedToolCall[] = [], orphanedResults: OrphanedToolResult[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.toolCalls) for (const tc of m.toolCalls) if (!resultIds.has(tc.id)) orphanedCalls.push({ index: i, id: tc.id, name: tc.name });
    if (m.role === "tool_result" && m.toolResult && !callIds.has(m.toolResult.toolCallId)) orphanedResults.push({ index: i, toolCallId: m.toolResult.toolCallId });
  }
  return { orphanedCalls, orphanedResults };
}

function repairCalls(messages: CanonicalMessage[], orphans: OrphanedToolCall[], strategy: RepairStrategy, total: number): CanonicalMessage[] {
  const out = [...messages];
  const toInsert: Array<{ after: number; msg: CanonicalMessage }> = [];
  for (const o of orphans) {
    const eff = strategy === "auto" ? (o.index > total - 6 ? "inject" : "summarize") : strategy;
    if (eff === "drop") continue;
    if (eff === "inject") {
      toInsert.push({ after: o.index, msg: { role: "tool_result", toolResult: { toolCallId: o.id, content: "Tool call was not completed.", isError: true }, _meta: { synthetic: true } } });
    } else if (eff === "summarize") {
      const cm = out[o.index];
      if (cm?.toolCalls) {
        cm.toolCalls = cm.toolCalls.filter(tc => tc.id !== o.id);
        if (!cm.toolCalls.length) delete cm.toolCalls;
        const s = `[Previously called tool "${o.name}" — result unavailable]`;
        cm.content = cm.content ? cm.content + "\n" + s : s;
      }
    }
  }
  for (const ins of toInsert.sort((a, b) => b.after - a.after)) out.splice(ins.after + 1, 0, ins.msg);
  return out;
}

function dedup(messages: CanonicalMessage[]): CanonicalMessage[] {
  return messages;
}

function compress(messages: CanonicalMessage[], keep: number): CanonicalMessage[] {
  if (messages.length <= keep) return messages;
  const cut = messages.length - keep, out: CanonicalMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i < cut && m.role === "assistant" && m.toolCalls?.length) {
      const names = m.toolCalls.map(tc => tc.name).join(", ");
      const summary = m.content ? m.content + `\n[Used tools: ${names}]` : `[Used tools: ${names}]`;
      out.push({ role: "assistant", content: summary, _meta: { compressed: true } });
      const ids = new Set(m.toolCalls.map(tc => tc.id));
      while (i + 1 < cut && messages[i + 1]?.role === "tool_result" && messages[i + 1]?.toolResult && ids.has(messages[i + 1].toolResult!.toolCallId)) i++;
    } else out.push(m);
  }
  return out;
}

export function sanitize(messages: CanonicalMessage[], options: TranslateOptions = {}): CanonicalMessage[] {
  const strategy = options.repairStrategy || "auto";
  let result = [...messages];
  const { orphanedCalls, orphanedResults } = findOrphans(result);
  if (orphanedResults.length) { const idxs = new Set(orphanedResults.map(o => o.index)); result = result.filter((_, i) => !idxs.has(i)); }
  if (orphanedCalls.length && strategy !== "drop") result = repairCalls(result, orphanedCalls, strategy, messages.length);
  else if (strategy === "drop") {
    const { orphanedCalls: oc } = findOrphans(result);
    const ids = new Set(oc.map(o => o.id));
    result = result.map(m => {
      if (!m.toolCalls) return m;
      const f = m.toolCalls.filter(tc => !ids.has(tc.id));
      if (f.length === m.toolCalls.length) return m;
      const u = { ...m }; if (f.length) u.toolCalls = f; else delete u.toolCalls; return u;
    });
  }
  if (options.deduplicateToolNames !== false) result = dedup(result);
  if (options.compressOlderThan != null && options.compressOlderThan > 0) result = compress(result, options.compressOlderThan);
  return result;
}
