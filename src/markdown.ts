// Extracted from ledger.ts to keep modules focused.
import { existsSync, statSync } from "node:fs";

import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";

import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
	ADRRecord,
	ADRStatus,
} from "./types.js";

/**
 * Generates URL/filename friendly slug from title.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Formats a date object or string into YYYY-MM-DD HH:mm:ss.
 */
export function formatDate(dateInput?: string | Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (dateInput instanceof Date) {
    const d = dateInput;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  if (typeof dateInput === "string" && dateInput.trim()) {
    const str = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}(:\d{2})?)?$/.test(str)) {
      return str;
    }
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
      const d = parsed;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return str;
  }
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Formats an ADR record into standard 5-line MADR markdown.
 */
export function formatADRMarkdown(record: {
  id: string;
  title: string;
  date: string;
  context: string;
  decision: string;
  consequences: string;
  status?: ADRStatus;
}): string {
  const status = record.status || "active";
  const lines = [
    `# ${record.id}: ${record.title.trim()}`,
    `- **Date:** ${record.date}`,
    `- **Status:** ${status}`,
    `- **Context:** ${record.context.trim()}`,
    `- **Decision:** ${record.decision.trim()}`,
    `- **Consequences:** ${record.consequences.trim()}`,
  ];
  return lines.join("\n") + "\n";
}

/**
 * Parses a 5-line MADR markdown string into an ADRRecord.
 */
export function parseADRMarkdown(
  content: string,
  fileName = "",
): ADRRecord | null {
  const titleMatch = content.match(/^#\s*(ADR-\d+):\s*(.+)$/m);
  if (!titleMatch) {
    // Try relaxed header `# [Title]`
    const altTitle = content.match(/^#\s*(.+)$/m);
    if (!altTitle) return null;
  }

  const id = titleMatch ? titleMatch[1].trim() : "ADR-000";
  const fallbackTitleMatch = content.match(/^#\s*(.+)$/m);
  let title = "Untitled Decision";
  if (titleMatch) {
    title = titleMatch[2].trim();
  } else if (fallbackTitleMatch) {
    title = fallbackTitleMatch[1].trim();
  }

  const dateMatch = content.match(/-\s*\*\*Date:\*\*\s*(.+)$/im);
  const statusMatch = content.match(/-\s*\*\*Status:\*\*\s*(.+)$/im);
  const contextMatch = content.match(/-\s*\*\*Context:\*\*\s*(.+)$/im);
  const decisionMatch = content.match(/-\s*\*\*Decision:\*\*\s*(.+)$/im);
  const consequencesMatch = content.match(
    /-\s*\*\*Consequences:\*\*\s*(.+)$/im,
  );

  const rawStatus = statusMatch
    ? statusMatch[1].trim().toLowerCase()
    : "active";
  const status: ADRStatus =
    rawStatus === "superseded" || rawStatus === "deprecated"
      ? rawStatus
      : "active";

  return {
    id,
    title,
    date: dateMatch ? dateMatch[1].trim() : formatDate(),
    status,
    context: contextMatch ? contextMatch[1].trim() : "",
    decision: decisionMatch ? decisionMatch[1].trim() : "",
    consequences: consequencesMatch ? consequencesMatch[1].trim() : "",
    file: fileName,
    rawContent: content,
  };
}

/**
 * Synthesizes a one-line constraint summary from title and decision.
 */
export function synthesizeConstraintSummary(
  title: string,
  decision: string,
): string {
  const cleanDecision = decision.replace(/\n+/g, " ").trim();
  return `${title}: ${cleanDecision}`;
}
