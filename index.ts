import {
  CONFIG_DIR_NAME,
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { detectArchitecturalChange } from "./src/detector.js";
import { injectDoctrineIntoSystemPrompt } from "./src/injector.js";
import {
  ensureDecisionsDir,
  formatADRMarkdown,
  getDecisionsDir,
  getIndexPath,
  loadIndex,
  readRecord,
  saveRecord,
  searchRecords,
} from "./src/ledger.js";
import type { ADRDraft, ADRIndex, ADRRecord, ADRStatus } from "./src/types.js";
import {
  formatReadingMode,
  highlightADRMarkdown,
  renderDirectoryHeader,
  renderDirectoryTable,
  renderStatusBadge,
} from "./src/viewer.js";

const SUBCOMMANDS = [
  {
    value: "list",
    label: "list",
    description: "List all recorded ADR decisions and statuses",
  },
  {
    value: "new",
    label: "new <title>",
    description: "Interactively draft and save a new ADR",
  },
  {
    value: "show",
    label: "show <id> [--read|--raw]",
    description: "Display decision in clean Reading Mode or Syntax Highlighting",
  },
  {
    value: "search",
    label: "search <term>",
    description: "Keyword search across historical decisions",
  },
  {
    value: "status",
    label: "status",
    description: "Show radar tracking status and storage metrics",
  },
  {
    value: "help",
    label: "help",
    description: "Display command reference and MADR guidelines",
  },
];

let cachedIndex: ADRIndex | null = null;

async function getOrLoadIndex(
  cwd: string,
  configDir: string,
): Promise<ADRIndex> {
  if (cachedIndex) return cachedIndex;
  cachedIndex = await loadIndex(cwd, configDir);
  return cachedIndex;
}

function invalidateCache(): void {
  cachedIndex = null;
}

function getConfigDir(): string {
  return CONFIG_DIR_NAME || ".pi";
}

async function handleSessionStart(ctx: ExtensionContext): Promise<void> {
  try {
    const configDir = getConfigDir();
    await ensureDecisionsDir(ctx.cwd, configDir);
    invalidateCache();
    const index = await getOrLoadIndex(ctx.cwd, configDir);
    if (ctx.hasUI && index.records.length > 0) {
      const activeCount = index.records.filter(
        (r) => r.status === "active",
      ).length;
      ctx.ui.setStatus("pi-solo-radar", `ADRs: ${activeCount} active`);
    }
  } catch {
    // Non-blocking initialization failure
  }
}

async function handleBeforeAgentStart(
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

async function promptAndSaveDraft(
  ctx: ExtensionContext,
  draft: ADRDraft,
): Promise<void> {
  const configDir = getConfigDir();
  const index = await getOrLoadIndex(ctx.cwd, configDir);

  const preview = [
    `Title: ${draft.title}`,
    `Context: ${draft.context}`,
    `Decision: ${draft.decision}`,
    `Consequences: ${draft.consequences}`,
  ].join("\n");

  const choices = [
    "Record decision in .pi/decisions/",
    "Edit before recording",
    "Dismiss",
  ];

  const choice = await ctx.ui.select(
    `[ADR Radar] Architectural decision detected:\n${preview}`,
    choices,
  );

  if (choice === choices[0]) {
    const saved = await saveRecord(ctx.cwd, draft, configDir);
    invalidateCache();
    ctx.ui.notify(`Recorded ${saved.id}: ${saved.title}`, "info");
    ctx.ui.setStatus(
      "pi-solo-radar",
      `ADRs: ${index.records.length + 1} active`,
    );
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

    const saved = await saveRecord(ctx.cwd, editedDraft, configDir);
    invalidateCache();
    ctx.ui.notify(`Recorded ${saved.id}: ${saved.title}`, "info");
    ctx.ui.setStatus(
      "pi-solo-radar",
      `ADRs: ${index.records.length + 1} active`,
    );
  }
}

async function handleAgentSettled(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;

  try {
    const configDir = getConfigDir();
    const index = await getOrLoadIndex(ctx.cwd, configDir);

    const branch = ctx.sessionManager.getBranch();
    const messages = branch
      .map((entry) => (entry.type === "message" ? entry.message : null))
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const detection = detectArchitecturalChange(messages, index);
    if (!detection.detected || !detection.draft) {
      return;
    }

    await promptAndSaveDraft(ctx, detection.draft);
  } catch {
    // Non-blocking detection failure
  }
}

async function openReaderView(
  ctx: ExtensionCommandContext,
  record: ADRRecord,
  initialReadingMode = true,
): Promise<void> {
  if (!ctx.hasUI) {
    const text = initialReadingMode
      ? formatReadingMode(record)
      : highlightADRMarkdown(record);
    ctx.ui.notify(text, "info");
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    let readingMode = initialReadingMode;
    const container = new Container();

    const rebuild = () => {
      container.clear();
      // Top Border
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      // Title & Mode pill
      const modeBadge = readingMode
        ? theme.fg("success", "[● Reading Mode (Clean)]")
        : theme.fg("warning", "[⚡ Syntax Highlighting (Raw)]");
      const titleLine = `${theme.fg("accent", theme.bold(`${record.id}: ${record.title}`))}  ${modeBadge}`;
      container.addChild(new Text(titleLine, 1, 0));
      container.addChild(new Spacer(1));

      // Body text
      const content = readingMode
        ? formatReadingMode(record, theme)
        : highlightADRMarkdown(record, theme);
      container.addChild(new Text(content, 1, 0));

      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          theme.fg("dim", "m / r: toggle reading mode • esc: close"),
          1,
          0,
        ),
      );
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );
    };

    rebuild();

    return {
      render: (w) => container.render(w),
      invalidate: () => {
        rebuild();
        container.invalidate();
      },
      handleInput: (data) => {
        if (matchesKey(data, "m") || matchesKey(data, "r")) {
          readingMode = !readingMode;
          rebuild();
          tui.requestRender();
        } else if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
          done();
        }
      },
    };
  });
}

async function openDirectoryExplorer(
  ctx: ExtensionCommandContext,
): Promise<void> {
  const configDir = getConfigDir();
  const index = await getOrLoadIndex(ctx.cwd, configDir);
  const decisionsDir = getDecisionsDir(ctx.cwd, configDir);

  if (index.records.length === 0) {
    ctx.ui.notify(
      "No ADR records found in .pi/decisions/. Use `/adr new <title>` to create one.",
      "info",
    );
    return;
  }

  if (!ctx.hasUI) {
    ctx.ui.notify(renderDirectoryTable(index, decisionsDir), "info");
    return;
  }

  while (true) {
    const selectedId = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();

      // Top Border
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      // Header lines
      const headerLines = renderDirectoryHeader(index, decisionsDir, theme);
      for (const h of headerLines) {
        container.addChild(new Text(h, 1, 0));
      }
      container.addChild(new Spacer(1));

      // SelectList items
      const items: SelectItem[] = index.records.map((r) => {
        const badge = renderStatusBadge(r.status, theme);
        return {
          value: r.id,
          label: `${r.id}  ${badge}  ${r.title}`,
          description: r.date,
        };
      });

      const selectList = new SelectList(
        items,
        Math.min(items.length, 12),
        {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", theme.bold(t)),
          description: (t) => theme.fg("dim", t),
          scrollInfo: (t) => theme.fg("muted", t),
          noMatch: (t) => theme.fg("warning", t),
        },
      );

      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);

      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          theme.fg("dim", "↑↓: navigate • enter: read ADR • esc: exit"),
          1,
          0,
        ),
      );
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      return {
        render: (w) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data) => {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    });

    if (!selectedId) {
      break;
    }

    const record = await readRecord(ctx.cwd, selectedId, configDir);
    if (record) {
      await openReaderView(ctx, record, true);
    }
  }
}

async function handleList(ctx: ExtensionCommandContext): Promise<void> {
  await openDirectoryExplorer(ctx);
}

async function handleNew(
  remainder: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const configDir = getConfigDir();
  const defaultTitle = remainder || "New Architectural Decision";
  const title = (await ctx.ui.input("ADR Title:", defaultTitle))?.trim();
  if (!title) {
    ctx.ui.notify("ADR creation cancelled (empty title).", "warning");
    return;
  }

  const context =
    (
      await ctx.ui.input("Context (Why was this change needed?):", "")
    )?.trim() || "";
  const decision =
    (
      await ctx.ui.input("Decision (What specific approach was chosen?):", "")
    )?.trim() || "";
  const consequences =
    (
      await ctx.ui.input(
        "Consequences (What are trade-offs / follow-ups?):",
        "",
      )
    )?.trim() || "";

  const draft: ADRDraft = {
    title,
    context: context || "Documented architectural decision.",
    decision: decision || title,
    consequences: consequences || "Maintain decision to prevent regressions.",
    status: "active",
  };

  const saved = await saveRecord(ctx.cwd, draft, configDir);
  invalidateCache();
  ctx.ui.notify(
    `Created ${saved.id}: ${saved.title}\nSaved to ${saved.file}`,
    "info",
  );
}

async function handleShow(
  remainder: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const tokens = remainder.trim().split(/\s+/).filter(Boolean);
  const isRaw = tokens.some((t) => t.toLowerCase() === "--raw");
  const idQuery = tokens.filter((t) => !t.startsWith("--")).join(" ").trim();

  if (!idQuery) {
    ctx.ui.notify(
      "Usage: `/adr show <id> [--read | --raw]` (e.g. `/adr show ADR-001`)",
      "warning",
    );
    return;
  }

  const configDir = getConfigDir();
  const record: ADRRecord | null = await readRecord(
    ctx.cwd,
    idQuery,
    configDir,
  );
  if (!record) {
    ctx.ui.notify(`ADR not found: "${idQuery}"`, "error");
    return;
  }

  const readingMode = !isRaw;
  await openReaderView(ctx, record, readingMode);
}

async function handleSearch(
  remainder: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!remainder) {
    ctx.ui.notify("Usage: `/adr search <keyword>`", "warning");
    return;
  }

  const configDir = getConfigDir();
  const results = await searchRecords(ctx.cwd, remainder, configDir);
  if (results.length === 0) {
    ctx.ui.notify(`No ADR records matching "${remainder}".`, "info");
    return;
  }

  const lines = [
    `# ADR Search Results for "${remainder}" (${results.length} matches):`,
    "",
  ];
  for (const match of results) {
    const badge = renderStatusBadge(match.status);
    lines.push(
      `- **${match.id}** (${match.date}) [${badge}]: **${match.title}**`,
    );
    lines.push(`  *${match.constraint}*`);
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const configDir = getConfigDir();
  const index = await getOrLoadIndex(ctx.cwd, configDir);
  const decisionsDir = getDecisionsDir(ctx.cwd, configDir);
  const indexPath = getIndexPath(ctx.cwd, configDir);
  const activeCount = index.records.filter((r) => r.status === "active").length;

  const lines = [
    "# pi-solo-radar Status",
    `- **Directory:** ${decisionsDir}`,
    `- **Index File:** ${indexPath}`,
    `- **Total Records:** ${index.records.length}`,
    `- **Active Constraints:** ${activeCount}`,
    `- **Last Updated:** ${index.lastUpdated || "Never"}`,
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

function handleHelp(ctx: ExtensionCommandContext): void {
  const lines = [
    "# pi-solo-radar — Command Reference",
    "",
    "Autonomous Architectural Decision Record (ADR) Ledger for Solo Engineers.",
    "",
    "### Available Commands:",
    "- `/adr list` — Interactive TUI directory explorer / decision ledger.",
    "- `/adr new <title>` — Interactively draft and save a 5-line MADR.",
    "- `/adr show <id> [--read|--raw]` — Display decision in clean Reading Mode or Syntax Highlighting.",
    "- `/adr search <query>` — Keyword search across historical constraints.",
    "- `/adr status` — Show active ADR counts and storage metrics.",
    "- `/adr help` — Display this guide.",
    "",
    "### Reading Mode vs Syntax Highlighting:",
    "- In Reading Mode, markdown formatting markers (`#`, `**`, `` ` ``, bullets) are stripped for clean reading.",
    "- Press `m` or `r` while viewing an ADR in the TUI to toggle Reading Mode on/off.",
    "",
    "### 5-Line MADR Format:",
    "Stored under `.pi/decisions/YYYY-MM-DD-ADR-NNN-<slug>.md` with sections:",
    "`Context`, `Decision`, `Consequences`.",
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

async function getCompletions(
  prefix: string,
): Promise<AutocompleteItem[] | null> {
  const configDir = getConfigDir();
  const normalized = prefix.trimStart();
  const match = normalized.match(/^(\S+)(?:\s+(.*))?$/);

  if (!match || match[2] === undefined) {
    const subPrefix = normalized.toLowerCase();
    const matches = SUBCOMMANDS.flatMap((cmd) =>
      cmd.value.startsWith(subPrefix)
        ? [{ value: cmd.value, label: cmd.label, description: cmd.description }]
        : [],
    );
    return matches.length > 0 ? matches : null;
  }

  const [, subcommand, argPrefix] = match;
  if (subcommand.toLowerCase() === "show") {
    try {
      const query = argPrefix.trim().toLowerCase();
      const index = await getOrLoadIndex(process.cwd(), configDir);
      const matches = index.records.flatMap((r) => {
        const matchesQuery =
          !query ||
          r.id.toLowerCase().includes(query) ||
          r.title.toLowerCase().includes(query);
        return matchesQuery
          ? [
              {
                value: `show ${r.id}`,
                label: `${r.id} — ${r.title}`,
                description: `[${r.status}] ${r.constraint}`,
              },
            ]
          : [];
      });
      return matches.length > 0 ? matches : null;
    } catch {
      return null;
    }
  }

  return null;
}

async function executeRecordAdr(
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

async function executeSearchAdrs(
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

function registerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "record_adr",
    label: "Record ADR",
    description:
      "Record a new Architectural Decision Record (ADR) in .pi/decisions/ and update the index.",
    promptSnippet:
      "Record an architectural decision or legacy workaround in .pi/decisions/",
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
      "Search historical Architectural Decision Records (ADRs) in .pi/decisions/ by keyword.",
    promptSnippet:
      "Search recorded architectural decisions and constraints in .pi/decisions/",
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

export default function (pi: ExtensionAPI): void {
  // Lifecycle hooks
  pi.on("session_start", (_event, ctx) => handleSessionStart(ctx));
  pi.on("before_agent_start", (event, ctx) =>
    handleBeforeAgentStart(event.systemPrompt, ctx.cwd),
  );
  pi.on("agent_settled", (_event, ctx) => handleAgentSettled(ctx));

  // Custom tools for LLM agent
  registerTools(pi);

  // User slash command suite
  pi.registerCommand("adr", {
    description: "Manage Architectural Decision Records (ADRs)",
    getArgumentCompletions: getCompletions,
    handler: async (
      args: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      const trimmed = args.trim();
      const [subcommand = "list", ...rest] = trimmed.split(/\s+/);
      const remainder = rest.join(" ").trim();

      switch (subcommand.toLowerCase()) {
        case "list":
          await handleList(ctx);
          break;
        case "new":
          await handleNew(remainder, ctx);
          break;
        case "show":
          await handleShow(remainder, ctx);
          break;
        case "search":
          await handleSearch(remainder, ctx);
          break;
        case "status":
          await handleStatus(ctx);
          break;
        case "help":
        case "--help":
        case "-h":
          handleHelp(ctx);
          break;
        default:
          ctx.ui.notify(
            `Unknown /adr command "${subcommand}".\nAvailable: /adr [list | new | show | search | status | help]`,
            "warning",
          );
          break;
      }
    },
  });
}
