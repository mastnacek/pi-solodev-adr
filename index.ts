import {
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
import { relative } from "node:path";
import {
  ensureDecisionsDir,
  formatADRMarkdown,
  getDecisionsDir,
  getIndexPath,
  loadIndex,
  readRecord,
  resolveTargetRoot,
  saveRecord,
  searchRecords,
} from "./src/ledger.js";
import type { ADRDraft, ADRIndex, ADRRecord, ADRStatus } from "./src/types.js";
import { getAvailableModels, loadConfig, saveConfig } from "./src/config.js";
import {
  coralGlow,
  cyanGlow,
  dividerGlow,
  formatReadingMode,
  formatStatusLine,
  goldGlow,
  greenGlow,
  highlightADRMarkdown,
  pinkGlow,
  renderDirectoryHeader,
  renderDirectoryTable,
  renderStatusBadge,
  violetGlow,
} from "./src/viewer.js";
import { translateRecordToCzech } from "./src/translator.js";

const SUBCOMMANDS = [
  {
    value: "list",
    label: "list",
    description: "Zobrazit přehled a tabulku všech ADR záznamů",
  },
  {
    value: "new",
    label: "new <titulek>",
    description: "Interaktivně vytvořit a uložit nový 5-řádkový MADR záznam",
  },
  {
    value: "show",
    label: "show <id> [--read|--raw]",
    description:
      "Zobrazit detail rozhodnutí v režimu čtení nebo se zvýrazněním",
  },
  {
    value: "search",
    label: "search <dotaz>",
    description: "Vyhledávat v historii architektonických rozhodnutí",
  },
  {
    value: "model",
    label: "model [název]",
    description:
      "Nastavit nebo zobrazit model pro překlad (např. google/gemini-3.7-flash)",
  },
  {
    value: "routing",
    label: "routing [on|off]",
    description:
      "Přepnout automatické směrování ADR do nejbližšího podprojektu",
  },
  {
    value: "status",
    label: "status",
    description: "Zobrazit stav radaru, počet aktivních pravidel a úložiště",
  },
  {
    value: "help",
    label: "help",
    description: "Zobrazit přehled příkazů a nápovědu v češtině",
  },
];

let cachedIndex: ADRIndex | null = null;

async function getOrLoadIndex(
  cwd: string,
  dirOverride?: string,
): Promise<ADRIndex> {
  if (cachedIndex) return cachedIndex;
  cachedIndex = await loadIndex(cwd, dirOverride);
  return cachedIndex;
}

function invalidateCache(): void {
  cachedIndex = null;
}

function getConfigDir(): string | undefined {
  return undefined;
}

async function updateStatusBar(
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

async function handleSessionStart(ctx: ExtensionContext): Promise<void> {
  try {
    const configDir = getConfigDir();
    await ensureDecisionsDir(ctx.cwd, configDir);
    invalidateCache();
    await updateStatusBar(ctx);
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

async function promptAndSaveDraft(
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

async function handleAgentSettled(ctx: ExtensionContext): Promise<void> {
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

async function openReaderView(
  ctx: ExtensionCommandContext,
  initialRecord: ADRRecord,
  initialReadingMode = true,
): Promise<void> {
  if (!ctx.hasUI) {
    const text = initialReadingMode
      ? formatReadingMode(initialRecord)
      : highlightADRMarkdown(initialRecord);
    ctx.ui.notify(text, "info");
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    let readingMode = initialReadingMode;
    let isCzech = false;
    let isTranslating = false;
    let translationError: string | null = null;
    const currentRecord = initialRecord;
    let translatedRecord: ADRRecord | null = null;
    const container = new Container();

    const rebuild = () => {
      container.clear();
      // Top Border with Pink Glow
      container.addChild(new DynamicBorder((s: string) => pinkGlow(s)));

      // Title & Mode pill
      const modeBadge = readingMode
        ? greenGlow("[● Reading Mode (Clean)]")
        : goldGlow("[⚡ Syntax Highlighting (Raw)]");
      let langBadge = cyanGlow("[🇬🇧 English (Original)]");
      if (isTranslating) {
        langBadge = violetGlow("[⏳ Překládám...]");
      } else if (translationError) {
        langBadge = coralGlow(`[❌ ${translationError}]`);
      } else if (isCzech) {
        langBadge = pinkGlow("[🇨🇿 Čeština (Doslovný překlad)]");
      }

      const activeRecord =
        isCzech && translatedRecord ? translatedRecord : currentRecord;
      const titleLine = `${pinkGlow(theme.bold(`◈ ${activeRecord.id}: ${activeRecord.title}`))}  ${modeBadge}  ${langBadge}`;
      container.addChild(new Text(titleLine, 1, 0));
      container.addChild(new Spacer(1));

      // Body text
      const content = readingMode
        ? formatReadingMode(activeRecord, theme)
        : highlightADRMarkdown(activeRecord, theme);
      container.addChild(new Text(content, 1, 0));

      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          violetGlow(
            "m: mode (clean/raw) • t/l: language (CS/EN) • esc: close",
          ),
          1,
          0,
        ),
      );
      container.addChild(new DynamicBorder((s: string) => pinkGlow(s)));
    };

    rebuild();

    return {
      render: (w) => container.render(w),
      invalidate: () => {
        rebuild();
        container.invalidate();
      },
      handleInput: async (data) => {
        if (matchesKey(data, "m") || matchesKey(data, "r")) {
          readingMode = !readingMode;
          rebuild();
          tui.requestRender();
        } else if (matchesKey(data, "t") || matchesKey(data, "l")) {
          if (isCzech) {
            isCzech = false;
            translationError = null;
            rebuild();
            tui.requestRender();
            return;
          }

          if (translatedRecord) {
            isCzech = true;
            translationError = null;
            rebuild();
            tui.requestRender();
            return;
          }

          isTranslating = true;
          translationError = null;
          rebuild();
          tui.requestRender();

          try {
            const result = await translateRecordToCzech(currentRecord, ctx);
            if (result.ok) {
              translatedRecord = result.record;
              isCzech = true;
              translationError = null;
            } else {
              translationError = result.error || "Překlad selhal";
            }
          } catch (err: unknown) {
            translationError = err instanceof Error ? err.message : String(err);
          } finally {
            isTranslating = false;
            rebuild();
            tui.requestRender();
          }
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
      "No ADR records found in docs/adr/. Use `/adr new <title>` to create one.",
      "info",
    );
    return;
  }

  if (!ctx.hasUI) {
    ctx.ui.notify(renderDirectoryTable(index, decisionsDir), "info");
    return;
  }

  while (true) {
    const selectedId = await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();

        // Top Border with Pink Glow
        container.addChild(new DynamicBorder((s: string) => pinkGlow(s)));

        // Header lines
        const headerLines = renderDirectoryHeader(index, decisionsDir, theme);
        for (const h of headerLines) {
          container.addChild(new Text(h, 1, 0));
        }
        container.addChild(new Spacer(1));

        // SelectList items with distinct pink/green/gold pills
        const items: SelectItem[] = index.records.map((r) => {
          const badge = renderStatusBadge(r.status, theme);
          return {
            value: r.id,
            label: `${pinkGlow(r.id)}  ${badge}  ${r.title}`,
            description: r.date,
          };
        });

        const selectList = new SelectList(items, Math.min(items.length, 12), {
          selectedPrefix: (t) => pinkGlow(t),
          selectedText: (t) => pinkGlow(theme.bold(t)),
          description: (t) => violetGlow(t),
          scrollInfo: (t) => dividerGlow(t),
          noMatch: (t) => goldGlow(t),
        });

        selectList.onSelect = (item) => done(item.value);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        container.addChild(new Spacer(1));
        container.addChild(
          new Text(
            violetGlow("↑↓: navigate • enter: read ADR • esc: exit"),
            1,
            0,
          ),
        );
        container.addChild(new DynamicBorder((s: string) => pinkGlow(s)));

        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data) => {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      },
    );

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
  const defaultTitle = remainder || "Nové architektonické rozhodnutí";
  const title = (await ctx.ui.input("Titulek ADR:", defaultTitle))?.trim();
  if (!title) {
    ctx.ui.notify("Vytváření ADR zrušeno (prázdný titulek).", "warning");
    return;
  }

  const context =
    (
      await ctx.ui.input(
        "Kontext (Proč byla tato změna nutná? Jaké omezení ji vyvolalo?):",
        "",
      )
    )?.trim() || "";
  const decision =
    (
      await ctx.ui.input(
        "Rozhodnutí (Jaký konkrétní přístup nebo workaround byl zvolen?):",
        "",
      )
    )?.trim() || "";
  const consequences =
    (
      await ctx.ui.input(
        "Důsledky (Jaké jsou kompromisy, limity a návazné kroky?):",
        "",
      )
    )?.trim() || "";

  const draft: ADRDraft = {
    title,
    context: context || "Zaznamenané architektonické rozhodnutí.",
    decision: decision || title,
    consequences: consequences || "Dodržovat rozhodnutí pro prevenci regresí.",
    status: "active",
  };

  const saved = await saveRecord(ctx.cwd, draft, configDir);
  invalidateCache();
  await updateStatusBar(ctx);
  ctx.ui.notify(
    `Vytvořeno ${saved.id}: ${saved.title}\nUloženo do ${saved.file}`,
    "info",
  );
}

async function handleShow(
  remainder: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const tokens = remainder.trim().split(/\s+/).filter(Boolean);
  const isRaw = tokens.some((t) => t.toLowerCase() === "--raw");
  const idQuery = tokens
    .filter((t) => !t.startsWith("--"))
    .join(" ")
    .trim();

  if (!idQuery) {
    ctx.ui.notify(
      "Použití: `/adr show <id> [--read | --raw]` (např. `/adr show ADR-001`)",
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
    ctx.ui.notify(`ADR nenalezeno: "${idQuery}"`, "error");
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
    ctx.ui.notify("Použití: `/adr search <hledaný_výraz>`", "warning");
    return;
  }

  const configDir = getConfigDir();
  const results = await searchRecords(ctx.cwd, remainder, configDir);
  if (results.length === 0) {
    ctx.ui.notify(
      `Žádné ADR záznamy neodpovídají výrazu "${remainder}".`,
      "info",
    );
    return;
  }

  const lines = [
    `# Výsledky vyhledávání ADR pro "${remainder}" (${results.length} nálezů):`,
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

async function handleModel(
  remainder: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const config = loadConfig();
  const cleanModel = remainder.trim();
  if (!cleanModel) {
    const available = getAvailableModels(ctx);
    ctx.ui.notify(
      `Aktuální model pro překlad: ${pinkGlow(config.translateModel || "default")}\n\nDostupné modely:\n` +
        available
          .slice(0, 10)
          .map((m) => `  - /adr model ${m}`)
          .join("\n"),
      "info",
    );
    return;
  }

  saveConfig({ translateModel: cleanModel });
  ctx.ui.notify(
    `Model pro překlad nastaven na: ${pinkGlow(cleanModel)}`,
    "info",
  );
}

async function handleRouting(
  remainder: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const config = loadConfig();
  const lower = remainder.trim().toLowerCase();

  if (!lower) {
    const stateText = config.subprojectRouting
      ? greenGlow("ZAPNUTO (automaticky ukládá do kořene podprojektu)")
      : goldGlow("VYPNUTO (vždy ukládá do aktuální pracovní složky)");
    ctx.ui.notify(
      `Směrování podprojektů: ${stateText}\n\nPřepínání: /adr routing on | /adr routing off`,
      "info",
    );
    return;
  }

  if (lower === "on" || lower === "true" || lower === "enable") {
    saveConfig({ subprojectRouting: true });
    ctx.ui.notify(
      `Směrování podprojektů zapnuto ${greenGlow("[ZAPNUTO]")}: ADR se automaticky ukládají do zjištěného repozitáře podprojektu.`,
      "info",
    );
    return;
  }

  if (lower === "off" || lower === "false" || lower === "disable") {
    saveConfig({ subprojectRouting: false });
    ctx.ui.notify(
      `Směrování podprojektů vypnuto ${goldGlow("[VYPNUTO]")}: ADR se budou vždy ukládat do kořene aktuální session.`,
      "info",
    );
    return;
  }

  ctx.ui.notify("Použití: `/adr routing [on|off]`", "warning");
}

async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const configDir = getConfigDir();
  const config = loadConfig();
  const index = await getOrLoadIndex(ctx.cwd, configDir);
  const decisionsDir = getDecisionsDir(ctx.cwd, configDir);
  const indexPath = getIndexPath(ctx.cwd, configDir);
  const activeCount = index.records.filter((r) => r.status === "active").length;
  const supersededCount = index.records.filter(
    (r) => r.status === "superseded",
  ).length;
  const deprecatedCount = index.records.filter(
    (r) => r.status === "deprecated",
  ).length;
  const statusDashboard = formatStatusLine(index) || "(prázdné / skryté)";

  const lines = [
    "# Stav pi-solo-radar",
    `- **Složka:** ${decisionsDir}`,
    `- **Index soubor:** ${indexPath}`,
    `- **Statusline:** ${statusDashboard}`,
    `- **Model pro překlad:** ${config.translateModel}`,
    `- **Směrování podprojektů:** ${config.subprojectRouting ? "ZAPNUTO (auto-detekce)" : "VYPNUTO (cwd)"}`,
    `- **Celkem záznamů:** ${index.records.length}`,
    `- **Aktivní (● active):** ${activeCount}`,
    `- **Nahrazeno (○ superseded):** ${supersededCount}`,
    `- **Zavrhnuto (× deprecated):** ${deprecatedCount}`,
    `- **Poslední aktualizace:** ${index.lastUpdated || "Nikdy"}`,
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

function handleHelp(ctx: ExtensionCommandContext): void {
  const lines = [
    "# pi-solo-radar — Přehled příkazů a nápověda",
    "",
    "Autonomní správce architektonických rozhodnutí (ADR) pro solo vývojáře.",
    "",
    "### Dostupné příkazy:",
    "- `/adr list` — Interaktivní TUI průzkumník a tabulka architektonických rozhodnutí.",
    "- `/adr new <titulek>` — Interaktivní průvodce pro vytvoření nového MADR záznamu.",
    "- `/adr show <id> [--read|--raw]` — Zobrazit konkrétní ADR v režimu čtení nebo se zvýrazněním.",
    "- `/adr search <dotaz>` — Rychlé vyhledávání v historii rozhodnutí a mantinelů.",
    "- `/adr model [model]` — Zobrazit nebo nastavit model pro překlad (např. `google/gemini-3.7-flash`).",
    "- `/adr routing [on|off]` — Zapnout/vypnout automatické ukládání do kořene podprojektu.",
    "- `/adr status` — Zobrazit stav radaru, počet aktivních pravidel a cesty.",
    "- `/adr help` — Zobrazit tuto nápovědu.",
    "",
    "### Režim čtení a překlad:",
    "- **Režim čtení (výchozí):** Odstraní surové znaky formátování (`#`, `**`, `` ` ``, odrážky) pro čisté čtení.",
    "- Stisknutím **`m`** (nebo **`r`**) v prohlížeči přepnete mezi čistým textem a surovým Markdownem.",
    "- Stisknutím **`t`** (nebo **`l`**) spustíte doslovný překlad do češtiny (smyčka CS/EN).",
    "",
    "### 5-řádkový MADR formát:",
    "Ukládá se do `docs/adr/YYYY-MM-DD-ADR-NNN-<slug>.md` se sekcemi:",
    "`Kontext`, `Rozhodnutí`, `Důsledky`.",
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

async function getCompletions(
  prefix: string,
): Promise<AutocompleteItem[] | null> {
  const configDir = getConfigDir();
  const tokens = prefix.split(/\s+/).filter(Boolean);
  const trailingSpace = /\s$/.test(prefix);
  const normalizedPrefix = tokens.join(" ").toLowerCase();

  // N-th token completion (2nd or 3rd level parameters)
  if (tokens.length > 1 || (trailingSpace && tokens.length === 1)) {
    const cmd = tokens[0]?.toLowerCase();

    if (cmd === "model") {
      try {
        const available = getAvailableModels();
        const items: AutocompleteItem[] = available.map((m) => ({
          value: `model ${m}`,
          label: `model ${m}`,
          description:
            m === "current"
              ? "Použít aktuální model konverzace"
              : m === "default"
                ? "Použít výchozí model"
                : `Použít model ${m}`,
        }));
        const filtered = items.filter((i) =>
          i.value.toLowerCase().startsWith(normalizedPrefix),
        );
        return filtered.length > 0 ? filtered : null;
      } catch {
        return null;
      }
    }

    if (cmd === "routing") {
      const items: AutocompleteItem[] = [
        {
          value: "routing on",
          label: "routing on",
          description: "Zapnout automatické směrování do kořene podprojektu",
        },
        {
          value: "routing off",
          label: "routing off",
          description:
            "Vypnout automatické směrování (vždy ukládat do kořene session)",
        },
      ];
      const filtered = items.filter((i) =>
        i.value.toLowerCase().startsWith(normalizedPrefix),
      );
      return filtered.length > 0 ? filtered : null;
    }

    if (cmd === "show") {
      try {
        const index = await getOrLoadIndex(process.cwd(), configDir);
        const items = index.records.map((r) => ({
          value: `show ${r.id}`,
          label: `${r.id} — ${r.title}`,
          description: `[${r.status}] ${r.constraint}`,
        }));
        const filtered = items.filter(
          (i) =>
            i.value.toLowerCase().startsWith(normalizedPrefix) ||
            i.label.toLowerCase().includes(tokens[1]?.toLowerCase() ?? ""),
        );
        return filtered.length > 0 ? filtered : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  // 1st Token Completion (Subcommands)
  const typed = (tokens[0] ?? "").toLowerCase();
  const items = SUBCOMMANDS.filter((cmd) =>
    cmd.value.toLowerCase().startsWith(typed),
  ).map((cmd) => ({
    value: cmd.value,
    label: cmd.label,
    description: cmd.description,
  }));

  return items.length > 0 ? items : null;
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
    description: "Správa architektonických rozhodnutí (ADR) a mantinelů",
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
        case "model":
          await handleModel(remainder, ctx);
          break;
        case "routing":
          await handleRouting(remainder, ctx);
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
            `Neznámý /adr příkaz "${subcommand}".\nDostupné: /adr [list | new | show | search | status | help]`,
            "warning",
          );
          break;
      }
    },
  });
}
