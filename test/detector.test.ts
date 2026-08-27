import test from "node:test";
import assert from "node:assert/strict";
import {
  detectArchitecturalChange,
  extractDraftFromText,
  findMatchedKeywords,
} from "../src/detector.js";
import type { ADRIndex } from "../src/types.js";

test("findMatchedKeywords detects trigger words", () => {
  const text =
    "We implemented a temporary workaround to bypass legacy Notes 9 memory limits.";
  const matched = findMatchedKeywords(text);
  assert.ok(matched.includes("workaround"));
});

test("extractDraftFromText constructs structured draft", () => {
  const text = `
We had to refactor the database connector.
Context: Lotus Notes 9 C API crashes when called from 64-bit Node directly.
Decision: Spawn a 32-bit IPC worker subprocess with named pipes.
Consequences: Adds 2ms latency per query but prevents catastrophic host crashes.
`;
  const draft = extractDraftFromText(text);
  assert.ok(draft);
  assert.ok(draft.title.length > 0);
  assert.equal(
    draft.context,
    "Lotus Notes 9 C API crashes when called from 64-bit Node directly.",
  );
  assert.equal(
    draft.decision,
    "Spawn a 32-bit IPC worker subprocess with named pipes.",
  );
  assert.equal(
    draft.consequences,
    "Adds 2ms latency per query but prevents catastrophic host crashes.",
  );
});

test("detectArchitecturalChange ignores duplicates in index", () => {
  const index: ADRIndex = {
    version: 1,
    lastUpdated: "2026-03-30T00:00:00Z",
    records: [
      {
        id: "ADR-001",
        title: "Workaround for Notes 9",
        date: "2026-03-30",
        file: "1.md",
        constraint: "Workaround for Notes 9: Use IPC.",
        status: "active",
      },
    ],
  };

  const messages = [
    {
      role: "assistant",
      content:
        "Decision: Workaround for Notes 9.\nContext: Incompatible 32-bit.\nConsequences: Use IPC.",
    },
  ];

  const result = detectArchitecturalChange(messages, index);
  assert.equal(result.detected, false);
  assert.ok(result.reason?.includes("already recorded"));
});
