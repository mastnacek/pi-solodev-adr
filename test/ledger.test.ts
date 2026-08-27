import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findProjectRoot,
  formatADRMarkdown,
  formatDate,
  getNextId,
  loadIndex,
  parseADRMarkdown,
  readRecord,
  resolveTargetRoot,
  saveRecord,
  searchRecords,
  slugify,
} from "../src/ledger.js";
import type { ADRDraft } from "../src/types.js";

test("getNextId generates sequence correctly", () => {
  assert.equal(getNextId([]), "ADR-001");
  assert.equal(getNextId([{ id: "ADR-001" }]), "ADR-002");
  assert.equal(getNextId([{ id: "ADR-001" }, { id: "ADR-009" }]), "ADR-010");
});

test("slugify normalizes titles", () => {
  assert.equal(
    slugify("Bridge Notes 9 C-API with Node N-API"),
    "bridge-notes-9-c-api-with-node-n-api",
  );
  assert.equal(
    slugify("Fix(Legacy): Memory Override!"),
    "fixlegacy-memory-override",
  );
});

test("formatDate supports date and time formatting", () => {
  const d = new Date("2026-08-27T10:55:30");
  const formatted = formatDate(d);
  assert.match(formatted, /^2026-08-27 \d{2}:\d{2}:\d{2}$/);

  // Passthrough valid string
  assert.equal(formatDate("2026-08-27 10:55:30"), "2026-08-27 10:55:30");
  assert.equal(formatDate("2026-08-27"), "2026-08-27");
});

test("formatADRMarkdown and parseADRMarkdown roundtrip with time", () => {
  const original = {
    id: "ADR-001",
    title: "Spawn 32-bit worker for Notes 9",
    date: "2026-03-30 14:22:10",
    context: "Notes 9 C-API binary 32-bit only.",
    decision: "Spawn isolated 32-bit IPC worker subprocess.",
    consequences: "Slight IPC overhead (~2ms).",
    status: "active" as const,
  };

  const markdown = formatADRMarkdown(original);
  const parsed = parseADRMarkdown(
    markdown,
    "2026-03-30-ADR-001-spawn-32-bit-worker.md",
  );

  assert.ok(parsed);
  assert.equal(parsed.id, "ADR-001");
  assert.equal(parsed.title, "Spawn 32-bit worker for Notes 9");
  assert.equal(parsed.date, "2026-03-30 14:22:10");
  assert.equal(parsed.status, "active");
  assert.equal(parsed.context, "Notes 9 C-API binary 32-bit only.");
  assert.equal(parsed.decision, "Spawn isolated 32-bit IPC worker subprocess.");
  assert.equal(parsed.consequences, "Slight IPC overhead (~2ms).");
});

test("saveRecord, readRecord, and searchRecords work with atomic storage", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-solo-radar-test-"));

  try {
    const draft1: ADRDraft = {
      title: "Bridge Notes 9 C-API",
      context: "Notes 9 requires 32-bit runtime.",
      decision: "Run 32-bit sidecar process.",
      consequences: "Maintains 64-bit host stability.",
      status: "active",
    };

    const record1 = await saveRecord(tempDir, draft1, ".pi");
    assert.equal(record1.id, "ADR-001");
    assert.equal(record1.status, "active");

    const draft2: ADRDraft = {
      title: "Android SDK 34 PhotoPicker",
      context: "READ_EXTERNAL_STORAGE deprecated in SDK 34.",
      decision: "Migrate to system PhotoPicker contract.",
      consequences: "Eliminates runtime storage permission prompt.",
      status: "active",
    };

    const record2 = await saveRecord(tempDir, draft2, ".pi");
    assert.equal(record2.id, "ADR-002");

    // Read back
    const read1 = await readRecord(tempDir, "ADR-001", ".pi");
    assert.ok(read1);
    assert.equal(read1.title, "Bridge Notes 9 C-API");

    const readByFile = await readRecord(tempDir, record2.file, ".pi");
    assert.ok(readByFile);
    assert.equal(readByFile.id, "ADR-002");

    // Verify index
    const index = await loadIndex(tempDir, ".pi");
    assert.equal(index.records.length, 2);

    // Search
    const searchMatches = await searchRecords(tempDir, "PhotoPicker", ".pi");
    assert.equal(searchMatches.length, 1);
    assert.equal(searchMatches[0].id, "ADR-002");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("findProjectRoot detects subproject boundaries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-solo-radar-sub-"));
  const subproject = join(tempDir, "sub-pkg");
  const nestedSrc = join(subproject, "src", "nested");

  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(nestedSrc, { recursive: true });
    await writeFile(join(subproject, "package.json"), "{}");

    // Scan from nested file should find subproject root
    const found = findProjectRoot(join(nestedSrc, "index.ts"), tempDir);
    assert.equal(found, subproject);

    // Fallback when no boundary exists
    const fallback = findProjectRoot(join(tempDir, "unknown.ts"), tempDir);
    assert.equal(fallback, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveTargetRoot picks dominant subproject root", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-solo-radar-target-"));
  const subA = join(tempDir, "plugin-a");
  const subB = join(tempDir, "plugin-b");

  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(subA, "src"), { recursive: true });
    await mkdir(join(subB, "src"), { recursive: true });
    await writeFile(join(subA, "package.json"), "{}");
    await writeFile(join(subB, "package.json"), "{}");

    const files = [
      join(subA, "src", "file1.ts"),
      join(subA, "src", "file2.ts"),
      join(subB, "src", "file3.ts"),
    ];

    const target = resolveTargetRoot(tempDir, files, true);
    assert.equal(target, subA);

    // When disabled, always returns tempDir
    const disabledTarget = resolveTargetRoot(tempDir, files, false);
    assert.equal(disabledTarget, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
