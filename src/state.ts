// Session-scoped index cache, config-dir resolution and the status bar.
import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadIndex } from "./ledger.js";
import type { ADRIndex } from "./types.js";
import { formatStatusLine } from "./viewer.js";

export let cachedIndex: ADRIndex | null = null;

export async function getOrLoadIndex(
  cwd: string,
  dirOverride?: string,
): Promise<ADRIndex> {
  if (cachedIndex) return cachedIndex;
  cachedIndex = await loadIndex(cwd, dirOverride);
  return cachedIndex;
}

export function invalidateCache(): void {
  cachedIndex = null;
}

export function getConfigDir(): string | undefined {
  return undefined;
}

export async function updateStatusBar(
  ctx: ExtensionContext | ExtensionCommandContext,
  dirOverride?: string,
): Promise<void> {
  if (!ctx.hasUI) return;
  try {
    const configDir = getConfigDir();
    const index = await getOrLoadIndex(ctx.cwd, dirOverride || configDir);
    const statusText = formatStatusLine(index);
    ctx.ui.setStatus("pi-solo-radar", statusText);
  } catch {
    // Non-blocking
  }
}
