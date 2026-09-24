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

import { slugify, formatDate, formatADRMarkdown, parseADRMarkdown, synthesizeConstraintSummary } from "./markdown.js";
import { DEFAULT_ADR_DIR, CANDIDATE_ADR_DIRS, PROJECT_ROOT_MARKERS, INDEX_FILENAME, findProjectRoot, resolveTargetRoot, getDecisionsDir, getIndexPath, ensureDecisionsDir } from "./locations.js";

// Re-exported so existing consumers can keep importing from this module.
// Re-exported so existing consumers can keep importing from this module.
export * from "./markdown.js";
export * from "./locations.js";

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
