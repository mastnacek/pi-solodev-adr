import test from "node:test";
import assert from "node:assert/strict";
import {
  injectDoctrineIntoSystemPrompt,
  synthesizeConstraints,
} from "../src/injector.js";
import type { ADRIndex } from "../src/types.js";

test("synthesizeConstraints returns empty string when index has no active records", () => {
  const emptyIndex: ADRIndex = { version: 1, lastUpdated: "", records: [] };
  assert.equal(synthesizeConstraints(emptyIndex), "");

  const supersededIndex: ADRIndex = {
    version: 1,
    lastUpdated: "",
    records: [
      {
        id: "ADR-001",
        title: "Old decision",
        date: "2025-01-01",
        file: "f.md",
        constraint: "Old constraint",
        status: "superseded",
      },
    ],
  };
  assert.equal(synthesizeConstraints(supersededIndex), "");
});

test("synthesizeConstraints formats active records with capping", () => {
  const index: ADRIndex = {
    version: 1,
    lastUpdated: "2026-03-30T00:00:00Z",
    records: [
      {
        id: "ADR-001",
        title: "Notes 9 Bridge",
        date: "2026-03-30",
        file: "1.md",
        constraint: "Notes 9 Bridge: Run 32-bit IPC worker.",
        status: "active",
      },
      {
        id: "ADR-002",
        title: "Rust FFI Memory",
        date: "2026-03-30",
        file: "2.md",
        constraint: "Rust FFI Memory: Pin pointers before FFI boundary.",
        status: "active",
      },
    ],
  };

  const constraints = synthesizeConstraints(index, 10);
  assert.ok(constraints.includes("## Architectural Doctrine (pi-solo-radar)"));
  assert.ok(
    constraints.includes("- [ADR-001] Notes 9 Bridge: Run 32-bit IPC worker."),
  );
  assert.ok(
    constraints.includes(
      "- [ADR-002] Rust FFI Memory: Pin pointers before FFI boundary.",
    ),
  );

  // Test capping
  const capped = synthesizeConstraints(index, 1);
  assert.ok(capped.includes("- [ADR-001]"));
  assert.ok(capped.includes("(1 more active ADR records in `.pi/decisions/`"));
});

test("injectDoctrineIntoSystemPrompt appends doctrine to prompt", () => {
  const index: ADRIndex = {
    version: 1,
    lastUpdated: "2026-03-30T00:00:00Z",
    records: [
      {
        id: "ADR-001",
        title: "Rule",
        date: "2026-03-30",
        file: "1.md",
        constraint: "Rule: Do not break.",
        status: "active",
      },
    ],
  };

  const basePrompt = "You are an expert coding assistant.";
  const injected = injectDoctrineIntoSystemPrompt(basePrompt, index);

  assert.ok(injected.startsWith("You are an expert coding assistant."));
  assert.ok(injected.includes("## Architectural Doctrine (pi-solo-radar)"));
  assert.ok(injected.includes("[ADR-001] Rule: Do not break."));
});
