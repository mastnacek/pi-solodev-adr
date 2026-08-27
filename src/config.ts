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
  translateModel: "default",
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
 * Dynamic model discovery following native Pi ModelRegistry and settings.
 * Discovers available providers and models without hardcoded lists.
 */
export function getAvailableModels(
  ctx?: ExtensionContext | ExtensionCommandContext,
): string[] {
  const models = new Set<string>(["current", "default"]);

  // 1. Inspect runtime ModelRegistry (Pi's source of truth for active providers)
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

  // 2. Read models from ~/.pi/agent/models.json (custom providers)
  try {
    const customModelsPath = join(homedir(), ".pi", "agent", "models.json");
    if (existsSync(customModelsPath)) {
      const data = JSON.parse(readFileSync(customModelsPath, "utf8")) as {
        providers?: Record<string, { models?: Array<{ id?: string }> }>;
      };
      if (data.providers) {
        for (const [provider, info] of Object.entries(data.providers)) {
          if (Array.isArray(info?.models)) {
            for (const m of info.models) {
              if (m?.id) models.add(`${provider}/${m.id}`);
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Read models from ~/.pi/agent/models-store.json (cached remote catalogs)
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

  // 4. Read models from ~/.pi/agent/settings.json
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

  return Array.from(models);
}
