# Contributing to claw-tool-translate

Thanks for your interest in contributing.

## How to help

The most valuable contributions right now:

1. **Real-world test cases** — If you've hit a tool call format bug when switching providers, share the session (anonymized). Every real failure pattern makes the library more robust.

2. **New provider adapters** — We support 5 providers. If you use one that's missing (Bedrock, Ollama, Cohere, etc.), adding an adapter is straightforward — look at `src/adapters/openai.ts` as a template.

3. **Edge case fixes** — Streaming partial tool calls, nested tool calls, very long sessions. The sanitizer handles the common cases but there are always more.

## Development

```bash
git clone https://github.com/jb-cw/claw-tool-translate.git
cd claw-tool-translate
npm install
npm test
```

Tests are in `packages/core/tests/`. Add fixtures to `tests/fixtures/` and corresponding test cases.

## Code style

- TypeScript, strict mode
- No runtime dependencies (zero deps)
- Every adapter must have: `ingest()` and `emit()` functions, round-trip test, at least one fixture

## Pull requests

- Keep PRs focused (one adapter or one fix per PR)
- Add tests for any new behavior
- Run `npm test` before submitting
