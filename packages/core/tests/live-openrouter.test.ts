/**
 * Live integration test via OpenRouter.
 * Calls real models and verifies cross-provider tool call translation.
 * Run: OPENROUTER_API_KEY=sk-... npx vitest run tests/live-openrouter.test.ts
 */
import { describe, it, expect } from "vitest";
import { ingest, emit, translate, SessionTranslator } from "../src/index.js";

const API_KEY = process.env.OPENROUTER_API_KEY;
const BASE = "https://openrouter.ai/api/v1/chat/completions";

const MODELS = {
  claude: "anthropic/claude-sonnet-4.6",
  gpt: "openai/gpt-4o-2024-11-20",
  grok: "x-ai/grok-4.1-fast",
  gemini: "google/gemini-2.5-flash",
  mistral: "mistralai/mistral-medium-3.1",
};

const TOOLS = [{
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Get the current weather for a location",
    parameters: {
      type: "object",
      properties: { location: { type: "string", description: "City name" } },
      required: ["location"],
    },
  },
}];

async function callModel(model: string, messages: any[]) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto" }),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message;
}

describe.skipIf(!API_KEY)("Live OpenRouter integration", () => {
  it("Claude makes a tool call that translates to OpenAI format", async () => {
    const claudeResp = await callModel(MODELS.claude, [
      { role: "user", content: "What's the weather in Tokyo? Use the get_weather tool." },
    ]);
    expect(claudeResp).toBeDefined();

    // OpenRouter returns in OpenAI format, simulate Anthropic-native by round-tripping
    const session = [
      { role: "user", content: "What's the weather in Tokyo? Use the get_weather tool." },
      claudeResp,
    ];

    const canonical = ingest("openai", session);
    const tcMsg = canonical.find(m => m.toolCalls?.length);
    expect(tcMsg).toBeDefined();
    expect(tcMsg!.toolCalls![0].name).toBe("get_weather");

    // Translate to all targets
    for (const target of ["openai", "anthropic", "google", "mistral"] as const) {
      const out = emit(target, canonical);
      expect(out.length).toBeGreaterThan(0);
    }
  }, 30000);

  it("GPT tool call translates to Anthropic format with alternation", async () => {
    const gptResp = await callModel(MODELS.gpt, [
      { role: "user", content: "What's the weather in Paris? Use the get_weather tool." },
    ]);
    const session = [
      { role: "user", content: "What's the weather in Paris? Use the get_weather tool." },
      gptResp,
    ];
    const anthropic = translate("openai", "anthropic", session) as any[];
    expect(anthropic.length).toBeGreaterThan(0);
    for (let i = 1; i < anthropic.length; i++) expect(anthropic[i].role).not.toBe(anthropic[i-1].role);
  }, 30000);

  it("Mistral tool call gets strict9 IDs", async () => {
    const mistralResp = await callModel(MODELS.mistral, [
      { role: "user", content: "What's the weather in London? Use the get_weather tool." },
    ]);
    const session = [
      { role: "user", content: "What's the weather in London? Use the get_weather tool." },
      mistralResp,
    ];
    const canonical = ingest("openai", session);
    const mistralOut = emit("mistral", canonical) as any[];
    for (const m of mistralOut) {
      if (m.tool_calls) for (const tc of m.tool_calls) expect(tc.id).toMatch(/^[a-zA-Z0-9]{9}$/);
    }
  }, 30000);

  it("SessionTranslator: multi-provider accumulation with real responses", async () => {
    const translator = new SessionTranslator({ repairStrategy: "auto" });

    const userMsg = [{ role: "user", content: "What's the weather in Berlin? Use the get_weather tool." }];
    const claudeResp = await callModel(MODELS.claude, userMsg);

    translator.addMessage("openai", [...userMsg, claudeResp]);

    // Simulate tool result
    if (claudeResp.tool_calls?.length) {
      const fakeResult = [{ role: "tool", tool_call_id: claudeResp.tool_calls[0].id, content: JSON.stringify({ temp: "18C", condition: "cloudy" }) }];
      translator.addMessage("openai", fakeResult);
    }

    // Emit for each provider
    for (const target of ["openai", "anthropic", "google", "mistral"] as const) {
      const out = translator.emitFor(target);
      expect((out as any[]).length).toBeGreaterThan(0);
    }
  }, 30000);
});
