# TODO: Subproject Root Auto-Discovery & Targeted ADR Routing

## Problem

When Pi coding agent runs in a parent directory (e.g. `D:/01_programovani/pi/plugins/`) while editing an individual subproject/plugin (e.g. `pi-solodev-adr/`), `ctx.cwd` defaults to the parent folder. ADRs are consequently saved into `plugins/docs/adr/` instead of the edited subproject's repository (`pi-solodev-adr/docs/adr/`).

## Planned Solution

1. **Nearest Project Boundary Detection:**
   - Implement `findProjectRoot(editedFiles, cwd)` in `src/ledger.ts`.
   - Scan upward from modified files for project markers (`.git`, `package.json`, `Cargo.toml`, `docs/adr`).
2. **Dynamic Ledger Routing:**
   - Route ADR generation and storage (`saveRecord`, `agent_settled`, `record_adr`) to the detected subproject root instead of parent `ctx.cwd`.
   - Fall back to `ctx.cwd` only when no subproject boundary is detected.
3. **Migration Helper:**
   - Command or auto-check to move ADRs placed in parent root to target subprojects.
