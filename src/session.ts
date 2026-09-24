// Lifecycle hooks: index warm-up, doctrine injection and draft capture.
import { relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { detectArchitecturalChange } from "./detector.js";
import { injectDoctrineIntoSystemPrompt } from "./injector.js";
import { ensureDecisionsDir, resolveTargetRoot, saveRecord } from "./ledger.js";
import { getConfigDir, getOrLoadIndex, invalidateCache, updateStatusBar } from "./state.js";
import type { ADRDraft } from "./types.js";

export async function handleSessionStart(ctx: ExtensionContext): Promise<void> {
  try {
    const configDir = getConfigDir();
    await ensureDecisionsDir(ctx.cwd, configDir);
    invalidateCache();
    await updateStatusBar(ctx);
  } catch {
    // Non-blocking initialization failure
  }
}

export async function handleBeforeAgentStart(
  systemPrompt: string,
  cwd: string,
): Promise<{ systemPrompt: string }> {
  try {
    const configDir = getConfigDir();
    const index = await getOrLoadIndex(cwd, configDir);
    const updatedPrompt = injectDoctrineIntoSystemPrompt(systemPrompt, index);
    return { systemPrompt: updatedPrompt };
  } catch {
    return { systemPrompt };
  }
}

export function extractTouchedFiles(branch: readonly unknown[]): string[] {
  const files: string[] = [];
  for (const entry of branch) {
    if (entry && typeof entry === "object") {
      const rec = entry as Record<string, unknown>;
      if (
        rec.type === "tool_call" ||
        rec.type === "tool_execution_start" ||
        rec.type === "tool_execution_end"
      ) {
        const payload = (rec.args || rec.input) as
          | Record<string, unknown>
          | undefined;
        if (typeof payload?.path === "string") files.push(payload.path);
        if (typeof payload?.file === "string") files.push(payload.file);
        if (Array.isArray(payload?.paths)) {
          for (const p of payload.paths) {
            if (typeof p === "string") files.push(p);
          }
        }
      }
    }
  }
  return Array.from(new Set(files));
}

export async function promptAndSaveDraft(
  ctx: ExtensionContext,
  draft: ADRDraft,
  targetRoot = ctx.cwd,
): Promise<void> {
  const configDir = getConfigDir();
  const relPath = relative(ctx.cwd, targetRoot).replace(/\\/g, "/") || ".";
  const displayLocation =
    relPath === "." ? "docs/adr/" : `${relPath}/docs/adr/`;

  const preview = [
    `Target: ${displayLocation}`,
    `Title: ${draft.title}`,
    `Context: ${draft.context}`,
    `Decision: ${draft.decision}`,
    `Consequences: ${draft.consequences}`,
  ].join("\n");

  const choices = [
    `Record decision in ${displayLocation}`,
    "Edit before recording",
    "Dismiss",
  ];

  const choice = await ctx.ui.select(
    `[ADR Radar] Architectural decision detected:\n${preview}`,
    choices,
  );

  if (choice === choices[0]) {
    const saved = await saveRecord(targetRoot, draft, configDir);
    invalidateCache();
    ctx.ui.notify(`Recorded ${saved.id}: ${saved.title}`, "info");
    await updateStatusBar(ctx);
  } else if (choice === choices[1]) {
    const title = (await ctx.ui.input("ADR Title:", draft.title))?.trim();
    if (!title) return;

    const context =
      (await ctx.ui.input("Context (Why?):", draft.context))?.trim() ||
      draft.context;
    const decision =
      (await ctx.ui.input("Decision (What?):", draft.decision))?.trim() ||
      draft.decision;
    const consequences =
      (
        await ctx.ui.input("Consequences (Trade-offs?):", draft.consequences)
      )?.trim() || draft.consequences;

    const editedDraft: ADRDraft = {
      title,
      context,
      decision,
      consequences,
      status: "active",
    };

    const saved = await saveRecord(targetRoot, editedDraft, configDir);
    invalidateCache();
    ctx.ui.notify(`Recorded ${saved.id}: ${saved.title}`, "info");
    await updateStatusBar(ctx);
  }
}

export async function handleAgentSettled(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;

  try {
    const config = loadConfig();
    const branch = ctx.sessionManager.getBranch();
    const touchedFiles = extractTouchedFiles(branch);
    const targetRoot = resolveTargetRoot(
      ctx.cwd,
      touchedFiles,
      config.subprojectRouting,
    );

    const configDir = getConfigDir();
    const index = await getOrLoadIndex(targetRoot, configDir);

    const messages = branch
      .map((entry) => (entry.type === "message" ? entry.message : null))
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const detection = detectArchitecturalChange(messages, index);
    if (!detection.detected || !detection.draft) {
      return;
    }

    await promptAndSaveDraft(ctx, detection.draft, targetRoot);
  } catch {
    // Non-blocking detection failure
  }
}
