### 4. pi-solo-radar — Architecture Decision Record (ADR) Ledger
for Solo Developers

When you work alone across wildly different technology stacks (legacy Notes 9 vs. Rust memory models vs. Android lifecycles), the biggest killer isn't writing code — it's context switching and forgetting why you did this or that 4 months ago.

- What it would do:
    - An extension that detects when you make an architectural pivot, solve a tricky legacy pitfall, or choose a specific workaround.
    - Automatically creates a draft of a 5-line Markdown ADR file in `.pi/decisions/YYYY-MM-DD-title.md` (Context, Decision, Consequences) without any effort.
    - When you return to the project months later, Pi reads the decision index and instantly knows your architectural constraints.
- Why it matters: It acts as your external memory, making your solo projects documented like the work of a ten-person engineering team, but without the corporate administrative overhead.

---

## Implementation Outline

### 1. Minimalist 5-Line ADR Schema
Store concise, human-readable markdown records under `.pi/decisions/`:

```markdown
# ADR-001: [Title]
- **Date:** YYYY-MM-DD
- **Context:** Why was this change needed? What problem or limitation triggered it?
- **Decision:** What specific approach or workaround was chosen?
- **Consequences:** What are the trade-offs, constraints, or follow-ups to remember?
```

### 2. Auto-Detection Trigger
- Trigger on commit messages or session wrap-ups containing keywords (`refactor`, `workaround`, `pivot`, `override`, `fix(legacy)`).
- Offer an interactive prompt: *"Would you like to record this decision in `.pi/decisions/`?"*

### 3. Context-Injection on Session Start
- On starting a Pi session, scan `.pi/decisions/` and summarize active constraints in system context so the agent never regresses or questions past architectural choices.

---

## Existing Open-Source Building Blocks & Prior Art

1. **AI Session + Git Diff Analyzers:**
   - **`dinogit/adr-gen`**: Specifically parses LLM coding agent conversation logs combined with `git log` / `git diff` to automatically generate MADR (Markdown Architecture Decision Record) documents.
2. **Agent-Context ADR Kits:**
   - **`manuelmauro/arkouda`** & **`rvdbreemen/adr-kit`**: Command-line utilities designed to bridge agent prompts with architectural decision records and keep context size bounded.
3. **Commit & Hook Integrations:**
   - **`YotpoLtd/cADR`**: Uses pre-commit and pipeline triggers to summarize changes into structured decision records before merging.

