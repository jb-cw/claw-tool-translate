import { describe, it, expect } from "vitest";
import { sanitize, findOrphans } from "../src/sanitizer.js";
import { ingest } from "../src/adapters/anthropic.js";
import orphanFixture from "./fixtures/orphaned-session.json";
import type { CanonicalMessage } from "../src/canonical.js";

describe("Sanitizer", () => {
  describe("findOrphans", () => {
    it("detects orphaned calls", () => { const { orphanedCalls } = findOrphans(ingest(orphanFixture as any)); expect(orphanedCalls.length).toBe(2); });
    it("detects orphaned results", () => { const { orphanedResults } = findOrphans(ingest(orphanFixture as any)); expect(orphanedResults.length).toBe(1); });
  });
  describe("repair", () => {
    it("inject: adds synthetic results", () => {
      const r = sanitize(ingest(orphanFixture as any), { repairStrategy: "inject" });
      expect(findOrphans(r).orphanedCalls.length).toBe(0);
      expect(r.filter(m => m._meta?.synthetic).length).toBe(2);
    });
    it("drop: removes orphans", () => { expect(findOrphans(sanitize(ingest(orphanFixture as any), { repairStrategy: "drop" })).orphanedResults.length).toBe(0); });
    it("summarize: converts to text", () => { expect(sanitize(ingest(orphanFixture as any), { repairStrategy: "summarize" }).filter(m => m.content?.includes("[Previously called tool")).length).toBeGreaterThan(0); });
  });
  describe("compression", () => {
    it("compresses old rounds", () => {
      const msgs: CanonicalMessage[] = [
        { role: "user", content: "do" }, { role: "assistant", toolCalls: [{ id: "tc1", name: "web_search", arguments: {} }] },
        { role: "tool_result", toolResult: { toolCallId: "tc1", content: "r" } }, { role: "assistant", content: "done" },
        { role: "user", content: "now" }, { role: "assistant", toolCalls: [{ id: "tc2", name: "read_file", arguments: {} }] },
        { role: "tool_result", toolResult: { toolCallId: "tc2", content: "r2" } }, { role: "assistant", content: "here" },
      ];
      const c = sanitize(msgs, { compressOlderThan: 4 });
      expect(c.length).toBeLessThan(msgs.length);
      expect(c.find(m => m._meta?.compressed)).toBeDefined();
    });
  });
});
