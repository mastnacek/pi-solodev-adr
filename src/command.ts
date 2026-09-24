// /adr subcommand handlers.
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAvailableModels, loadConfig, saveConfig } from "./config.js";
import {
	getDecisionsDir,
	getIndexPath,
	readRecord,
	saveRecord,
	searchRecords,
} from "./ledger.js";
import { getConfigDir, getOrLoadIndex, invalidateCache, updateStatusBar } from "./state.js";
import type { ADRDraft, ADRRecord } from "./types.js";
import {
	formatStatusLine,
	goldGlow,
	greenGlow,
	pinkGlow,
	renderStatusBadge,
} from "./viewer.js";
import { openDirectoryExplorer, openReaderView } from "./views.js";

export async function handleList(ctx: ExtensionCommandContext): Promise<void> {
  await openDirectoryExplorer(ctx);
}

export async function handleNew(
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

export async function handleShow(
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

export async function handleSearch(
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

export async function handleModel(
  remainder: string,
  ctx: ExtensionCommandContext,
  isGlobal = false,
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

  saveConfig({ translateModel: cleanModel }, isGlobal, ctx.cwd);
  ctx.ui.notify(
    `Model pro překlad nastaven na: ${pinkGlow(cleanModel)}${isGlobal ? " (uloženo globálně)" : " (uloženo do projektu)"}`,
    "info",
  );
}

export async function handleRouting(
  remainder: string,
  ctx: ExtensionCommandContext,
  isGlobal = false,
): Promise<void> {
  const config = loadConfig();
  const lower = remainder.trim().toLowerCase();
  const scopeSuffix = isGlobal ? " (uloženo globálně)" : " (uloženo do projektu)";

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
    saveConfig({ subprojectRouting: true }, isGlobal, ctx.cwd);
    ctx.ui.notify(
      `Směrování podprojektů zapnuto ${greenGlow("[ZAPNUTO]")}: ADR se automaticky ukládají do zjištěného repozitáře podprojektu.${scopeSuffix}`,
      "info",
    );
    return;
  }

  if (lower === "off" || lower === "false" || lower === "disable") {
    saveConfig({ subprojectRouting: false }, isGlobal, ctx.cwd);
    ctx.ui.notify(
      `Směrování podprojektů vypnuto ${goldGlow("[VYPNUTO]")}: ADR se budou vždy ukládat do kořene aktuální session.${scopeSuffix}`,
      "info",
    );
    return;
  }

  ctx.ui.notify("Použití: `/adr routing [on|off]`", "warning");
}

export async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
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

export function handleHelp(ctx: ExtensionCommandContext): void {
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
