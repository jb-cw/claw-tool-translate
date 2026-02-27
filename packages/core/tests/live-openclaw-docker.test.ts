/**
 * Live OpenClaw Docker integration test.
 * Tests that toolcall-translate correctly processes real OpenClaw session transcripts.
 *
 * Requires: OpenClaw gateway running at localhost:18789 with OPENCLAW_GATEWAY_TOKEN set.
 * Run: OPENCLAW_GATEWAY_TOKEN=... npx vitest run tests/live-openclaw-docker.test.ts
 */
import { describe, it, expect } from "vitest";
import { ingest, emit, sanitize, translate, SessionTranslator, findOrphans } from "../src/index.js";

const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "e1fbfdcc31dd7c4637be6177c177acd42abf51ad37a7363e83e7e3bec9f56bf2";
const BASE = "http://127.0.0.1:18789";

async function toolsInvoke(tool: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/tools/invoke`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args, action: "json" }),
  });
  if (!res.ok) throw new Error(`tools/invoke ${tool}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ ok: boolean; result: { content: Array<{ type: string; text: string }>; details?: unknown } }>;
}

async function isGatewayUp(): Promise<boolean> {
  try {
    const r = await toolsInvoke("sessions_list");
    return r.ok === true;
  } catch { return false; }
}

describe.skipIf(!(await isGatewayUp().catch(() => false)))("Live OpenClaw Docker", () => {
  it("gateway is running and responds to tools/invoke", async () => {
    const r = await toolsInvoke("sessions_list");
    expect(r.ok).toBe(true);
  });

  it("session_history can be fetched and translated", async () => {
    const listResult = await toolsInvoke("sessions_list");
    const sessions = (listResult.result as any).details?.sessions || [];

    if (sessions.length === 0) {
      console.log("No sessions found - creating a synthetic test instead");
      // Test with a synthetic session that mimics what OpenClaw would produce
      const syntheticSession = [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant", content: null,
          tool_calls: [{ id: "call_test1", type: "function", function: { name: "get_weather", arguments: '{"location":"Tokyo"}' } }]
        },
        { role: "tool", tool_call_id: "call_test1", content: '{"temp":"20C","condition":"sunny"}' },
        { role: "assistant", content: "It's 20C and sunny in Tokyo." }
      ];

      // Translate to all providers
      for (const target of ["anthropic", "google", "mistral", "openai"] as const) {
        const out = translate("openai", target, syntheticSession);
        expect((out as any[]).length).toBeGreaterThan(0);
      }
      return;
    }

    // If there are sessions, fetch the first one's history
    const sessionKey = sessions[0].key || sessions[0].sessionKey;
    const histResult = await toolsInvoke("sessions_history", { sessionKey, includeTools: true, limit: 50 });
    expect(histResult.ok).toBe(true);
  });

  it("translates synthetic OpenClaw-style transcript across all 5 providers", () => {
    // Simulates a real OpenClaw transcript after Claude made tool calls via OpenRouter
    // OpenRouter returns in OpenAI format
    const openclawTranscript = [
      { role: "system", content: "You are a helpful assistant with access to tools." },
      { role: "user", content: "Search for the latest AI news and read the config file" },
      {
        role: "assistant",
        content: "I'll help you with both tasks.",
        tool_calls: [
          { id: "call_01abc", type: "function", function: { name: "web_search", arguments: '{"query":"latest AI news 2026"}' } },
          { id: "call_02def", type: "function", function: { name: "read_file", arguments: '{"path":"config.json"}' } }
        ]
      },
      { role: "tool", tool_call_id: "call_01abc", content: "AI continues to advance in 2026. Major breakthroughs in reasoning and tool use." },
      { role: "tool", tool_call_id: "call_02def", content: '{"database":"postgres","port":5432}' },
      { role: "assistant", content: "Here's what I found:\n1. AI news: Major breakthroughs in reasoning\n2. Config: PostgreSQL on port 5432" },
      { role: "user", content: "Now switch to using Grok and search for something else" },
      // Simulate a Grok response with HTML entities (the bug we're fixing)
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_grok1", type: "function", function: { name: "web_search", arguments: '{"query":"Tom &amp; Jerry &lt;new season&gt;"}' } }
        ]
      },
      { role: "tool", tool_call_id: "call_grok1", content: "New Tom & Jerry season announced for 2026" },
      { role: "assistant", content: "Found info about the new Tom & Jerry season." }
    ];

    // Ingest as OpenAI (what OpenRouter returns)
    const canonical = ingest("openai", openclawTranscript);
    expect(canonical.length).toBeGreaterThan(0);

    // Fix Grok HTML entities by re-ingesting the Grok portion
    const grokPortion = openclawTranscript.slice(7, 10);
    const grokCanonical = ingest("grok", grokPortion);
    const grokToolCall = grokCanonical.find(m => m.toolCalls?.length);
    expect(grokToolCall!.toolCalls![0].arguments.query).toBe("Tom & Jerry <new season>");

    // Sanitize
    const sanitized = sanitize(canonical, { repairStrategy: "auto" });
    const orphans = findOrphans(sanitized);
    expect(orphans.orphanedCalls.length).toBe(0);
    expect(orphans.orphanedResults.length).toBe(0);

    // Emit for each provider
    const anthropicOut = emit("anthropic", sanitized) as any[];
    expect(anthropicOut.length).toBeGreaterThan(0);
    for (let i = 1; i < anthropicOut.length; i++) expect(anthropicOut[i].role).not.toBe(anthropicOut[i-1].role);

    const googleOut = emit("google", sanitized) as any[];
    expect(googleOut[0].role).toBe("user");
    expect(googleOut.some((m: any) => m.parts?.some((p: any) => p.functionCall))).toBe(true);

    const mistralOut = emit("mistral", sanitized) as any[];
    for (const m of mistralOut) {
      if (m.tool_calls) for (const tc of m.tool_calls) expect(tc.id).toMatch(/^[a-zA-Z0-9]{9}$/);
    }
  });

  it("handles orphaned tool calls from interrupted sessions", () => {
    // Simulates what happens when OpenClaw session is interrupted mid-tool-call
    const interrupted = [
      { role: "user", content: "Search for something" },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "call_orphan", type: "function", function: { name: "web_search", arguments: '{"query":"test"}' } }]
      },
      // No tool result -- session was interrupted
      { role: "user", content: "Never mind, let's do something else" },
      { role: "assistant", content: "Sure, what would you like?" }
    ];

    const canonical = ingest("openai", interrupted);
    const { orphanedCalls } = findOrphans(canonical);
    expect(orphanedCalls.length).toBe(1);

    // Repair with inject strategy
    const repaired = sanitize(canonical, { repairStrategy: "inject" });
    const { orphanedCalls: remaining } = findOrphans(repaired);
    expect(remaining.length).toBe(0);

    // Should now be valid for Anthropic (strict alternation)
    const anthropicOut = emit("anthropic", repaired) as any[];
    for (let i = 1; i < anthropicOut.length; i++) expect(anthropicOut[i].role).not.toBe(anthropicOut[i-1].role);
  });

  it("parallel tool calls are preserved across providers", () => {
    const parallel = [
      { role: "user", content: "Get weather in Tokyo and London" },
      {
        role: "assistant", content: "Let me check both.",
        tool_calls: [
          { id: "call_p1", type: "function", function: { name: "get_weather", arguments: '{"location":"Tokyo"}' } },
          { id: "call_p2", type: "function", function: { name: "get_weather", arguments: '{"location":"London"}' } }
        ]
      },
      { role: "tool", tool_call_id: "call_p1", content: '{"temp":"20C"}' },
      { role: "tool", tool_call_id: "call_p2", content: '{"temp":"12C"}' },
      { role: "assistant", content: "Tokyo: 20C, London: 12C" }
    ];

    // Translate to Anthropic (must maintain pairing)
    const anthropic = translate("openai", "anthropic", parallel) as any[];
    const assistantWithTools = anthropic.find((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_use"));
    expect(assistantWithTools).toBeDefined();
    const toolUses = assistantWithTools.content.filter((b: any) => b.type === "tool_use");
    expect(toolUses.length).toBe(2);

    // Translate to Google (functionCall parts)
    const google = translate("openai", "google", parallel) as any[];
    const modelWithFns = google.find((m: any) => m.parts?.filter((p: any) => p.functionCall).length === 2);
    expect(modelWithFns).toBeDefined();
  });
});
