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

export interface TranslationResult {
  ok: boolean;
  record: ADRRecord;
  error?: string;
}

interface ModelRegistryLike {
  find?: (provider: string, modelId: string) => Model<Api> | undefined;
  getModels?: () => Array<Model<Api>>;
  getApiKeyAndHeaders?: (model: Model<Api>) => Promise<{
    ok: boolean;
    apiKey?: string;
    headers?: Record<string, string>;
    baseUrl?: string;
    env?: Record<string, string>;
    error?: string;
  }>;
  complete?: (
    model: Model<Api>,
    context: Context,
    options?: {
      apiKey?: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
      signal?: AbortSignal;
      maxTokens?: number;
    },
  ) => Promise<AssistantMessage>;
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

function extractStringField(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    if (typeof obj[k] === "string" && (obj[k] as string).trim()) {
      return (obj[k] as string).trim();
    }
  }
  return undefined;
}

/**
 * Parses JSON translation payload with support for fenced blocks, substrings, and relaxed keys.
 */
export function parseTranslationPayload(
  rawText: string,
): ParsedTranslation | null {
  const tryParseObject = (str: string): ParsedTranslation | null => {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const title = extractStringField(obj, [
          "title",
          "Title",
          "nazev",
          "titulek",
        ]);
        const context = extractStringField(obj, [
          "context",
          "Context",
          "kontext",
          "duvod",
        ]);
        const decision = extractStringField(obj, [
          "decision",
          "Decision",
          "rozhodnuti",
          "reseni",
        ]);
        const consequences = extractStringField(obj, [
          "consequences",
          "Consequences",
          "dusledky",
          "dopady",
        ]);

        if (title && context && decision && consequences) {
          return { title, context, decision, consequences };
        }
      }
    } catch {
      // Ignore parse failure
    }
    return null;
  };

  const clean = rawText.trim();

  // 1. Direct parse
  const direct = tryParseObject(clean);
  if (direct) return direct;

  // 2. Fence matching: ```json ... ``` or ``` ... ```
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    const fromFence = tryParseObject(fenceMatch[1].trim());
    if (fromFence) return fromFence;
  }

  // 3. Outer balanced { ... }
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const sub = clean.slice(firstBrace, lastBrace + 1);
    const fromBrace = tryParseObject(sub);
    if (fromBrace) return fromBrace;
  }

  return null;
}

/**
 * Fallback parser for when the model outputs MADR Markdown lines instead of JSON.
 */
export function parseTranslationFromMarkdown(
  text: string,
  original: ADRRecord,
): ADRRecord | null {
  const titleMatch =
    text.match(/^#\s*(?:ADR-\d+)?:\s*(.+)$/m) || text.match(/^#\s*(.+)$/m);
  const contextMatch = text.match(/-\s*\*\*(?:Context|Kontext):\*\*\s*(.+)$/im);
  const decisionMatch = text.match(
    /-\s*\*\*(?:Decision|Rozhodnutí|Rozhodnuti):\*\*\s*(.+)$/im,
  );
  const consequencesMatch = text.match(
    /-\s*\*\*(?:Consequences|Důsledky|Dusledky|Dopady):\*\*\s*(.+)$/im,
  );

  if (contextMatch || decisionMatch || consequencesMatch || titleMatch) {
    return {
      ...original,
      title: titleMatch
        ? (titleMatch[2] || titleMatch[1]).trim()
        : original.title,
      context: contextMatch ? contextMatch[1].trim() : original.context,
      decision: decisionMatch ? decisionMatch[1].trim() : original.decision,
      consequences: consequencesMatch
        ? consequencesMatch[1].trim()
        : original.consequences,
    };
  }
  return null;
}

/**
 * Resolves configured model dynamically through Pi's ModelRegistry and settings.
 * Completely provider-agnostic without hardcoded endpoints or candidate lists.
 */
export async function resolveModel(
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<Model<Api> | undefined> {
  const config = loadConfig();
  const rawSetting = (config.translateModel || "default").trim();
  const registry = (
    ctx as {
      modelRegistry?: {
        find?: (provider: string, modelId: string) => Model<Api> | undefined;
        getModels?: () => Array<Model<Api>>;
      };
    }
  )?.modelRegistry;

  // 1. "current" setting -> use active session model
  if (rawSetting.toLowerCase() === "current") {
    if ((ctx as { model?: Model<Api> })?.model) {
      return (ctx as { model?: Model<Api> }).model;
    }
  }

  // 2. "default" setting -> read from settings.json
  if (rawSetting.toLowerCase() === "default") {
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
  if (rawSetting.includes("/") && registry?.find) {
    const slash = rawSetting.indexOf("/");
    const provider = rawSetting.slice(0, slash);
    const modelId = rawSetting.slice(slash + 1);
    const found = registry.find(provider, modelId);
    if (found) return found;
  }

  // 4. Search dynamic models list from registry by model ID
  if (registry?.getModels) {
    const all = registry.getModels();
    const match = all.find(
      (m) => m.id === rawSetting || `${m.provider}/${m.id}` === rawSetting,
    );
    if (match) return match;
  }

  // 5. Fallback to active session model if available
  if ((ctx as { model?: Model<Api> })?.model) {
    return (ctx as { model?: Model<Api> }).model;
  }

  // 6. Final fallback: first available model in registry
  if (registry?.getModels) {
    const all = registry.getModels();
    if (all.length > 0 && all[0]) return all[0];
  }

  return undefined;
}

/**
 * Performs a literal translation of an ADR record into Czech via Pi's model execution.
 */
export async function translateRecordToCzech(
  record: ADRRecord,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<TranslationResult> {
  const cacheKey = `${record.id}:${record.date}:${record.title}`;
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return { ok: true, record: cached };
  }

  const model = await resolveModel(ctx);
  if (!model) {
    return {
      ok: false,
      record,
      error: "Model pro překlad nebyl nalezen v registrech",
    };
  }

  const registry = (ctx as { modelRegistry?: ModelRegistryLike })
    ?.modelRegistry;
  const auth = await registry?.getApiKeyAndHeaders?.(model);
  if (!auth?.ok) {
    return {
      ok: false,
      record,
      error: auth?.error || `Chybí API klíč pro provider ${model.provider}`,
    };
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
    const registry = (ctx as { modelRegistry?: ModelRegistryLike })
      ?.modelRegistry;
    let response: AssistantMessage;

    const requestOptions = {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      maxTokens: 4096,
      signal: (ctx as { signal?: AbortSignal })?.signal,
    };

    if (registry && typeof registry.complete === "function") {
      response = await registry.complete(model, llmContext, requestOptions);
    } else {
      const effectiveModel: Model<Api> = auth.baseUrl
        ? { ...model, baseUrl: auth.baseUrl }
        : model;
      response = await completeSimple(
        effectiveModel,
        llmContext,
        requestOptions,
      );
    }

    if (response.stopReason === "error") {
      return {
        ok: false,
        record,
        error: response.errorMessage || "Chyba při volání modelu",
      };
    }

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
        return { ok: true, record: translated };
      }

      // Try markdown fallback
      const mdFallback = parseTranslationFromMarkdown(textContent, record);
      if (mdFallback) {
        translationCache.set(cacheKey, mdFallback);
        return { ok: true, record: mdFallback };
      }
    }

    return {
      ok: false,
      record,
      error: "Model nevrátil platnou strukturu překladu",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      record,
      error: message,
    };
  }
}
