import { describe, it, expect } from "vitest";
import { ingest, emit } from "../../src/adapters/google.js";

const fix = [
  { role: "user", parts: [{ text: "Search for AI news" }] },
  { role: "model", parts: [{ text: "Let me search." }, { functionCall: { name: "web_search", args: { query: "AI news 2026" } } }] },
  { role: "user", parts: [{ functionResponse: { name: "web_search", response: { results: "AI is advancing..." } } }] },
  { role: "model", parts: [{ text: "Here's what I found." }] },
];

describe("Google/Gemini adapter", () => {
  it("ingests functionCall/functionResponse", () => {
    const c = ingest(fix as any);
    expect(c.find(m => m.toolCalls)!.toolCalls![0].name).toBe("web_search");
    expect(c.find(m => m.role === "tool_result")).toBeDefined();
  });
  it("generates alphanumeric IDs", () => { expect(ingest(fix as any).find(m => m.toolCalls)!.toolCalls![0].id).toMatch(/^[a-zA-Z0-9]+$/); });
  it("emits model/user roles", () => { const e = emit(ingest(fix as any)); expect(e.find((m: any) => m.parts?.some((p: any) => p.functionCall))!.role).toBe("model"); });
  it("ensures alternation", () => { const e = emit(ingest(fix as any)); for (let i = 1; i < e.length; i++) expect(e[i].role).not.toBe(e[i-1].role); });
  it("prepends user if starts with model", () => { expect(emit(ingest([{ role: "model", parts: [{ text: "Hi" }] }] as any))[0].role).toBe("user"); });
});
