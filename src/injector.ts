import type { ADRIndex } from "./types.js";

const DEFAULT_MAX_ENTRIES = 25;

/**
 * Synthesizes a compact, bounded context block containing active architectural constraints.
 */
export function synthesizeConstraints(
  index: ADRIndex,
  maxEntries = DEFAULT_MAX_ENTRIES,
): string {
  const activeRecords = index.records.filter((r) => r.status === "active");
  if (activeRecords.length === 0) {
    return "";
  }

  const visibleRecords = activeRecords.slice(0, maxEntries);
  const remainingCount = activeRecords.length - visibleRecords.length;

  const lines: string[] = [
    "## Architectural Doctrine (pi-solo-radar)",
    "Active constraints recorded in `docs/adr/` — adhere to these established decisions:",
  ];

  for (const record of visibleRecords) {
    lines.push(`- [${record.id}] ${record.constraint}`);
  }

  if (remainingCount > 0) {
    lines.push(
      `- *(${remainingCount} more active ADR records in \`docs/adr/\` — use \`/adr list\` or \`/adr search\` to inspect)*`,
    );
  }

  return lines.join("\n");
}

/**
 * Injects synthesized architectural doctrine into the system prompt.
 */
export function injectDoctrineIntoSystemPrompt(
  systemPrompt: string,
  index: ADRIndex,
  maxEntries = DEFAULT_MAX_ENTRIES,
): string {
  const constraintsBlock = synthesizeConstraints(index, maxEntries);
  if (!constraintsBlock) {
    return systemPrompt;
  }

  return `${systemPrompt.trim()}\n\n${constraintsBlock}\n`;
}
