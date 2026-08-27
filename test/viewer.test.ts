import test from "node:test";
import assert from "node:assert/strict";
import {
  formatReadingMode,
  formatReadingModeText,
  highlightADRMarkdown,
  renderDirectoryHeader,
  renderDirectoryTable,
  renderStatusBadge,
  stripMarkdownSyntax,
} from "../src/viewer.js";
import type { ADRIndex, ADRRecord } from "../src/types.js";

test("stripMarkdownSyntax removes formatting markers", () => {
  const input =
    "### Heading with **bold**, *italic*, `code`, and [link](https://example.com)";
  const stripped = stripMarkdownSyntax(input);
  assert.equal(stripped, "Heading with bold, italic, code, and link");

  const bulletInput = "- First item\n* Second item";
  const bulletStripped = stripMarkdownSyntax(bulletInput);
  assert.ok(bulletStripped.includes("• First item"));
  assert.ok(bulletStripped.includes("• Second item"));
  assert.ok(!bulletStripped.includes("- First"));
});

test("renderStatusBadge generates correct badges", () => {
  const active = renderStatusBadge("active");
  const superseded = renderStatusBadge("superseded");
  const deprecated = renderStatusBadge("deprecated");

  assert.ok(active.includes("● active"));
  assert.ok(superseded.includes("○ superseded"));
  assert.ok(deprecated.includes("× deprecated"));
});

test("formatReadingMode produces clean readable view without markdown syntax marks", () => {
  const record: ADRRecord = {
    id: "ADR-001",
    title: "Spawn 32-bit worker",
    date: "2026-08-27 10:50:45",
    context: "Notes 9 C-API is **32-bit only**; host uses `node-64`.",
    decision: "Spawn *isolated* IPC subprocess.",
    consequences: "Eliminates crashes.",
    status: "active",
    file: "2026-08-27-ADR-001-spawn-32-bit-worker.md",
  };

  const rendered = formatReadingMode(record);

  // Must not have raw Markdown markers
  assert.ok(!rendered.includes("**32-bit only**"));
  assert.ok(!rendered.includes("`node-64`"));
  assert.ok(!rendered.includes("*isolated*"));
  assert.ok(!rendered.includes("- **Date:**"));
  assert.ok(!rendered.includes("- **Context:**"));

  // Must contain clean content and section labels
  assert.ok(rendered.includes("ADR 001 : SPAWN 32-BIT WORKER"));
  assert.ok(rendered.includes("32-bit only"));
  assert.ok(rendered.includes("node-64"));
  assert.ok(rendered.includes("CONTEXT & PROBLEM"));
  assert.ok(rendered.includes("DECISION & APPROACH"));
  assert.ok(rendered.includes("CONSEQUENCES & TRADE-OFFS"));
});

test("formatReadingModeText formats arbitrary markdown cleanly", () => {
  const md = [
    "# ADR-001: Publish to GitHub",
    "- **Date:** 2026-08-27 10:50:45",
    "- **Status:** active",
    "- **Context:** Need **reproducible** distribution.",
    "- **Decision:** Use `pi install git:...` format.",
    "- **Consequences:** Easy install.",
  ].join("\n");

  const rendered = formatReadingModeText(md);
  assert.ok(!rendered.includes("**Date:**"));
  assert.ok(!rendered.includes("**reproducible**"));
  assert.ok(!rendered.includes("`pi install"));
  assert.ok(rendered.includes("reproducible"));
  assert.ok(rendered.includes("pi install"));
});

test("highlightADRMarkdown highlights keys and values", () => {
  const record: ADRRecord = {
    id: "ADR-001",
    title: "Spawn 32-bit worker",
    date: "2026-08-27 10:50:45",
    context: "Notes 9 C-API 32-bit.",
    decision: "Spawn IPC subprocess.",
    consequences: "Adds 2ms overhead.",
    status: "active",
    file: "2026-08-27-ADR-001-spawn-32-bit-worker.md",
  };

  const highlighted = highlightADRMarkdown(record);
  assert.ok(highlighted.includes("ADR-001"));
  assert.ok(highlighted.includes("**Date:**"));
  assert.ok(highlighted.includes("**Status:**"));
  assert.ok(highlighted.includes("**Context:**"));
  assert.ok(highlighted.includes("**Decision:**"));
  assert.ok(highlighted.includes("**Consequences:**"));
});

test("renderDirectoryHeader and renderDirectoryTable format nicely", () => {
  const index: ADRIndex = {
    version: 1,
    lastUpdated: "2026-08-27 10:50:45",
    records: [
      {
        id: "ADR-001",
        title: "Bridge Notes 9 C-API",
        date: "2026-08-27 10:50:45",
        file: "1.md",
        constraint: "Bridge Notes 9 C-API: Run 32-bit worker.",
        status: "active",
      },
      {
        id: "ADR-002",
        title: "Old Storage Method",
        date: "2026-08-27 10:52:00",
        file: "2.md",
        constraint: "Old Storage: Deprecated.",
        status: "superseded",
      },
    ],
  };

  const header = renderDirectoryHeader(index, "docs/adr");
  assert.ok(header.some((line) => line.includes("ADR ARCHITECTURAL LEDGER")));
  assert.ok(header.some((line) => line.includes("total")));

  const table = renderDirectoryTable(index, "docs/adr");
  assert.ok(table.includes("ARCHITECTURAL DECISIONS"));
  assert.ok(table.includes("ADR-001"));
  assert.ok(table.includes("Bridge Notes 9 C-API"));
  assert.ok(table.includes("ADR-002"));
  assert.ok(table.includes("Old Storage Method"));
});
