import { describe, it, expect } from "vitest";
import { ingest, emit } from "../../src/adapters/anthropic.js";
import fixture from "../fixtures/anthropic-session.json";

describe("Anthropic adapter", () => {
  it("ingests tool_use and tool_result", () => {
    const c = ingest(fixture as any);
    const tc = c.find(m => m.toolCalls?.length);
    expect(tc).toBeDefined();
    expect(tc!.toolCalls![0].name).toBe("web_search");
    const tr = c.find(m => m.role === "tool_result");
    expect(tr).toBeDefined();
    expect(tr!.toolResult!.toolCallId).toBe("toolu_01abc");
  });
  it("preserves text alongside tool calls", () => {
    const c = ingest(fixture as any);
    expect(c.find(m => m.toolCalls && m.content)).toBeDefined();
  });
  it("round-trips: ingest -> emit -> ingest", () => {
    const c1 = ingest(fixture as any);
    const c2 = ingest(emit(c1) as any);
    expect(c2.length).toBe(c1.length);
    for (let i = 0; i < c1.length; i++) expect(c2[i].role).toBe(c1[i].role);
  });
  it("emits strict user/assistant alternation", () => {
    const e = emit(ingest(fixture as any));
    for (let i = 1; i < e.length; i++) expect(e[i].role).not.toBe(e[i - 1].role);
  });
});
