# pi-solo-radar 📡

> Autonomous Architectural Decision Record (ADR) Ledger extension for the **Pi coding agent**.

```text
docs/adr/
├── .index.json                 # Lightweight fast index (titles, tags, constraints)
├── 2026-03-30-ADR-001-*.md     # 5-line MADR record
└── 2026-03-30-ADR-002-*.md
```

When you work alone across conflicting technology realms (legacy Lotus Notes 9, strict Rust lifecycles, Android SDK migrations, C FFI bridges), the biggest threat is **context switching and forgetting why a critical workaround was chosen 4 months ago.**

`pi-solo-radar` passively monitors coding sessions, generates 5-line MADR drafts upon detecting architectural pivots or legacy workarounds, and automatically injects bounded active constraints into subsequent Pi sessions.

---

## ⚡ Features

1. **Passive Change Detection at `agent_settled`**:
   - Detects triggers (`refactor`, `workaround`, `pivot`, `override`, `fix(legacy)`, `deprecated`, `breaking change`).
   - Generates a structured 5-line draft with zero disruption.
   - Prompts for human confirmation before writing to disk.

2. **Minimalist 5-Line MADR Schema**:
   - Stores standardized records under `docs/adr/` (standard MADR / GitHub location).
   - Concise format: Context, Decision, Consequences.

3. **Bounded Context Injection**:
   - Injects a compact summary of active architectural constraints into `before_agent_start`.
   - Zero linear prompt bloat: stays under bounded token ceilings while preventing architectural regression.

4. **Atomic Storage & Auto-Healing Index**:
   - Uses atomic file writes (`.tmp` + rename) to protect against unexpected termination.
   - Automatically heals or rebuilds `.index.json` if markdown files are created or modified manually.

---

## 📋 5-Line MADR Schema

All decisions adhere to this format in `docs/adr/YYYY-MM-DD-ADR-NNN-<slug>.md`:

```markdown
# ADR-001: Bridge Notes 9 C-API with Node N-API
- **Date:** 2026-03-30 14:22:10
- **Status:** active
- **Context:** Notes 9 C-API binary 32-bit only; modern runner runs 64-bit Node.
- **Decision:** Spawn isolated 32-bit IPC worker subprocess with named pipes.
- **Consequences:** Slight IPC overhead (~2ms); eliminates memory crash risk in main process.
```

---

## 🕹️ Command Surface & Agent Tools

### User Commands (`/adr`)

| Command | Description |
| --- | --- |
| `/adr list` | Interactive TUI directory explorer with live status indicators and selector. |
| `/adr show <id> [--read\|--raw]` | Display decision in clean Reading Mode (syntax stripped) or Syntax Highlighting. |
| `/adr new <title>` | Interactive wizard to manually draft and record a new ADR. |
| `/adr search <query>` | Fast keyword search across historical constraints and titles. |
| `/adr model [name]` | Configure or view the translation model (e.g. `openrouter/google/gemini-2.5-flash`). |
| `/adr status` | Report radar status, active constraints count, and storage paths. |
| `/adr help` | Display complete command and MADR schema reference. |

### 📖 Reading Mode, Syntax Highlighting & Czech Translation Loop

- **Clean Reading Mode (Default):** Strips raw markdown syntax elements (`#`, `**`, `` ` ``, bullets) and applies terminal typography (clean section headers, status badges, bullet glyphs).
- **Syntax Highlighting Mode:** Colorizes raw markdown tokens and MADR fields.
- **Interactive Toggles:**
  - **`m`** (or **`r`**): Toggle between Clean Reading Mode and Raw Syntax Highlighting Mode.
  - **`t`** (or **`l`**): Language translation loop — 1st press translates to Czech (`[🇨🇿 Čeština]`) via OpenRouter, 2nd press loops back to English original (`[🇬🇧 English]`). Instant response via memory cache.

### Autonomous Agent Tools (`LLM-Callable`)

- `record_adr({ title, context, decision, consequences, status })` — Allows the agent to autonomously record decisions upon your request.
- `search_adrs({ query })` — Allows the agent to query past constraints and historical doctrine.

---

## 📦 Installation & Usage

### 1. Project-Local Extension

Place `pi-solo-radar` inside your project:

```bash
git clone <repo> .pi/extensions/pi-solo-radar
```

### 2. Global Extension

Or install globally into your user Pi configuration:

```bash
cp -r . ~/.pi/agent/extensions/pi-solo-radar
```

### 3. Verification & Build

```bash
npm install
npm run build
npm test
```

---

## 🛡️ Architectural Doctrine (Sith Protocol)

- **Zero fluff:** Zero external runtime dependencies; uses Node.js standard built-ins (`node:fs/promises`, `node:path`, `node:crypto`).
- **Cross-platform:** Tested on Windows, Linux, and macOS.
