import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ADRRecord } from "./types.js";

const translationCache = new Map<string, ADRRecord>();

interface OpenRouterAuth {
  apiKey?: string;
  model?: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface ParsedTranslation {
  title?: string;
  context?: string;
  decision?: string;
  consequences?: string;
}

interface ModelRegistryLike {
  find?: (provider: string, modelId: string) => unknown;
  getApiKeyAndHeaders?: (
    model: unknown,
  ) => Promise<{ ok: boolean; apiKey?: string }>;
}

/**
 * Finds an OpenRouter API key from session context, env, or Pi stores.
 */
export async function getOpenRouterAuth(
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<OpenRouterAuth> {
  // 1. Check environment variable
  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: "google/gemini-2.5-flash",
    };
  }

  // 2. Check ctx.modelRegistry for openrouter provider
  try {
    const registry = (ctx as { modelRegistry?: ModelRegistryLike })
      .modelRegistry;
    if (registry) {
      const candidates = [
        "google/gemini-2.5-flash",
        "google/gemini-3.1-flash-lite",
        "meta-llama/llama-3.3-70b-instruct",
        "anthropic/claude-3.5-haiku",
      ];
      for (const cand of candidates) {
        const found = registry.find?.("openrouter", cand);
        if (found) {
          const auth = await registry.getApiKeyAndHeaders?.(found);
          if (auth?.ok && auth.apiKey) {
            return { apiKey: auth.apiKey, model: cand };
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Check ~/.pi/agent/models-store.json or settings.json
  try {
    const modelsStorePath = join(
      homedir(),
      ".pi",
      "agent",
      "models-store.json",
    );
    const raw = readFileSync(modelsStorePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, { apiKey?: string }>;
    if (parsed.openrouter?.apiKey) {
      return {
        apiKey: parsed.openrouter.apiKey,
        model: "google/gemini-2.5-flash",
      };
    }
  } catch {
    // Non-fatal
  }

  // 4. Check ~/.pi/agent/settings.json
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, { apiKey?: string }>;
    if (parsed.openrouter?.apiKey) {
      return {
        apiKey: parsed.openrouter.apiKey,
        model: "google/gemini-2.5-flash",
      };
    }
  } catch {
    // Non-fatal
  }

  return {};
}

/**
 * Strict literal translation system prompt.
 * Zero room for enhancement, summaries, or conversational filler.
 */
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

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

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
 * Performs a literal translation of an ADR record into Czech via OpenRouter or active model.
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

  const { apiKey, model = "google/gemini-2.5-flash" } =
    await getOpenRouterAuth(ctx);

  const payload = {
    title: record.title,
    context: record.context,
    decision: record.decision,
    consequences: record.consequences,
  };

  const userPrompt = JSON.stringify(payload, null, 2);

  // If OpenRouter key is available, call OpenRouter directly
  if (apiKey) {
    try {
      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/mastnacek/pi-solodev-adr",
          "X-Title": "pi-solo-radar ADR Reader",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: LITERAL_TRANSLATION_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as OpenRouterResponse;
        const textContent = data.choices?.[0]?.message?.content?.trim();
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
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback: return original if translation service is unavailable
  return record;
}
