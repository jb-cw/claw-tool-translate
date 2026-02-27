import { describe, it, expect } from "vitest";
import { ingest, emit } from "../../src/adapters/grok.js";
import fixture from "../fixtures/grok-session-html-entities.json";

describe("Grok/xAI adapter", () => {
  it("decodes HTML entities in arguments", () => {
    const c = ingest(fixture as any);
    expect(c.find(m => m.toolCalls?.length)!.toolCalls![0].arguments.query).toBe("Tom & Jerry episodes <2026>");
  });
  it("decodes &#x2F; to /", () => {
    const c = ingest(fixture as any);
    expect(c.find(m => m.toolCalls?.some(tc => tc.name === "read_file"))!.toolCalls!.find(t => t.name === "read_file")!.arguments.path).toBe("data/config.json");
  });
  it("tags with grok provider", () => { for (const m of ingest(fixture as any)) expect(m._meta?.originalProvider).toBe("grok"); });
  it("round-trips through emit", () => { expect((emit(ingest(fixture as any)) as any[]).find(m => m.tool_calls)).toBeDefined(); });
});
