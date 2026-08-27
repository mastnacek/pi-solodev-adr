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
import type {
  ADRDraft,
  ADRIndex,
  ADRIndexEntry,
  ADRRecord,
  ADRStatus,
  SearchMatch,
} from "./types.js";

export const DEFAULT_ADR_DIR = join("docs", "adr");
export const CANDIDATE_ADR_DIRS = [
  join("docs", "adr"),
  join("docs", "decisions"),
  join(".pi", "decisions"),
];
export const PROJECT_ROOT_MARKERS = [
  ".git",
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  join("docs", "adr"),
  join("docs", "decisions"),
  join(".pi", "decisions"),
];
const INDEX_FILENAME = ".index.json";

/**
 * Scans upward from a target file or subfolder to find the nearest project root boundary.
 * Stops if it reaches fallbackCwd or the filesystem root.
 */
export function findProjectRoot(
  targetPath: string,
  fallbackCwd: string = process.cwd(),
): string {
  try {
    let current = isAbsolute(targetPath)
      ? targetPath
      : resolve(fallbackCwd, targetPath);
    if (existsSync(current)) {
      try {
        const stat = statSync(current);
        if (!stat.isDirectory()) {
          current = dirname(current);
        }
      } catch {
        current = dirname(current);
      }
    } else {
      current = dirname(current);
    }

    current = resolve(current);
    const normalizedFallback = resolve(fallbackCwd);

    while (current.length >= normalizedFallback.length) {
      for (const marker of PROJECT_ROOT_MARKERS) {
        if (existsSync(join(current, marker))) {
          return current;
        }
      }

      if (current === normalizedFallback) {
        break;
      }

      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  } catch {
    // Non-fatal
  }
  return fallbackCwd;
}

/**
 * Resolves the effective target root for ADR storage based on configuration and modified files.
 */
export function resolveTargetRoot(
  cwd: string,
  touchedFiles?: string[],
  subprojectRouting = true,
): string {
  if (!subprojectRouting || !touchedFiles || touchedFiles.length === 0) {
    return cwd;
  }

  const rootCounts = new Map<string, number>();
  for (const file of touchedFiles) {
    const fullPath = isAbsolute(file) ? file : join(cwd, file);
    const detectedRoot = findProjectRoot(fullPath, cwd);
    rootCounts.set(detectedRoot, (rootCounts.get(detectedRoot) ?? 0) + 1);
  }

  let bestRoot = cwd;
  let maxCount = 0;
  for (const [root, count] of rootCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestRoot = root;
    }
  }

  return bestRoot;
}

/**
 * Returns path to the ADR directory for a given workspace.
 * Resolves to existing directories (docs/adr, docs/decisions, .pi/decisions)
 * or defaults to the industry-standard `docs/adr`.
 */
export function getDecisionsDir(cwd: string, dirOverride?: string): string {
  if (dirOverride) {
    return join(cwd, dirOverride);
  }
  for (const candidate of CANDIDATE_ADR_DIRS) {
    const full = join(cwd, candidate);
    if (existsSync(full)) {
      return full;
    }
  }
  return join(cwd, DEFAULT_ADR_DIR);
}

/**
 * Returns path to the .index.json file in the ADR directory.
 */
export function getIndexPath(cwd: string, dirOverride?: string): string {
  return join(getDecisionsDir(cwd, dirOverride), INDEX_FILENAME);
}

/**
 * Ensures that the ADR directory exists.
 */
export async function ensureDecisionsDir(
  cwd: string,
  dirOverride?: string,
): Promise<string> {
  const dir = getDecisionsDir(cwd, dirOverride);
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
  dirOverride?: string,
): Promise<ADRIndex> {
  const dir = await ensureDecisionsDir(cwd, dirOverride);
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

  const indexPath = getIndexPath(cwd, dirOverride);
  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2) + "\n");
  return index;
}

/**
 * Loads the index. If missing or invalid, rebuilds it.
 */
export async function loadIndex(
  cwd: string,
  dirOverride?: string,
): Promise<ADRIndex> {
  const indexPath = getIndexPath(cwd, dirOverride);
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as ADRIndex;
    if (parsed && Array.isArray(parsed.records)) {
      return parsed;
    }
  } catch {
    // Missing or invalid, rebuild
  }
  return rebuildIndex(cwd, dirOverride);
}

/**
 * Saves a new ADR record to disk and updates the index atomically.
 */
export async function saveRecord(
  cwd: string,
  draft: ADRDraft,
  dirOverride?: string,
): Promise<ADRRecord> {
  const dir = await ensureDecisionsDir(cwd, dirOverride);
  const index = await loadIndex(cwd, dirOverride);

  const id = getNextId(index.records);
  const date = formatDate(draft.date);
  const status: ADRStatus = draft.status || "active";
  const slug = slugify(draft.title) || "decision";
  const datePrefix = date.split(" ")[0].split("T")[0];
  const fileName = `${datePrefix}-${id}-${slug}.md`;
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

  const indexPath = getIndexPath(cwd, dirOverride);
  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2) + "\n");

  return { ...record, rawContent: markdown };
}

/**
 * Reads a single ADR record by ID or filename.
 */
export async function readRecord(
  cwd: string,
  idOrFile: string,
  dirOverride?: string,
): Promise<ADRRecord | null> {
  const dir = getDecisionsDir(cwd, dirOverride);
  const index = await loadIndex(cwd, dirOverride);

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
  dirOverride?: string,
): Promise<SearchMatch[]> {
  const index = await loadIndex(cwd, dirOverride);
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
