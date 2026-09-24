import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface PluginConfig {
  translateModel: string;
  subprojectRouting: boolean;
}

export const DEFAULT_CONFIG: PluginConfig = {
  translateModel: "default",
  subprojectRouting: true,
};

/** Canonical global layer: ~/.pi/agent/pi-solodev-adr.json. */
export const GLOBAL_CONFIG_FILE = join(
  homedir(),
  ".pi",
  "agent",
  "pi-solodev-adr.json",
);

/**
 * Legacy filename this plugin shipped with before the rename. Read as a
 * fallback so existing installs keep their settings; never written to.
 */
export const LEGACY_CONFIG_FILE = join(
  homedir(),
  ".pi",
  "agent",
  "pi-solo-radar.json",
);

/** Kept for callers that only need the global path. */
export const CONFIG_PATH = GLOBAL_CONFIG_FILE;

/** Project override: <cwd>/.pi/pi-solodev-adr.json (wins over the global file). */
export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "pi-solodev-adr.json");
}

/**
 * Session cwd the cascade hangs off. Set on session_start; without it only the
 * global layer applies.
 */
let activeCwd: string | undefined;

export function setConfigCwd(cwd?: string): void {
  activeCwd = cwd;
}

function readLayer(file: string): Partial<PluginConfig> {
  try {
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, "utf8")) as Partial<PluginConfig>;
    }
  } catch {
    // Corrupt layer — fall through to the next one.
  }
  return {};
}

/**
 * Effective config with the mandatory cascade:
 * defaults <- legacy <- ~/.pi/agent/pi-solodev-adr.json <- <cwd>/.pi/pi-solodev-adr.json.
 */
export function loadConfig(cwd: string | undefined = activeCwd): PluginConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...readLayer(LEGACY_CONFIG_FILE),
    ...readLayer(GLOBAL_CONFIG_FILE),
  };
  if (cwd) Object.assign(merged, readLayer(projectConfigPath(cwd)));
  return {
    ...merged,
    subprojectRouting:
      typeof merged.subprojectRouting === "boolean"
        ? merged.subprojectRouting
        : DEFAULT_CONFIG.subprojectRouting,
  };
}

/**
 * Merge a patch into the effective config. `--global` (isGlobal) writes
 * ~/.pi/agent/, otherwise <cwd>/.pi/; without a cwd the global file is used.
 * The write is atomic (temp file + rename) so a crash cannot truncate it.
 */
export function saveConfig(
  cfg: Partial<PluginConfig>,
  isGlobal = false,
  cwd: string | undefined = activeCwd,
): void {
  try {
    const updated: PluginConfig = { ...loadConfig(cwd), ...cfg };
    const target = isGlobal || !cwd ? GLOBAL_CONFIG_FILE : projectConfigPath(cwd);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    renameSync(tmp, target);
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
