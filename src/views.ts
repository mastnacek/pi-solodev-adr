// TUI reader view and directory explorer.
import {
	DynamicBorder,
	type ExtensionCommandContext,
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
import { getDecisionsDir, readRecord } from "./ledger.js";
import { getConfigDir, getOrLoadIndex } from "./state.js";
import { translateRecordToCzech } from "./translator.js";
import type { ADRRecord } from "./types.js";
import {
	coralGlow,
	cyanGlow,
	dividerGlow,
	formatReadingMode,
	goldGlow,
	greenGlow,
	highlightADRMarkdown,
	pinkGlow,
	renderDirectoryHeader,
	renderDirectoryTable,
	renderStatusBadge,
	violetGlow,
} from "./viewer.js";

export async function openReaderView(
  ctx: ExtensionCommandContext,
  initialRecord: ADRRecord,
  initialReadingMode = true,
): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    const text = initialReadingMode
      ? formatReadingMode(initialRecord)
      : highlightADRMarkdown(initialRecord);
    if (ctx.hasUI) {
      ctx.ui.notify(text, "info");
    }
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

export async function openDirectoryExplorer(
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

  if (!ctx.hasUI || ctx.mode !== "tui") {
    if (ctx.hasUI) {
      ctx.ui.notify(renderDirectoryTable(index, decisionsDir), "info");
    }
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
