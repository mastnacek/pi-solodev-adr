// pi-solodev-adr — composition root.
//
// Config cascade (lowest priority first):
//   defaults <- ~/.pi/agent/pi-solodev-adr.json <- <cwd>/.pi/pi-solodev-adr.json
// `--global` writes the global layer; without it the project layer is written.

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  handleHelp,
  handleList,
  handleModel,
  handleNew,
  handleRouting,
  handleSearch,
  handleShow,
  handleStatus,
} from "./src/command.js";
import { getCompletions } from "./src/completions.js";
import { setConfigCwd } from "./src/config.js";
import {
  handleAgentSettled,
  handleBeforeAgentStart,
  handleSessionStart,
} from "./src/session.js";
import { invalidateCache } from "./src/state.js";
import { registerTools } from "./src/tools.js";

/** Re-exported for tests and external callers. */
export { extractTouchedFiles } from "./src/session.js";

export default function (pi: ExtensionAPI): void {
  /** Unsubscribers from every `pi.on()`; drained on session_shutdown (AGENTS §5). */
  const unsubscribers: Array<() => void> = [];

  /** Retain a `pi.on()` return value; older engine typings declare it void. */
  const track = (result: unknown): void => {
    if (typeof result === "function") unsubscribers.push(result as () => void);
  };

  // Lifecycle hooks
  track(pi.on("session_start", (_event, ctx) => {
    // Point the config cascade at this session's project layer.
    setConfigCwd(ctx.cwd);
    handleSessionStart(ctx);
  }));
  track(pi.on("before_agent_start", (event, ctx) =>
    handleBeforeAgentStart(event.systemPrompt, ctx.cwd),
  ));
  track(pi.on("agent_settled", (_event, ctx) => handleAgentSettled(ctx)));
  // Drop the session-scoped index cache on shutdown (AGENTS.md §5/§6);
  // it is rebuilt lazily on the next session_start.
  pi.on("session_shutdown", () => {
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
    invalidateCache();
  });

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
      const rawTokens = args.trim().split(/\s+/).filter(Boolean);
      const isGlobal = rawTokens.some((t) => t.toLowerCase() === "--global");
      const tokens = rawTokens.filter((t) => t.toLowerCase() !== "--global");
      const [subcommand = "list", ...rest] = tokens;
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
          await handleModel(remainder, ctx, isGlobal);
          break;
        case "routing":
          await handleRouting(remainder, ctx, isGlobal);
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
