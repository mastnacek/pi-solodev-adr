import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface PluginConfig {
  translateModel: string;
}

export const DEFAULT_CONFIG: PluginConfig = {
  translateModel: "openrouter/google/gemini-2.5-flash",
};

export const CONFIG_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "pi-solo-radar.json",
);

export function loadConfig(): PluginConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<PluginConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
      };
    }
  } catch {
    // Non-fatal
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(cfg: Partial<PluginConfig>): void {
  try {
    const current = loadConfig();
    const updated: PluginConfig = { ...current, ...cfg };
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf8");
  } catch {
    // Non-fatal
  }
}

/**
 * Dynamic model discovery following standard Pi TUI search integration.
 */
export function getAvailableModels(
  ctx?: ExtensionContext | ExtensionCommandContext,
): string[] {
  const models = new Set<string>([
    "current",
    "default",
    "openrouter/google/gemini-2.5-flash",
    "openrouter/google/gemini-3.1-flash-lite",
    "openrouter/meta-llama/llama-3.3-70b-instruct",
    "openrouter/anthropic/claude-3.5-haiku",
  ]);

  // 1. Read models from ~/.pi/agent/models-store.json
  try {
    const storePath = join(homedir(), ".pi", "agent", "models-store.json");
    if (existsSync(storePath)) {
      const data = JSON.parse(readFileSync(storePath, "utf8")) as Record<
        string,
        { models?: Array<string | { id?: string }> }
      >;
      for (const [provider, info] of Object.entries(data)) {
        if (Array.isArray(info?.models)) {
          for (const m of info.models) {
            const id = typeof m === "string" ? m : m?.id;
            if (id) models.add(`${provider}/${id}`);
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 2. Read models from ~/.pi/agent/settings.json
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    if (existsSync(settingsPath)) {
      const data = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
        string,
        unknown
      >;
      const provs = data.providers as
        | Record<string, { models?: Array<string | { id?: string }> }>
        | undefined;
      if (provs && typeof provs === "object") {
        for (const [provider, info] of Object.entries(provs)) {
          if (Array.isArray(info?.models)) {
            for (const m of info.models) {
              const id = typeof m === "string" ? m : m?.id;
              if (id) models.add(`${provider}/${id}`);
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Inspect ctx.modelRegistry
  try {
    const registry = (
      ctx as {
        modelRegistry?: {
          getModels?: () => Array<{ provider?: string; id?: string }>;
        };
      }
    )?.modelRegistry;
    if (registry?.getModels) {
      for (const m of registry.getModels()) {
        if (m.provider && m.id) {
          models.add(`${m.provider}/${m.id}`);
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return Array.from(models);
}
