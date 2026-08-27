import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ADRIndex, ADRRecord, ADRStatus } from "./types.js";

export interface StyleTheme {
  fg?: (color: ThemeColor, text: string) => string;
  bg?: (color: Parameters<Theme["bg"]>[0], text: string) => string;
  bold?: (text: string) => string;
  italic?: (text: string) => string;
  underline?: (text: string) => string;
}

// Fallback ANSI colorizer when Theme instance is not provided
function defaultFg(color: ThemeColor, text: string): string {
  switch (color) {
    case "accent":
    case "toolTitle":
    case "mdHeading":
      return `\x1b[36m${text}\x1b[39m`; // Cyan
    case "success":
    case "syntaxFunction":
      return `\x1b[32m${text}\x1b[39m`; // Green
    case "warning":
    case "syntaxKeyword":
      return `\x1b[33m${text}\x1b[39m`; // Yellow
    case "error":
      return `\x1b[31m${text}\x1b[39m`; // Red
    case "muted":
    case "dim":
    case "syntaxComment":
      return `\x1b[90m${text}\x1b[39m`; // Gray
    case "syntaxString":
      return `\x1b[32m${text}\x1b[39m`; // Green
    case "syntaxType":
      return `\x1b[35m${text}\x1b[39m`; // Magenta
    case "text":
    default:
      return text;
  }
}

function defaultBold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

function defaultItalic(text: string): string {
  return `\x1b[3m${text}\x1b[23m`;
}

function defaultUnderline(text: string): string {
  return `\x1b[4m${text}\x1b[24m`;
}

function resolveTheme(theme?: StyleTheme): Required<StyleTheme> {
  return {
    fg: theme?.fg ?? defaultFg,
    bg: theme?.bg ?? ((_, t) => t),
    bold: theme?.bold ?? defaultBold,
    italic: theme?.italic ?? defaultItalic,
    underline: theme?.underline ?? defaultUnderline,
  };
}

/**
 * Returns a styled status badge.
 */
export function renderStatusBadge(
  status: ADRStatus,
  theme?: StyleTheme,
): string {
  const t = resolveTheme(theme);
  switch (status) {
    case "active":
      return t.fg("success", "● active");
    case "superseded":
      return t.fg("warning", "○ superseded");
    case "deprecated":
      return t.fg("error", "× deprecated");
    default:
      return t.fg("muted", `? ${status}`);
  }
}

/**
 * Strips raw markdown syntax characters while preserving clean text.
 */
export function stripMarkdownSyntax(text: string): string {
  return (
    text
      // Remove bold/italic markers
      .replace(/\*\*\*(.*?)\*\*\*/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/___(.*?)___/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      // Remove inline code ticks
      .replace(/`([^`]+)`/g, "$1")
      // Remove links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove heading hashes at line start
      .replace(/^#+\s+/gm, "")
      // Replace markdown list dashes/asterisks with clean bullet
      .replace(/^[*-]\s+/gm, "• ")
  );
}

/**
 * Formats an ADR record in clean Reading Mode where formatting elements
 * (hashes, asterisks, raw backticks, markdown bullet characters) are not displayed.
 */
export function formatReadingMode(
  record: ADRRecord,
  theme?: StyleTheme,
): string {
  const t = resolveTheme(theme);
  const divider = t.fg("muted", "─".repeat(64));

  const cleanContext = stripMarkdownSyntax(record.context);
  const cleanDecision = stripMarkdownSyntax(record.decision);
  const cleanConsequences = stripMarkdownSyntax(record.consequences);

  const lines = [
    t.bold(
      t.fg(
        "accent",
        `ADR ${record.id.replace(/^ADR-?/i, "")} : ${record.title.toUpperCase()}`,
      ),
    ),
    divider,
    `  ${t.fg("muted", "Status:")}       ${renderStatusBadge(record.status, theme)}`,
    `  ${t.fg("muted", "Recorded:")}     ${t.fg("dim", record.date)}`,
    `  ${t.fg("muted", "File:")}         ${t.fg("dim", record.file || "uncommitted")}`,
    divider,
    "",
    `  ${t.bold(t.fg("accent", "CONTEXT & PROBLEM"))}`,
    `  ${cleanContext.split("\n").join("\n  ")}`,
    "",
    `  ${t.bold(t.fg("success", "DECISION & APPROACH"))}`,
    `  ${cleanDecision.split("\n").join("\n  ")}`,
    "",
    `  ${t.bold(t.fg("warning", "CONSEQUENCES & TRADE-OFFS"))}`,
    `  ${cleanConsequences.split("\n").join("\n  ")}`,
    "",
    divider,
  ];

  return lines.join("\n");
}

/**
 * Formats arbitrary markdown content in Reading Mode without markdown syntax characters.
 */
export function formatReadingModeText(
  markdown: string,
  theme?: StyleTheme,
): string {
  const t = resolveTheme(theme);
  const lines = markdown.split("\n");
  const formatted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#\s+(.+)$/.test(trimmed)) {
      const title = trimmed.replace(/^#\s+/, "");
      formatted.push(
        t.bold(t.fg("accent", stripMarkdownSyntax(title).toUpperCase())),
      );
      formatted.push(t.fg("muted", "─".repeat(Math.min(64, title.length + 4))));
    } else if (/^##+\s+(.+)$/.test(trimmed)) {
      const heading = trimmed.replace(/^##+\s+/, "");
      formatted.push("");
      formatted.push(t.bold(t.fg("accent", stripMarkdownSyntax(heading))));
    } else if (/^-\s*\*\*([^*]+):\*\*\s*(.+)$/i.test(trimmed)) {
      const match = trimmed.match(/^-\s*\*\*([^*]+):\*\*\s*(.+)$/i);
      if (match) {
        const key = match[1].trim();
        const val = stripMarkdownSyntax(match[2].trim());
        if (key.toLowerCase() === "status") {
          formatted.push(
            `  ${t.fg("muted", key + ":")} ${renderStatusBadge(val as ADRStatus, theme)}`,
          );
        } else {
          formatted.push(`  ${t.fg("muted", key + ":")} ${val}`);
        }
      }
    } else if (/^[*-]\s+(.+)$/.test(trimmed)) {
      const item = trimmed.replace(/^[*-]\s+/, "");
      formatted.push(`  • ${stripMarkdownSyntax(item)}`);
    } else {
      formatted.push(stripMarkdownSyntax(line));
    }
  }

  return formatted.join("\n");
}

/**
 * Highlights raw ADR Markdown with ANSI syntax highlighting.
 */
export function highlightADRMarkdown(
  recordOrContent: ADRRecord | string,
  theme?: StyleTheme,
): string {
  const t = resolveTheme(theme);
  let content = "";
  if (typeof recordOrContent === "string") {
    content = recordOrContent;
  } else {
    content =
      [
        `# ${recordOrContent.id}: ${recordOrContent.title}`,
        `- **Date:** ${recordOrContent.date}`,
        `- **Status:** ${recordOrContent.status}`,
        `- **Context:** ${recordOrContent.context}`,
        `- **Decision:** ${recordOrContent.decision}`,
        `- **Consequences:** ${recordOrContent.consequences}`,
      ].join("\n") + "\n";
  }

  const lines = content.split("\n");
  const highlighted = lines.map((line) => {
    // Title: # ADR-001: Title
    if (/^#\s*(ADR-\d+)?:\s*(.+)$/i.test(line)) {
      const match = line.match(/^#\s*(ADR-\d+)?:\s*(.+)$/i);
      const id = match?.[1] ? t.bold(t.fg("accent", match[1])) + ": " : "";
      const title = match?.[2] ? t.bold(match[2]) : line;
      return t.fg("muted", "# ") + id + title;
    }

    // Metadata lines: - **Key:** Value
    const metaMatch = line.match(/^(\s*-\s*\*\*([^*]+):\*\*\s*)(.*)$/i);
    if (metaMatch) {
      const prefix = t.fg("muted", "- ");
      const keyName = metaMatch[2].trim();
      const rawVal = metaMatch[3].trim();
      const styledKey = t.bold(t.fg("accent", `**${keyName}:**`));

      let styledVal = rawVal;
      if (keyName.toLowerCase() === "status") {
        styledVal = renderStatusBadge(rawVal.toLowerCase() as ADRStatus, theme);
      } else if (keyName.toLowerCase() === "date") {
        styledVal = t.fg("dim", rawVal);
      } else if (keyName.toLowerCase() === "decision") {
        styledVal = t.fg("success", rawVal);
      } else if (keyName.toLowerCase() === "context") {
        styledVal = t.fg("text", rawVal);
      } else if (keyName.toLowerCase() === "consequences") {
        styledVal = t.fg("warning", rawVal);
      }

      return `${prefix}${styledKey} ${styledVal}`;
    }

    // Code blocks
    if (line.startsWith("```")) {
      return t.fg("dim", line);
    }

    // Inline backticks
    return line.replace(/`([^`]+)`/g, (_m, code) =>
      t.fg("syntaxFunction", `\`${code}\``),
    );
  });

  return highlighted.join("\n");
}

/**
 * Renders a directory overview header box for the Pi TUI.
 */
export function renderDirectoryHeader(
  index: ADRIndex,
  dirPath: string,
  theme?: StyleTheme,
): string[] {
  const t = resolveTheme(theme);
  const active = index.records.filter((r) => r.status === "active").length;
  const superseded = index.records.filter(
    (r) => r.status === "superseded",
  ).length;
  const deprecated = index.records.filter(
    (r) => r.status === "deprecated",
  ).length;

  const total = index.records.length;
  const stats = [
    t.fg("success", `● ${active} active`),
    t.fg("warning", `○ ${superseded} superseded`),
    t.fg("error", `× ${deprecated} deprecated`),
  ].join("  ");

  return [
    t.bold(t.fg("accent", "  ADR ARCHITECTURAL LEDGER")),
    `  ${t.fg("muted", "Storage:")}   ${t.fg("dim", dirPath)}`,
    `  ${t.fg("muted", "Records:")}   ${t.bold(String(total))} total  [${stats}]`,
    `  ${t.fg("muted", "Updated:")}   ${t.fg("dim", index.lastUpdated || "never")}`,
  ];
}

function getStatusFormatted(
  status: ADRStatus,
  t: Required<StyleTheme>,
): { text: string; col: string } {
  if (status === "active") {
    return { text: "● active    ", col: t.fg("success", "● active    ") };
  }
  if (status === "superseded") {
    return { text: "○ superseded", col: t.fg("warning", "○ superseded") };
  }
  return { text: "× deprecated", col: t.fg("error", "× deprecated") };
}

/**
 * Renders a formatted directory table view with clean borders and syntax highlighting.
 */
export function renderDirectoryTable(
  index: ADRIndex,
  dirPath = "docs/adr",
  theme?: StyleTheme,
): string {
  const t = resolveTheme(theme);
  const lines: string[] = [];

  // Header Box
  lines.push(
    t.fg(
      "muted",
      "┌─ ARCHITECTURAL DECISIONS ──────────────────────────────────────────────────┐",
    ),
  );
  for (const hLine of renderDirectoryHeader(index, dirPath, theme)) {
    lines.push(hLine);
  }
  lines.push(
    t.fg(
      "muted",
      "├──────────┬──────────────┬─────────────────────┬────────────────────────────┤",
    ),
  );
  lines.push(
    `│ ${t.bold(t.fg("accent", "ID       "))} │ ${t.bold(t.fg("accent", "STATUS       "))} │ ${t.bold(t.fg("accent", "RECORDED (DATE/TIME) "))} │ ${t.bold(t.fg("accent", "TITLE                      "))} │`,
  );
  lines.push(
    t.fg(
      "muted",
      "├──────────┼──────────────┼─────────────────────┼────────────────────────────┤",
    ),
  );

  if (index.records.length === 0) {
    lines.push(
      `│ ${t.fg("dim", "No architectural decisions recorded yet in docs/adr/                  ")} │`,
    );
  } else {
    for (const r of index.records) {
      const idCol = t.bold(t.fg("accent", r.id.padEnd(8)));
      const { col: statusCol } = getStatusFormatted(r.status, t);
      const dateCol = t.fg("dim", r.date.slice(0, 19).padEnd(19));
      const truncatedTitle =
        r.title.length > 26 ? `${r.title.slice(0, 23)}...` : r.title.padEnd(26);
      const titleCol = t.fg("text", truncatedTitle);

      lines.push(`│ ${idCol} │ ${statusCol} │ ${dateCol} │ ${titleCol} │`);
    }
  }

  lines.push(
    t.fg(
      "muted",
      "└──────────┴──────────────┴─────────────────────┴────────────────────────────┘",
    ),
  );
  lines.push(
    t.fg(
      "dim",
      "  Commands: /adr show <id> [--read|--raw] • /adr new <title> • /adr search <query>",
    ),
  );

  return lines.join("\n");
}
