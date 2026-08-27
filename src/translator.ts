import type {
  Api,
  AssistantMessage,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import type { ADRRecord } from "./types.js";

const translationCache = new Map<string, ADRRecord>();

export interface ParsedTranslation {
  title?: string;
  context?: string;
  decision?: string;
  consequences?: string;
}

interface ModelRegistryLike {
  find?: (provider: string, modelId: string) => Model<Api> | undefined;
  getApiKeyAndHeaders?: (
    model: Model<Api>,
  ) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string>; error?: string }>;
}

export const LITERAL_TRANSLATION_SYSTEM_PROMPT = `You are a strict, faithful, literal translator.
Translate the provided Architecture Decision Record (ADR) fields from English into Czech (Čeština).

STRICT RULES:
1. Translate LITERALLY and FAITHFULLY. Do not improve, embellish, explain, summarize, or rephrase the text.
2. Keep technical terms, identifiers, code snippets (\`pi install ...\`, file names, APIs) EXACTLY intact.
3. Return ONLY a valid JSON object without any Markdown formatting or code fences:
{
  "title": "<literal Czech translation of title>",
  "context": "<literal Czech translation of context>",
  "decision": "<literal Czech translation of decision>",
  "consequences": "<literal Czech translation of consequences>"
}`;

/**
 * Parses and validates JSON translation payload.
 */
export function parseTranslationPayload(
  rawText: string,
): ParsedTranslation | null {
  try {
    const cleanJson = rawText
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleanJson) as ParsedTranslation;
    if (
      parsed &&
      typeof parsed.title === "string" &&
      typeof parsed.context === "string" &&
      typeof parsed.decision === "string" &&
      typeof parsed.consequences === "string"
    ) {
      return parsed;
    }
  } catch {
    // Parsing error
  }
  return null;
}

/**
 * Resolves configured model from registry, settings, or current session.
 */
export async function resolveModel(
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<Model<Api> | undefined> {
  const config = loadConfig();
  const rawSetting = (config.translateModel || "default").trim();
  const registry = (ctx as { modelRegistry?: ModelRegistryLike })?.modelRegistry;

  // 1. "current" setting -> use active session model
  if (rawSetting === "current") {
    return (ctx as { model?: Model<Api> })?.model;
  }

  // 2. "default" setting -> read from settings.json
  if (rawSetting === "default") {
    try {
      const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
          defaultProvider?: string;
          defaultModel?: string;
        };
        const prov = settings.defaultProvider;
        const mod = settings.defaultModel;
        if (prov && mod && registry?.find) {
          const found = registry.find(prov, mod);
          if (found) return found;
        }
      }
    } catch {
      // Fall through
    }
  }

  // 3. Specific "<provider>/<modelId>" setting (e.g. "google/gemini-3.7-flash")
  if (rawSetting.includes("/")) {
    const slash = rawSetting.indexOf("/");
    const provider = rawSetting.slice(0, slash);
    const modelId = rawSetting.slice(slash + 1);
    if (registry?.find) {
      const found = registry.find(provider, modelId);
      if (found) return found;
    }
  } else if (registry?.find) {
    // Model ID only without provider prefix (e.g. "gemini-3.7-flash")
    for (const prov of ["google", "openrouter", "openai", "anthropic", "moonshotai"]) {
      const found = registry.find(prov, rawSetting);
      if (found) return found;
    }
  }

  // 4. Fallback to active session model if available
  if ((ctx as { model?: Model<Api> })?.model) {
    return (ctx as { model?: Model<Api> }).model;
  }

  // 5. Fallback: try finding standard translation candidates
  const fallbacks = [
    { provider: "google", id: "gemini-3.7-flash" },
    { provider: "google", id: "gemini-2.5-flash" },
    { provider: "openrouter", id: "google/gemini-2.5-flash" },
  ];
  for (const fb of fallbacks) {
    const found = registry?.find?.(fb.provider, fb.id);
    if (found) return found;
  }

  return undefined;
}

/**
 * Performs a literal translation of an ADR record into Czech via Pi's model execution.
 */
export async function translateRecordToCzech(
  record: ADRRecord,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<ADRRecord> {
  const cacheKey = `${record.id}:${record.date}:${record.title}`;
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const model = await resolveModel(ctx);
  if (!model) {
    return record;
  }

  const registry = (ctx as { modelRegistry?: ModelRegistryLike })?.modelRegistry;
  const auth = await registry?.getApiKeyAndHeaders?.(model);
  if (!auth?.ok) {
    return record;
  }

  const payload = {
    title: record.title,
    context: record.context,
    decision: record.decision,
    consequences: record.consequences,
  };

  const userPrompt = JSON.stringify(payload, null, 2);
  const llmContext: Context = {
    systemPrompt: LITERAL_TRANSLATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt } as never],
  };

  try {
    const response: AssistantMessage = await completeSimple(model, llmContext, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      maxTokens: 4096,
      signal: (ctx as { signal?: AbortSignal })?.signal,
    });

    const textContent = response.content
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("")
      .trim();

    if (textContent) {
      const parsed = parseTranslationPayload(textContent);
      if (
        parsed?.title &&
        parsed.context &&
        parsed.decision &&
        parsed.consequences
      ) {
        const translated: ADRRecord = {
          ...record,
          title: parsed.title.trim(),
          context: parsed.context.trim(),
          decision: parsed.decision.trim(),
          consequences: parsed.consequences.trim(),
        };
        translationCache.set(cacheKey, translated);
        return translated;
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return record;
}
