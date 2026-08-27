import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  getAvailableModels,
  loadConfig,
  saveConfig,
} from "../src/config.js";

test("loadConfig returns default config when no custom settings exist", () => {
  const cfg = loadConfig();
  assert.ok(cfg.translateModel);
  assert.equal(cfg.translateModel, DEFAULT_CONFIG.translateModel);
});

test("saveConfig updates and persists config", () => {
  const original = loadConfig();
  try {
    saveConfig({ translateModel: "openrouter/anthropic/claude-3.5-haiku" });
    const updated = loadConfig();
    assert.equal(updated.translateModel, "openrouter/anthropic/claude-3.5-haiku");
  } finally {
    saveConfig({ translateModel: original.translateModel });
  }
});

test("getAvailableModels returns standard models list", () => {
  const models = getAvailableModels();
  assert.ok(models.includes("current"));
  assert.ok(models.includes("default"));
  assert.ok(models.includes("openrouter/google/gemini-2.5-flash"));
});
