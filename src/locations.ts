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

export const INDEX_FILENAME = ".index.json";

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
