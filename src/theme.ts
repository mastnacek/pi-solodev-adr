// Neon palette and glow helpers shared by every renderer.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export interface StyleTheme {
  fg?: (color: ThemeColor, text: string) => string;
  bg?: (color: Parameters<Theme["bg"]>[0], text: string) => string;
  bold?: (text: string) => string;
  italic?: (text: string) => string;
  underline?: (text: string) => string;
}

// TrueColor Neon Pink & Cyber Glow Palette with ANSI 256 fallback
export const NEON_PINK = "\x1b[38;2;255;113;206m";

 // Neon hot pink
export const NEON_CYAN = "\x1b[38;2;1;205;254m";

 // Neon electric cyan
export const NEON_GREEN = "\x1b[38;2;5;255;161m";

 // Neon emerald green
export const NEON_GOLD = "\x1b[38;2;255;211;25m";

 // Neon amber gold
export const NEON_CORAL = "\x1b[38;2;255;85;115m";

 // Neon coral red
export const NEON_VIOLET = "\x1b[38;2;185;103;255m";

 // Neon electric violet
export const GLOW_DIVIDER = "\x1b[38;2;130;70;170m";

 // Subtle glowing purple divider
export const ANSI_RESET = "\x1b[39m";

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
export function defaultFg(color: ThemeColor, text: string): string {
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

export function defaultBold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

export function defaultItalic(text: string): string {
  return `\x1b[3m${text}\x1b[23m`;
}

export function defaultUnderline(text: string): string {
  return `\x1b[4m${text}\x1b[24m`;
}

export function resolveTheme(theme?: StyleTheme): Required<StyleTheme> {
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
