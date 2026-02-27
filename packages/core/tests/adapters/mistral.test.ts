import { describe, it, expect } from "vitest";
import { ingest, emit } from "../../src/adapters/mistral.js";
import fixture from "../fixtures/mistral-session.json";

describe("Mistral adapter", () => {
  it("ingests OpenAI-compatible messages", () => {
    const c = ingest(fixture as any);
    expect(c.find(m => m.toolCalls?.length)!.toolCalls![0].name).toBe("web_search");
  });

  it("tags with mistral provider", () => {
    for (const m of ingest(fixture as any)) expect(m._meta?.originalProvider).toBe("mistral");
  });

  it("emits strict9 tool call IDs (exactly 9 alphanumeric chars)", () => {
    const c = ingest(fixture as any);
    const emitted = emit(c) as any[];
    const withCalls = emitted.filter(m => m.tool_calls);
    for (const m of withCalls) {
      for (const tc of m.tool_calls) {
        expect(tc.id).toMatch(/^[a-zA-Z0-9]{9}$/);
      }
    }
  });

  it("emits matching tool_call_id on tool role messages (also strict9)", () => {
    const c = ingest(fixture as any);
    const emitted = emit(c) as any[];
    const toolMsgs = emitted.filter(m => m.role === "tool");
    for (const m of toolMsgs) {
      expect(m.tool_call_id).toMatch(/^[a-zA-Z0-9]{9}$/);
    }
  });

  it("preserves ID pairing (call ID matches result ID)", () => {
    const c = ingest(fixture as any);
    const emitted = emit(c) as any[];
    const callIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const m of emitted) {
      if (m.tool_calls) for (const tc of m.tool_calls) callIds.add(tc.id);
      if (m.role === "tool") resultIds.add(m.tool_call_id);
    }
    for (const rid of resultIds) expect(callIds.has(rid)).toBe(true);
  });

  it("sanitises non-alphanumeric IDs (underscores, hyphens)", () => {
    const c = ingest(fixture as any);
    const longIdCall = c.find(m => m.toolCalls?.some(tc => tc.id.includes("_")));
    expect(longIdCall).toBeDefined();
    const emitted = emit(c) as any[];
    const toolCalls = emitted.flatMap((m: any) => m.tool_calls || []);
    for (const tc of toolCalls) {
      expect(tc.id).not.toContain("_");
      expect(tc.id.length).toBe(9);
    }
  });
});
