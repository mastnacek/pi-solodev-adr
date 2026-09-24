// LLM tools: record_adr and search_adrs.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatADRMarkdown, saveRecord, searchRecords } from "./ledger.js";
import { getConfigDir, invalidateCache, updateStatusBar } from "./state.js";
import type { ADRDraft, ADRStatus } from "./types.js";

export async function executeRecordAdr(
  params: {
    title: string;
    context: string;
    decision: string;
    consequences: string;
    status?: string;
  },
  ctx: ExtensionContext,
) {
  const configDir = getConfigDir();
  const draft: ADRDraft = {
    title: params.title,
    context: params.context,
    decision: params.decision,
    consequences: params.consequences,
    status: (params.status as ADRStatus) || "active",
  };

  const saved = await saveRecord(ctx.cwd, draft, configDir);
  invalidateCache();

  if (ctx.hasUI) {
    await updateStatusBar(ctx);
    ctx.ui.notify(`[ADR] Recorded ${saved.id}: ${saved.title}`, "info");
  }

  const markdown = formatADRMarkdown(saved);
  return {
    content: [
      {
        type: "text" as const,
        text: `Successfully recorded ${saved.id} (${saved.file}):\n\n${markdown}`,
      },
    ],
    details: { record: saved },
  };
}

export async function executeSearchAdrs(
  params: { query: string },
  ctx: ExtensionContext,
) {
  const configDir = getConfigDir();
  const matches = await searchRecords(ctx.cwd, params.query, configDir);

  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No ADR records found matching "${params.query}".`,
        },
      ],
      details: { matches: [] },
    };
  }

  const lines = [`Found ${matches.length} matching ADR record(s):`];
  for (const m of matches) {
    lines.push(`- [${m.id}] (${m.date}) [${m.status}]: ${m.title}`);
    lines.push(`  Constraint: ${m.constraint}`);
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { matches },
  };
}

export function registerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "record_adr",
    label: "Record ADR",
    description:
      "Record a new Architectural Decision Record (ADR) in docs/adr/ and update the index.",
    promptSnippet:
      "Record an architectural decision or legacy workaround in docs/adr/",
    promptGuidelines: [
      "Use record_adr when the user asks to record, create, or save an architectural decision record (ADR), or after establishing a significant architectural workaround or pattern.",
    ],
    parameters: Type.Object({
      title: Type.String({
        description: "Clear, concise title of the architectural decision",
      }),
      context: Type.String({
        description:
          "Why was this change needed? What limitation or bug triggered it?",
      }),
      decision: Type.String({
        description: "What specific approach, workaround, or pivot was chosen?",
      }),
      consequences: Type.String({
        description:
          "What are the trade-offs, constraints, or follow-ups to remember?",
      }),
      status: Type.Optional(
        Type.String({
          description:
            "'active', 'superseded', or 'deprecated' (default: 'active')",
        }),
      ),
    }),
    execute: async (...args) => executeRecordAdr(args[1], args[4]),
  });

  pi.registerTool({
    name: "search_adrs",
    label: "Search ADRs",
    description:
      "Search historical Architectural Decision Records (ADRs) in docs/adr/ by keyword.",
    promptSnippet:
      "Search recorded architectural decisions and constraints in docs/adr/",
    promptGuidelines: [
      "Use search_adrs when looking up existing architectural constraints or historical decisions in this project.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search keyword or topic (e.g. 'IPC', '32-bit', 'PhotoPicker')",
      }),
    }),
    execute: async (...args) => executeSearchAdrs(args[1], args[4]),
  });
}
