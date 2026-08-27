import type { ADRDraft, ADRIndex, DetectionResult } from "./types.js";

interface ContextMessage {
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
  toolCalls?: Array<{ name: string; input?: unknown }>;
  toolResults?: Array<{
    content?: string | Array<{ type: string; text?: string }>;
  }>;
}

const TRIGGER_PATTERNS = [
  /\bworkaround\b/i,
  /\barchitectur(e|al)\b/i,
  /\brefactor(ed|ing)?\b/i,
  /\bpivot(ed)?\b/i,
  /\boverride\b/i,
  /\bfix\(legacy\)/i,
  /\blegacy pitfall\b/i,
  /\bbreaking change\b/i,
  /\btrade-off\b/i,
  /\badr candidate\b/i,
  /\bconstraint\b/i,
];

const IGNORE_PATTERNS = [
  /^\/adr\b/i,
  /\bpi-solo-radar\b/i,
  /\b\.pi\/decisions\b/i,
  /\bdocs\/adr\b/i,
  /\bdocs\/decisions\b/i,
  /\brunning tests\b/i,
  /\bminor typo\b/i,
  /\bwarning:\s*in the working copy\b/i,
  /\bLF will be replaced by CRLF\b/i,
  /\b\[main\s+[0-9a-f]+\]/i,
  /\bcommit\s+[0-9a-f]+\b/i,
  /\bTo https:\/\/github\.com\b/i,
  /\bAuto-fixed \d+ issue\(s\)\b/i,
  /\bpi-lens applied autofix\b/i,
  /\bauthoritative for subsequent edits\b/i,
];

function isString(value: string | object | null | undefined): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

/**
 * Normalizes message content into a plain string.
 */
export function extractTextFromMessage(message: ContextMessage): string {
  if (!message.content) return "";
  if (isString(message.content)) {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .flatMap((c) => (c && isString(c.text) ? [c.text] : []))
      .join("\n");
  }
  return "";
}

/**
 * Checks if the text contains architectural triggers.
 */
export function findMatchedKeywords(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of TRIGGER_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      matches.push(match[0].toLowerCase());
    }
  }
  return Array.from(new Set(matches));
}

/**
 * Extracts a concise draft title from sentences mentioning decisions or workarounds.
 */
export function extractCandidateTitle(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Look for explicit markers like "Decision:", "Refactored:", "Workaround:"
  for (const line of lines) {
    const explicitMatch = line.match(
      /^(?:Decision|Workaround|Refactor|Fix|Solution):\s*(.+)$/i,
    );
    if (explicitMatch && explicitMatch[1].length > 5) {
      return explicitMatch[1].replace(/[#*`]/g, "").trim().slice(0, 70);
    }
  }

  // Look for strong action phrases in lines
  for (const line of lines) {
    if (
      TRIGGER_PATTERNS.some((p) => p.test(line)) &&
      !IGNORE_PATTERNS.some((p) => p.test(line)) &&
      line.length > 15 &&
      line.length < 120
    ) {
      return line
        .replace(/^[#-*\s]+/, "")
        .replace(/[`*]/g, "")
        .trim()
        .slice(0, 70);
    }
  }

  return "Architectural Workaround & Constraint";
}

/**
 * Extracts Context, Decision, and Consequences from recent text content.
 */
export function extractDraftFromText(text: string): ADRDraft | null {
  const matched = findMatchedKeywords(text);
  if (matched.length === 0) {
    return null;
  }

  // Skip if it's purely an adr command interaction
  if (
    IGNORE_PATTERNS.some((p) => p.test(text)) &&
    matched.length === 1 &&
    matched[0] === "architectural"
  ) {
    return null;
  }

  const title = extractCandidateTitle(text);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  let context = "";
  let decision = "";
  let consequences = "";

  // 1. Explicit Section Parsing (if LLM or user output structured bullets)
  const contextMatch = text.match(
    /(?:Context|Problem|Why|Limitation):\s*([^\n]+)/i,
  );
  const decisionMatch = text.match(
    /(?:Decision|Approach|Solution|Workaround):\s*([^\n]+)/i,
  );
  const consequenceMatch = text.match(
    /(?:Consequences|Trade-off|Notes|Tradeoffs):\s*([^\n]+)/i,
  );

  if (contextMatch) context = contextMatch[1].replace(/[*`]/g, "").trim();
  if (decisionMatch) decision = decisionMatch[1].replace(/[*`]/g, "").trim();
  if (consequenceMatch)
    consequences = consequenceMatch[1].replace(/[*`]/g, "").trim();

  // 2. Heuristic sentence classification fallback
  if (!context || !decision || !consequences) {
    for (const s of sentences) {
      const clean = s
        .replace(/^[#*-\s]+/, "")
        .replace(/[`*]/g, "")
        .trim();

      if (
        !context &&
        /\b(because|due to|limitation|fails|error|issue|problem|incompatible|legacy)\b/i.test(
          clean,
        )
      ) {
        context = clean;
      } else if (
        !decision &&
        /\b(switch(ed)?|use|using|implement(ed)?|replac(ed|ing)|workaround|wrap(ped)?|adopt(ed)?)\b/i.test(
          clean,
        )
      ) {
        decision = clean;
      } else if (
        !consequences &&
        /\b(trade-off|consequence|overhead|ensure|constraint|note that|requires|avoids|risk)\b/i.test(
          clean,
        )
      ) {
        consequences = clean;
      }
    }
  }

  // Ensure non-empty fallbacks
  if (!context) {
    context = `Identified technical constraint requiring architectural resolution: ${matched.join(", ")}.`;
  }
  if (!decision) {
    decision = title;
  }
  if (!consequences) {
    consequences =
      "Maintain this implementation to prevent regressions across environments.";
  }

  return {
    title,
    context: context.slice(0, 200),
    decision: decision.slice(0, 200),
    consequences: consequences.slice(0, 200),
    status: "active",
  };
}

/**
 * Detects whether recent conversation messages contain an unrecorded architectural decision.
 */
export function detectArchitecturalChange(
  recentMessages: ContextMessage[],
  index: ADRIndex,
): DetectionResult {
  if (!recentMessages || recentMessages.length === 0) {
    return { detected: false };
  }

  // Combine text from recent turns (last 4 messages)
  const slice = recentMessages.slice(-4);
  const combinedText = slice.map(extractTextFromMessage).join("\n\n");

  if (!combinedText || combinedText.length < 30) {
    return { detected: false };
  }

  const matched = findMatchedKeywords(combinedText);
  if (matched.length === 0) {
    return { detected: false };
  }

  const draft = extractDraftFromText(combinedText);
  if (!draft) {
    return { detected: false };
  }

  // Check for duplicate in existing index
  const normalizedTitle = draft.title.toLowerCase().replace(/[^\w]/g, "");
  const isDuplicate = index.records.some((r) => {
    const existingNorm = r.title.toLowerCase().replace(/[^\w]/g, "");
    return (
      existingNorm === normalizedTitle ||
      existingNorm.includes(normalizedTitle) ||
      normalizedTitle.includes(existingNorm)
    );
  });

  if (isDuplicate) {
    return {
      detected: false,
      reason: "ADR with matching title already recorded in index.",
    };
  }

  return {
    detected: true,
    reason: `Detected architectural trigger keywords: ${matched.join(", ")}`,
    draft,
    matchedKeywords: matched,
  };
}
