import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  ADRDraft,
  ADRIndex,
  ADRIndexEntry,
  ADRRecord,
  ADRStatus,
  SearchMatch,
} from "./types.js";

const DEFAULT_CONFIG_DIR = ".pi";
const DECISIONS_SUBDIR = "decisions";
const INDEX_FILENAME = ".index.json";

/**
 * Returns path to the .pi/decisions directory for a given workspace.
 */
export function getDecisionsDir(
  cwd: string,
  configDirName: string = DEFAULT_CONFIG_DIR,
): string {
  return join(cwd, configDirName, DECISIONS_SUBDIR);
}

/**
 * Returns path to the .pi/decisions/.index.json file.
 */
export function getIndexPath(
  cwd: string,
  configDirName: string = DEFAULT_CONFIG_DIR,
): string {
  return join(getDecisionsDir(cwd, configDirName), INDEX_FILENAME);
}

/**
 * Ensures that the .pi/decisions directory exists.
 */
export async function ensureDecisionsDir(
  cwd: string,
  configDirName: string = DEFAULT_CONFIG_DIR,
): Promise<string> {
  const dir = getDecisionsDir(cwd, configDirName);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Writes a file atomically using a temporary file and rename.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  try {
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, filePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore temporary file cleanup failure
    }
    throw err;
  }
}

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
 * Formats a date object or string into YYYY-MM-DD.
 */
export function formatDate(dateInput?: string | Date): string {
  if (dateInput instanceof Date) {
    return dateInput.toISOString().split("T")[0];
  }
  if (dateInput && /^\d{4}-\d{2}-\d{2}$/.test(String(dateInput))) {
    return String(dateInput);
  }
  return new Date().toISOString().split("T")[0];
}

/**
 * Computes next sequential ADR ID (e.g. ADR-001, ADR-002, ...).
 */
export function getNextId(records: Array<{ id: string }>): string {
  let maxNum = 0;
  for (const r of records) {
    const match = r.id.match(/^ADR-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  const nextNum = maxNum + 1;
  return `ADR-${nextNum.toString().padStart(3, "0")}`;
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

/**
 * Rebuilds index by reading all *.md files in .pi/decisions/.
 */
export async function rebuildIndex(
  cwd: string,
  configDirName: string = DEFAULT_CONFIG_DIR,
): Promise<ADRIndex> {
  const dir = await ensureDecisionsDir(cwd, configDirName);
  const entries: ADRIndexEntry[] = [];

  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (file.endsWith(".md") && !file.startsWith(".")) {
        const filePath = join(dir, file);
        try {
          const content = await readFile(filePath, "utf8");
          const parsed = parseADRMarkdown(content, file);
          if (parsed) {
            entries.push({
              id: parsed.id,
              title: parsed.title,
              date: parsed.date,
              file,
              constraint: synthesizeConstraintSummary(
                parsed.title,
                parsed.decision,
              ),
              status: parsed.status,
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory reading failed
  }

  // Sort by ADR ID numerically
  entries.sort((a, b) => {
    const numA = parseInt(a.id.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
    return numA - numB;
  });

  const index: ADRIndex = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    records: entries,
  };

  const indexPath = getIndexPath(cwd, configDirName);
  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2) + "\n");
  return index;
}

/**
 * Loads the index. If missing or invalid, rebuilds it.
 */
export async function loadIndex(
  cwd: string,
  configDirName: string = DEFAULT_CONFIG_DIR,
): Promise<ADRIndex> {
  const indexPath = getIndexPath(cwd, configDirName);
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as ADRIndex;
    if (parsed && Array.isArray(parsed.records)) {
      return parsed;
    }
  } catch {
    // Missing or invalid, rebuild
  }
  return rebuildIndex(cwd, configDirName);
}

/**
 * Saves a new ADR record to disk and updates the index atomically.
 */
export async function saveRecord(
  cwd: string,
  draft: ADRDraft,
  configDirName: string = DEFAULT_CONFIG_DIR,
): Promise<ADRRecord> {
  const dir = await ensureDecisionsDir(cwd, configDirName);
  const index = await loadIndex(cwd, configDirName);

  const id = getNextId(index.records);
  const date = formatDate(draft.date);
  const status: ADRStatus = draft.status || "active";
  const slug = slugify(draft.title) || "decision";
  const fileName = `${date}-${id}-${slug}.md`;
  const filePath = join(dir, fileName);

  const record: ADRRecord = {
    id,
    title: draft.title.trim(),
    date,
    status,
    context: draft.context.trim(),
    decision: draft.decision.trim(),
    consequences: draft.consequences.trim(),
    file: fileName,
  };

  const markdown = formatADRMarkdown(record);
  await atomicWriteFile(filePath, markdown);

  // Update index
  const indexEntry: ADRIndexEntry = {
    id: record.id,
    title: record.title,
    date: record.date,
    file: fileName,
    constraint: synthesizeConstraintSummary(record.title, record.decision),
    status: record.status,
  };

  index.records = index.records.filter((r) => r.id !== id);
  index.records.push(indexEntry);
  index.records.sort((a, b) => {
    const numA = parseInt(a.id.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
    return numA - numB;
  });
  index.lastUpdated = new Date().toISOString();

  const indexPath = getIndexPath(cwd, configDirName);
  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2) + "\n");

  return { ...record, rawContent: markdown };
}

/**
 * Reads a single ADR record by ID or filename.
 */
export async function readRecord(
  cwd: string,
  idOrFile: string,
  configDirName: string = DEFAULT_CONFIG_DIR,
): Promise<ADRRecord | null> {
  const dir = getDecisionsDir(cwd, configDirName);
  const index = await loadIndex(cwd, configDirName);

  // Normalize ID query (e.g. "1" -> "ADR-001", "adr-1" -> "ADR-001")
  let targetEntry: ADRIndexEntry | undefined;
  const normalizedQuery = idOrFile.trim().toLowerCase();

  for (const entry of index.records) {
    const entryIdLower = entry.id.toLowerCase();
    const entryNum = entry.id.replace(/\D/g, "");
    if (
      entryIdLower === normalizedQuery ||
      entryNum === normalizedQuery ||
      entry.file.toLowerCase() === normalizedQuery ||
      entry.file.toLowerCase().includes(normalizedQuery)
    ) {
      targetEntry = entry;
      break;
    }
  }

  const fileName = targetEntry ? targetEntry.file : idOrFile;
  const filePath = join(dir, fileName);

  try {
    const content = await readFile(filePath, "utf8");
    return parseADRMarkdown(content, basename(filePath));
  } catch {
    return null;
  }
}

/**
 * Searches ADR records using index and returns ranked matches.
 */
export async function searchRecords(
  cwd: string,
  query: string,
  configDirName: string = DEFAULT_CONFIG_DIR,
): Promise<SearchMatch[]> {
  const index = await loadIndex(cwd, configDirName);
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) {
    return index.records.map((r) => ({ ...r, score: 1 }));
  }

  const matches: SearchMatch[] = [];

  for (const entry of index.records) {
    const searchableText =
      `${entry.id} ${entry.title} ${entry.constraint} ${entry.status}`.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (entry.id.toLowerCase() === term) {
        score += 10;
      } else if (entry.title.toLowerCase().includes(term)) {
        score += 5;
      } else if (entry.constraint.toLowerCase().includes(term)) {
        score += 3;
      } else if (searchableText.includes(term)) {
        score += 1;
      }
    }

    if (score > 0) {
      matches.push({
        ...entry,
        score,
        snippet: entry.constraint,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}
