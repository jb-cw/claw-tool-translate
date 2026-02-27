# claw-tool-translate

Session-aware tool call format translation across LLM providers.

## The problem

When you switch from Claude to GPT (or Grok, or Gemini) mid-conversation, the session history contains tool call artifacts from the previous provider that break the new one.

Existing tools like OpenRouter, LangChain, and LiteLLM solve the **request** problem: "send this tool definition to any provider." That's table stakes. The unsolved problem is the **session** problem: "I have a conversation with 40 messages including 6 tool calls made by Claude, and now I want to continue with GPT or Grok."

## The data

We analyzed **1,819 GitHub issues** from [openclaw/openclaw](https://github.com/openclaw/openclaw) and found that tool call format translation is the #1 unsolved problem in multi-provider AI agents:

| Category | Issues | Examples |
|---|---|---|
| **Tool calling** | 885 | Orphaned tool_use/tool_result, format mismatches, pairing errors |
| **Failover & multi-provider** | 606 | Session breaks on model switch, provider failover crashes |
| **xAI / Grok** | 129 | HTML entity encoding in tool call arguments |
| **Memory & session** | 4 | Session corruption after provider switch |

Full report: [pulse.snytch.ai/openclaw-github](https://pulse.snytch.ai/openclaw-github)

## Install

```bash
npm install claw-tool-translate
```

## Quick start

```typescript
import { translate, SessionTranslator } from "claw-tool-translate";

// One-shot: translate a session from one provider format to another
const openaiMessages = translate("anthropic", "openai", anthropicMessages);

// Session-aware: accumulate messages from multiple providers
const session = new SessionTranslator({ repairStrategy: "auto" });
session.addMessage("anthropic", claudeResponse);
const historyForGPT = session.emitFor("openai");
```

## What it does

```
Provider messages ──> ingest() ──> Canonical format ──> sanitize() ──> emit() ──> Target format
```

1. **Ingest** — Parse any provider's messages into a canonical format
2. **Sanitize** — Detect and repair orphaned tool calls, deduplicate tool names, compress old rounds
3. **Emit** — Serialize to any target provider's expected format

## Providers

| Provider | Wire format | What the adapter handles |
|---|---|---|
| **Anthropic** | `tool_use` / `tool_result` content blocks | Strict user/assistant turn alternation, content block arrays |
| **OpenAI** | `tool_calls` + `tool` role messages | Both legacy `function_call` and modern `tool_calls`, `call_id` vs `fc_id` |
| **xAI / Grok** | OpenAI-compatible + HTML entities | `&amp;` → `&`, `&#x2F;` → `/`, `&lt;` → `<` in arguments |
| **Google / Gemini** | `functionCall` / `functionResponse` parts | Alphanumeric-only tool call IDs, user/model alternation |
| **Mistral** | OpenAI-compatible + strict IDs | Tool call IDs must be exactly 9 alphanumeric characters |

## Session sanitizer

The sanitizer detects and repairs broken tool call history before sending to a new provider.

**Repair strategies:**

| Strategy | Behavior |
|---|---|
| `auto` (default) | Recent orphans get synthetic results; old ones get summarized |
| `inject` | Add `"Tool call was not completed."` result for all orphaned calls |
| `summarize` | Collapse orphaned calls to plain text like `[Previously called tool "X" — result unavailable]` |
| `drop` | Remove orphaned calls and results entirely |

```typescript
translate("anthropic", "openai", messages, {
  repairStrategy: "auto",
  deduplicateToolNames: true,
  compressOlderThan: 20,  // summarize tool rounds older than 20 messages
});
```

## API

```typescript
import {
  translate,          // one-shot translation
  ingest,             // parse provider messages → canonical
  emit,               // canonical → provider messages
  sanitize,           // repair orphans, dedup, compress
  findOrphans,        // detect broken tool call pairs
  SessionTranslator,  // stateful multi-provider session
} from "claw-tool-translate";

// Direct functions
const canonical = ingest("anthropic", messages);
const sanitized = sanitize(canonical, { repairStrategy: "auto" });
const openaiMsgs = emit("openai", sanitized);

// Or one-shot
const result = translate("grok", "anthropic", grokMessages);

// Or session-based
const session = new SessionTranslator({ repairStrategy: "auto" });
session.addMessage("anthropic", claudeMessages);
session.addMessage("openai", gptMessages);
const forGemini = session.emitFor("google");
const orphans = session.getOrphans();
```

## Testing

```bash
npm test           # 46 tests (unit + integration)
npm run test:watch # watch mode
```

Tests include:
- Per-adapter round-trip tests (ingest → emit → ingest is lossless)
- Cross-provider E2E (Anthropic → OpenAI → Anthropic preserves tool calls)
- Grok HTML entity decoding with real-world patterns
- Mistral strict9 ID enforcement
- Sanitizer: orphan detection, all 4 repair strategies, compression
- Live integration tests against real provider APIs via OpenRouter

## Status

This is an early release. The core translation library is tested and working. Here's what's done and what's planned:

- [x] Anthropic adapter (tool_use / tool_result)
- [x] OpenAI adapter (tool_calls + legacy function_call)
- [x] xAI/Grok adapter (HTML entity decoding)
- [x] Google/Gemini adapter (functionCall / functionResponse)
- [x] Mistral adapter (strict9 IDs)
- [x] Session sanitizer (orphan repair, dedup, compression)
- [x] 46 tests passing (unit + E2E + live API)
- [ ] OpenClaw plugin (waiting on [before_context_send hook](https://github.com/openclaw/openclaw/pull/24048))
- [ ] Streaming partial tool call handling
- [ ] Amazon Bedrock adapter
- [ ] Ollama / local model quirks

## Contributing

Contributions are welcome. If you've hit a tool call format bug in your multi-provider setup, especially:

- New provider formats we should support
- Edge cases in existing adapters
- Real session transcripts that break (anonymized)

Please open an issue or PR.

## License

MIT
