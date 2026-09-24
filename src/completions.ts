// Argument completion for /adr, including the `--global` prefix.
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { getAvailableModels } from "./config.js";
import { getConfigDir, getOrLoadIndex } from "./state.js";

export const SUBCOMMANDS = [
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

/** `--global` row offered at the first level. */
const GLOBAL_ROW: AutocompleteItem = {
  value: "--global ",
  label: "--global",
  description: "Uložit následující nastavení globálně (~/.pi/agent/)",
};

export async function getCompletions(
  prefix: string,
): Promise<AutocompleteItem[] | null> {
  // `--global` prefix: complete the remainder, then re-prefix the suggestions.
  const trimmed = prefix.trimStart();
  if (trimmed.startsWith("--global")) {
    const afterGlobal = trimmed.slice(8).trimStart();
    const hasTrailingSpace = trimmed.length > 8 || /\s$/.test(prefix);
    if (!hasTrailingSpace && afterGlobal === "") return [GLOBAL_ROW];
    const sub = await getCompletions(afterGlobal);
    if (!sub) return null;
    const out: AutocompleteItem[] = [];
    for (const item of sub) {
      if (item.label === "--global") continue;
      out.push({
        value: `--global ${item.value}`,
        label: item.label,
        description: item.description,
      });
    }
    return out.length > 0 ? out : null;
  }

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
  const NON_TERMINAL = new Set(["new", "show", "search", "model", "routing"]);
  const items: AutocompleteItem[] = [];
  if ("--global".startsWith(typed)) items.push(GLOBAL_ROW);
  for (const cmd of SUBCOMMANDS) {
    if (cmd.value.toLowerCase().startsWith(typed)) {
      items.push({
        value: NON_TERMINAL.has(cmd.value) ? `${cmd.value} ` : cmd.value,
        label: cmd.label,
        description: cmd.description,
      });
    }
  }

  return items.length > 0 ? items : null;
}
