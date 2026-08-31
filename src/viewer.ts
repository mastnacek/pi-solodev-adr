import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ADRIndex, ADRRecord, ADRStatus } from "./types.js";

export interface StyleTheme {
  fg?: (color: ThemeColor, text: string) => string;
  bg?: (color: Parameters<Theme["bg"]>[0], text: string) => string;
  bold?: (text: string) => string;
  italic?: (text: string) => string;
  underline?: (text: string) => string;
}

// TrueColor Neon Pink & Cyber Glow Palette with ANSI 256 fallback
const NEON_PINK = "\x1b[38;2;255;113;206m"; // Neon hot pink
const NEON_CYAN = "\x1b[38;2;1;205;254m"; // Neon electric cyan
const NEON_GREEN = "\x1b[38;2;5;255;161m"; // Neon emerald green
const NEON_GOLD = "\x1b[38;2;255;211;25m"; // Neon amber gold
const NEON_CORAL = "\x1b[38;2;255;85;115m"; // Neon coral red
const NEON_VIOLET = "\x1b[38;2;185;103;255m"; // Neon electric violet
const GLOW_DIVIDER = "\x1b[38;2;130;70;170m"; // Subtle glowing purple divider
const ANSI_RESET = "\x1b[39m";

export function pinkGlow(text: string): string {
  return `${NEON_PINK}${text}${ANSI_RESET}`;
}

export function cyanGlow(text: string): string {
  return `${NEON_CYAN}${text}${ANSI_RESET}`;
}

export function greenGlow(text: string): string {
  return `${NEON_GREEN}${text}${ANSI_RESET}`;
}

export function goldGlow(text: string): string {
  return `${NEON_GOLD}${text}${ANSI_RESET}`;
}

export function coralGlow(text: string): string {
  return `${NEON_CORAL}${text}${ANSI_RESET}`;
}

export function violetGlow(text: string): string {
  return `${NEON_VIOLET}${text}${ANSI_RESET}`;
}

export function dividerGlow(text: string): string {
  return `${GLOW_DIVIDER}${text}${ANSI_RESET}`;
}

// Fallback ANSI colorizer when Theme instance is not provided
function defaultFg(color: ThemeColor, text: string): string {
  switch (color) {
    case "accent":
    case "syntaxType":
      return pinkGlow(text);
    case "toolTitle":
    case "mdHeading":
      return cyanGlow(text);
    case "success":
    case "syntaxFunction":
      return greenGlow(text);
    case "warning":
    case "syntaxKeyword":
      return goldGlow(text);
    case "error":
      return coralGlow(text);
    case "muted":
    case "dim":
    case "syntaxComment":
      return `\x1b[90m${text}\x1b[39m`;
    case "syntaxString":
      return greenGlow(text);
    case "syntaxVariable":
      return violetGlow(text);
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
    fg: (color, text) =>
      theme?.fg ? theme.fg(color, text) : defaultFg(color, text),
    bg: (color, text) => (theme?.bg ? theme.bg(color, text) : text),
    bold: (text) => (theme?.bold ? theme.bold(text) : defaultBold(text)),
    italic: (text) =>
      theme?.italic ? theme.italic(text) : defaultItalic(text),
    underline: (text) =>
      theme?.underline ? theme.underline(text) : defaultUnderline(text),
  };
}

/**
 * Returns a distinct glowing status badge.
 */
export function renderStatusBadge(
  status: ADRStatus,
  theme?: StyleTheme,
): string {
  const t = resolveTheme(theme);
  switch (status) {
    case "active":
      return greenGlow("● active");
    case "superseded":
      return goldGlow("○ superseded");
    case "deprecated":
      return coralGlow("× deprecated");
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
 * (hashes, asterisks, raw backticks, markdown bullet characters) are not displayed,
 * with pink glow headers and glowing callout frames.
 */
export function formatReadingMode(
  record: ADRRecord,
  theme?: StyleTheme,
): string {
  const t = resolveTheme(theme);
  const divider = dividerGlow("━".repeat(68));
  const pipe = pinkGlow("│");

  const cleanContext = stripMarkdownSyntax(record.context);
  const cleanDecision = stripMarkdownSyntax(record.decision);
  const cleanConsequences = stripMarkdownSyntax(record.consequences);

  const formatSectionBody = (body: string) =>
    body
      .split("\n")
      .map((line) => `  ${pipe} ${line}`)
      .join("\n");

  const lines = [
    t.bold(
      pinkGlow(
        `◈ ADR ${record.id.replace(/^ADR-?/i, "")} : ${record.title.toUpperCase()}`,
      ),
    ),
    divider,
    `  ${violetGlow("Status:")}       ${renderStatusBadge(record.status, theme)}`,
    `  ${violetGlow("Recorded:")}     ${t.fg("dim", record.date)}`,
    `  ${violetGlow("File:")}         ${t.fg("dim", record.file || "uncommitted")}`,
    divider,
    "",
    `  ${t.bold(pinkGlow("◆ CONTEXT & PROBLEM"))}`,
    formatSectionBody(cleanContext),
    "",
    `  ${t.bold(cyanGlow("◆ DECISION & APPROACH"))}`,
    formatSectionBody(cleanDecision),
    "",
    `  ${t.bold(goldGlow("◆ CONSEQUENCES & TRADE-OFFS"))}`,
    formatSectionBody(cleanConsequences),
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
        t.bold(pinkGlow(`◈ ${stripMarkdownSyntax(title).toUpperCase()}`)),
      );
      formatted.push(dividerGlow("━".repeat(Math.min(68, title.length + 6))));
    } else if (/^##+\s+(.+)$/.test(trimmed)) {
      const heading = trimmed.replace(/^##+\s+/, "");
      formatted.push("");
      formatted.push(t.bold(cyanGlow(`◆ ${stripMarkdownSyntax(heading)}`)));
    } else if (/^-\s*\*\*([^*]+):\*\*\s*(.+)$/i.test(trimmed)) {
      const match = trimmed.match(/^-\s*\*\*([^*]+):\*\*\s*(.+)$/i);
      if (match) {
        const key = match[1].trim();
        const val = stripMarkdownSyntax(match[2].trim());
        if (key.toLowerCase() === "status") {
          formatted.push(
            `  ${violetGlow(key + ":")} ${renderStatusBadge(val as ADRStatus, theme)}`,
          );
        } else {
          formatted.push(`  ${violetGlow(key + ":")} ${val}`);
        }
      }
    } else if (/^[*-]\s+(.+)$/.test(trimmed)) {
      const item = trimmed.replace(/^[*-]\s+/, "");
      formatted.push(`  ${pinkGlow("•")} ${stripMarkdownSyntax(item)}`);
    } else {
      formatted.push(stripMarkdownSyntax(line));
    }
  }

  return formatted.join("\n");
}

/**
 * Highlights raw ADR Markdown with vivid Pink & Cyan ANSI syntax highlighting.
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
      const id = match?.[1] ? t.bold(pinkGlow(match[1])) + ": " : "";
      const title = match?.[2] ? t.bold(match[2]) : line;
      return pinkGlow("# ") + id + title;
    }

    // Metadata lines: - **Key:** Value
    const metaMatch = line.match(/^(\s*-\s*\*\*([^*]+):\*\*\s*)(.*)$/i);
    if (metaMatch) {
      const prefix = pinkGlow("- ");
      const keyName = metaMatch[2].trim();
      const rawVal = metaMatch[3].trim();
      const styledKey = t.bold(cyanGlow(`**${keyName}:**`));

      let styledVal = rawVal;
      if (keyName.toLowerCase() === "status") {
        styledVal = renderStatusBadge(rawVal.toLowerCase() as ADRStatus, theme);
      } else if (keyName.toLowerCase() === "date") {
        styledVal = t.fg("dim", rawVal);
      } else if (keyName.toLowerCase() === "decision") {
        styledVal = greenGlow(rawVal);
      } else if (keyName.toLowerCase() === "context") {
        styledVal = t.fg("text", rawVal);
      } else if (keyName.toLowerCase() === "consequences") {
        styledVal = goldGlow(rawVal);
      }

      return `${prefix}${styledKey} ${styledVal}`;
    }

    // Code blocks
    if (line.startsWith("```")) {
      return dividerGlow(line);
    }

    // Inline backticks
    return line.replace(/`([^`]+)`/g, (_m, code) => pinkGlow(`\`${code}\``));
  });

  return highlighted.join("\n");
}

/**
 * Renders a directory overview header box for the Pi TUI with neon accents.
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
    greenGlow(`● ${active} active`),
    goldGlow(`○ ${superseded} superseded`),
    coralGlow(`× ${deprecated} deprecated`),
  ].join("  ");

  return [
    t.bold(pinkGlow("  ◈ ADR ARCHITECTURAL LEDGER")),
    `  ${violetGlow("Storage:")}   ${t.fg("dim", dirPath)}`,
    `  ${violetGlow("Records:")}   ${t.bold(String(total))} total  [${stats}]`,
    `  ${violetGlow("Updated:")}   ${t.fg("dim", index.lastUpdated || "never")}`,
  ];
}

/**
 * Formats a compact, colorful ADR statusline string for the Pi agent statusbar.
 * Only displays indicators that have active / non-zero counts to save statusline space.
 * Returns undefined if there are no records or all counts are zero.
 */
export function formatStatusLine(index?: ADRIndex | null): string | undefined {
  if (!index || !index.records || index.records.length === 0) {
    return undefined;
  }

  const active = index.records.filter((r) => r.status === "active").length;
  const superseded = index.records.filter(
    (r) => r.status === "superseded",
  ).length;
  const deprecated = index.records.filter(
    (r) => r.status === "deprecated",
  ).length;

  const parts: string[] = [];

  if (active > 0) {
    parts.push(greenGlow(`● ${active}`));
  }
  if (superseded > 0) {
    parts.push(goldGlow(`○ ${superseded}`));
  }
  if (deprecated > 0) {
    parts.push(coralGlow(`× ${deprecated}`));
  }

  if (parts.length === 0) {
    return undefined;
  }

  const prefix = pinkGlow("ADR:");
  return `${prefix} ${parts.join("  ")}`;
}

function getStatusFormatted(status: ADRStatus): { text: string; col: string } {
  if (status === "active") {
    return { text: "● active    ", col: greenGlow("● active    ") };
  }
  if (status === "superseded") {
    return { text: "○ superseded", col: goldGlow("○ superseded") };
  }
  return { text: "× deprecated", col: coralGlow("× deprecated") };
}

/**
 * Renders a formatted directory table view with clean glowing borders and syntax highlighting.
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
    dividerGlow(
      "┌─ ◈ ARCHITECTURAL DECISIONS ────────────────────────────────────────────────┐",
    ),
  );
  for (const hLine of renderDirectoryHeader(index, dirPath, theme)) {
    lines.push(hLine);
  }
  lines.push(
    dividerGlow(
      "├──────────┬──────────────┬─────────────────────┬────────────────────────────┤",
    ),
  );
  lines.push(
    `│ ${t.bold(pinkGlow("ID       "))} │ ${t.bold(pinkGlow("STATUS       "))} │ ${t.bold(pinkGlow("RECORDED (DATE/TIME) "))} │ ${t.bold(pinkGlow("TITLE                      "))} │`,
  );
  lines.push(
    dividerGlow(
      "├──────────┼──────────────┼─────────────────────┼────────────────────────────┤",
    ),
  );

  if (index.records.length === 0) {
    lines.push(
      `│ ${t.fg("dim", "No architectural decisions recorded yet in docs/adr/                  ")} │`,
    );
  } else {
    for (const r of index.records) {
      const idCol = t.bold(pinkGlow(r.id.padEnd(8)));
      const { col: statusCol } = getStatusFormatted(r.status);
      const dateCol = t.fg("dim", r.date.slice(0, 19).padEnd(19));
      const truncatedTitle =
        r.title.length > 26 ? `${r.title.slice(0, 23)}...` : r.title.padEnd(26);
      const titleCol = t.fg("text", truncatedTitle);

      lines.push(`│ ${idCol} │ ${statusCol} │ ${dateCol} │ ${titleCol} │`);
    }
  }

  lines.push(
    dividerGlow(
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
