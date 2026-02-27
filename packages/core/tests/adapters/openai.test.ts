import { describe, it, expect } from "vitest";
import { ingest, emit } from "../../src/adapters/openai.js";
import fixture from "../fixtures/openai-session.json";

describe("OpenAI adapter", () => {
  it("ingests tool_calls and tool role messages", () => {
    const c = ingest(fixture as any);
    expect(c.find(m => m.toolCalls?.length)!.toolCalls![0].name).toBe("web_search");
    expect(c.find(m => m.role === "tool_result")!.toolResult!.toolCallId).toBe("call_abc123");
  });
  it("handles system messages", () => { expect(ingest(fixture as any).find(m => m.role === "system")!.content).toContain("helpful"); });
  it("round-trips", () => {
    const c1 = ingest(fixture as any), c2 = ingest(emit(c1) as any);
    expect(c2.length).toBe(c1.length);
  });
  it("emits tool_call_id", () => { expect((emit(ingest(fixture as any)) as any[]).find(m => m.role === "tool").tool_call_id).toBeDefined(); });
});
