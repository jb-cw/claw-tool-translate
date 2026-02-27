import { describe, it, expect } from "vitest";
import { translate, ingest, emit, SessionTranslator } from "../src/index.js";
import anthropicFix from "./fixtures/anthropic-session.json";
import openaifix from "./fixtures/openai-session.json";
import grokFix from "./fixtures/grok-session-html-entities.json";
import mistralFix from "./fixtures/mistral-session.json";

describe("E2E cross-provider", () => {
  it("Anthropic -> OpenAI", () => {
    const r = translate("anthropic", "openai", anthropicFix as any) as any[];
    expect(r.find(m => m.tool_calls)?.tool_calls[0].function.name).toBe("web_search");
    expect(r.find(m => m.role === "tool")?.tool_call_id).toBeDefined();
  });
  it("OpenAI -> Anthropic (alternation)", () => {
    const r = translate("openai", "anthropic", openaifix as any) as any[];
    for (let i = 1; i < r.length; i++) expect(r[i].role).not.toBe(r[i-1].role);
  });
  it("Grok -> Anthropic (HTML decoded)", () => {
    const r = translate("grok", "anthropic", grokFix as any) as any[];
    const tu = r.find((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_use"));
    expect(tu.content.find((b: any) => b.type === "tool_use").input.query).toBe("Tom & Jerry episodes <2026>");
  });
  it("Anthropic -> Google (Gemini format)", () => {
    const r = translate("anthropic", "google", anthropicFix as any) as any[];
    for (let i = 1; i < r.length; i++) expect(r[i].role).not.toBe(r[i-1].role);
    expect(r.find((m: any) => m.parts?.some((p: any) => p.functionCall))).toBeDefined();
  });
  it("OpenAI -> Mistral (strict9 IDs)", () => {
    const r = translate("openai", "mistral", openaifix as any) as any[];
    for (const m of r) if (m.tool_calls) for (const tc of m.tool_calls) expect(tc.id).toMatch(/^[a-zA-Z0-9]{9}$/);
  });
  it("Mistral -> Anthropic (ID normalisation)", () => {
    const r = translate("mistral", "anthropic", mistralFix as any) as any[];
    expect(r.length).toBeGreaterThan(0);
    for (let i = 1; i < r.length; i++) expect(r[i].role).not.toBe(r[i-1].role);
  });
  it("SessionTranslator accumulates multi-provider", () => {
    const s = new SessionTranslator();
    s.addMessage("anthropic", anthropicFix as any);
    expect(s.length).toBeGreaterThan(0);
    expect((s.emitFor("openai") as any[]).length).toBeGreaterThan(0);
    expect((s.emitFor("mistral") as any[]).length).toBeGreaterThan(0);
  });
  it("Full round-trip Anthropic -> OpenAI -> Anthropic", () => {
    const c1 = ingest("anthropic", anthropicFix as any);
    const c2 = ingest("openai", emit("openai", c1) as any[]);
    const r = emit("anthropic", c2) as any[];
    expect(r.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_use"))).toBe(true);
  });
});
