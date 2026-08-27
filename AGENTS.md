**`pi-solo-radar`** — an autonomous Architectural Decision Record (ADR) Ledger extension for the **Pi coding agent**.

`pi-solo-radar` acts as the external cybernetic cortex of the solo engineer:

1. **Passively monitors** coding transcripts and git milestones for architectural pivots, legacy workarounds, and structural overrides.
2. **Generates concise 5-line MADR drafts** without interrupting flow.
3. **Injects bounded architectural constraints** into subsequent Pi sessions so the agent never regresses or questions established doctrine.

---

## 3. Inviolable Architectural Doctrine

### 3.1 The 5-Line MADR Schema

All decisions MUST adhere to the minimalist format under `.pi/decisions/`:

```markdown
# ADR-NNN: [Title]
- **Date:** YYYY-MM-DD HH:mm:ss
- **Context:** Why was this change needed? What limitation or pitfall triggered it?
- **Decision:** What specific approach, pivot, or workaround was chosen?
- **Consequences:** What are the trade-offs, constraints, or follow-ups to remember?
```

- **Rule:** No 10-page bureaucratic essays. If a decision cannot be expressed in 5 lines, it is over-engineered.

### 3.2 Detection Timing: Strike at `agent_settled`

- **Do not wait for git commits.** Commits are post-mortem and detached from the transcript's reasoning.
- **Trigger at `agent_settled`:** When the agent finishes a substantive task containing architectural changes, evaluate whether an ADR candidate exists.
- **Human-in-the-Loop Confirmation:** Present a prompt (`ctx.ui.select` or notification) offering to record the draft. Never pollute `.pi/decisions/` with unconfirmed automated noise.

### 3.3 Context Injection: Bounded Recall Over Linear Bloat

- **Never linearly dump** the entire `.pi/decisions/` directory into the system prompt on every session. That is an amateur's path to context exhaustion.
- **Maintain a lightweight index** (`.pi/decisions/.index.json`) tracking active ADR titles and key constraints.
- **On `session_start`:** Inject a concise bullet list of active architectural constraints.
- **On demand:** Enable semantic lookup via `/adr search <query>` or integration with Pi's knowledge base.

---

## 4. Implementation Directives for Implementing Agents

When tasked with developing or extending `pi-solo-radar`, adhere to this exact structural blueprint:

### 4.1 Project Layout

```text
pi-solo-radar/
├── index.ts               # Extension entrypoint (lifecycle hooks & /adr commands)
├── src/
│   ├── detector.ts        # Heuristic & LLM-based architectural change detector
│   ├── ledger.ts          # File I/O, atomic storage, indexing under .pi/decisions/
│   ├── injector.ts        # Context synthesizer for session_start
│   └── types.ts           # ADR interfaces and configuration schemas
├── package.json           # Extension manifest with peerDependencies
├── tsconfig.json          # Strict TypeScript configuration
└── README.md              # Clear command reference and documentation
```

### 4.2 Extension Hook Architecture

1. **`session_start`**:
   - Read `.pi/decisions/`.
   - Synthesize active constraints and inject into agent context (or register dynamic prompt guidance).
2. **`agent_settled`**:
   - Inspect the recent exchange for decision triggers:
     - Keywords: `refactor`, `workaround`, `pivot`, `override`, `fix(legacy)`, `deprecated`, `breaking`.
     - File structural changes (new module, framework swap, API redefinition).
   - If an architectural shift is detected, construct an ADR draft and offer one-click confirmation to the user.
3. **`session_shutdown`**:
   - Ensure index consistency and flush unwritten caches.

### 4.3 Command Surface: `/adr`

The extension must register the `/adr` command with full completion support:

- `/adr list` — View all active decision records and their statuses.
- `/adr new <title>` — Manually draft a new ADR.
- `/adr show <id>` — Display a specific record.
- `/adr search <term>` — Fast keyword search across historical constraints.
- `/adr status` — Report active radar status and tracked decisions count.

---

## 5. Coding Standards & Execution Rules

1. **Zero Fluff:** Write terse, robust, production-grade TypeScript. Do not introduce bloated external NPM dependencies when Node.js built-ins (`node:fs/promises`, `node:path`, `node:crypto`) suffice.
2. **Atomic Storage:** Use atomic file writes (write to `.tmp` then rename) for all records and `.index.json` to prevent corruption on sudden shutdowns.
3. **Cross-Platform Supremacy:** Ensure seamless operation on Windows, Linux, and macOS. Respect native path separators and file encodings (always UTF-8).
4. **Git Discipline:** Treat repository state with respect. Branch cleanly, verify diagnostics proactively, and keep commits sharp and informative.

---

*“You have failed me for the last time, Architectural Amnesia. Execute the protocol.”*
