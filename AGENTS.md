# task-meta — agent rules

- Read the frozen Product/L2 for the **requested version** before work: `docs/v0.1/DEFINITION.md` is only the v0.1 baseline, while `docs/v0.3/PRD_R0_CANDIDATE.md` and `docs/v0.3/L2_ARCHITECTURE_EVIDENCE_R0.md` describe the completed v0.3 scope. Never confuse prior definitions with current project-wide authority or widen scope without a new Task.
- Node 24 (`.node-version`), TypeScript run directly by Node type stripping: only erasable
  syntax (no enums, namespaces, parameter properties); relative imports end in `.ts`.
- Gate: `npm run lint && npm run typecheck && npm test` (the workspace `tools/task-check.sh`
  runs exactly these). Format with `npx biome check --write .` before committing.
- Tests: `node:test` + `node:assert/strict`, files `test/**/*.test.ts`, fixtures under
  `test/fixtures/`. Fixtures are synthetic or sanitized — never copy real prompts, model
  text, tool arguments, headers, tokens or absolute user paths into the repo.
- `vendor/ads/**` is byte-identical upstream source: never edit (see `vendor/ads/PINS.md`).
- `src/model.ts` and `src/canonical.ts` are shared contracts; change them only if the task
  says so.
- Dependencies are pinned in `package-lock.json`; do not add packages unless the task says so.
- Never call the live GitHub API from tests.

## Agent plugin validation: CLI-first (post-v0.3 rule)

- For all future Codex, Claude Code and ZCode `task-meta-capture` development, regression, investigation and qualification, **start with Node 24 + CLI**. Read `.agents/skills/task-meta-agent-cli-validation/SKILL.md` before choosing commands or asking for desktop UI actions. Claude Code also discovers `.claude/skills/task-meta-agent-cli-validation/SKILL.md`; ZCode may import the canonical Codex skill via Settings > Skills (symlink to avoid copy drift).
- Distinguish **SOURCE_ONLY** (static/manifests/tests), **HOOK_FIXTURE** (direct hook process with fake stdin), **REAL_AGENT_CLI** (actual installed Agent process auto-fires hooks), **REAL_HOST_GITHUB** (actual authenticated publisher and native readback), and **DESKTOP_ONLY** (UI-specific consent/trust). No substitution between these levels. CLI flags/subcommands unsupported or not checked with `--help` are `UNKNOWN/NOT_RUN`, not invented.
- Prefer actual CLI plugin discovery, validation, installation/update, a bounded real task, exact session IDs, `plugin_version`, private Spool line/digest, Stop/SessionEnd->auto-report/outbox, privacy and fail-closed native GitHub admission. Never require desktop UI by default. Use UI only for a demonstrated UI-only feature, such as one-time hook trust/desktop activation; log the narrow waiver and do not call a desktop result CLI PASS.
- Existing fixed v0.3.0 evidence: main `9731b03e263527e15ae24815a7e26b45e4dd809a` is released; Codex **desktop** 0.3.0 7/7 trusted Hooks, five-line Spool and Stop->HELD outbox are proven in [Issue #46](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6383354474). Codex same-session SessionEnd correlation is **NOT_QUALIFIED**; actual Codex CLI plugin autoactivation must be verified independently. Claude CLI and ZCode headless real captures are evidenced at PR #54; re-check the target host/version before reuse.
- Before tests use clean exact SHA, record OS/Node/Agent CLI/plugin versions, real commands and exit codes. Use isolated GitHub test Issue with explicit permission, render dry-run/private first, no ordinary-project test posts or credentials/prompt/raw trace in public artifacts. `HELD` or `UNKNOWN` is not a failed privacy gate; absent facts are not PASS.
- Do not change a frozen/released v0.3 source tree or `vendor/ads/**` merely to update operating knowledge; use a separate docs/skill PR with independent exact-SHA review. New feature implementations still require their own Product/L2/DAG/Issue admission. Remote CI unavailable -> explicitly scoped waiver/NOT_RUN, never CI PASS.

## v0.4 source-only Doctor integration

- Repository-only read-only CLI: `node src/cli.ts doctor --catalog` lists A1's canonical typed rules; `node src/cli.ts doctor --input <preclassified-evidence.json>` classifies supplied **preclassified** evidence. The input path is read locally only, never sent to GitHub. Identifiers/paths/credential names are replaced by opaque refs before output; no secrets or raw Hook logs are printed.
- `PRECLASSIFIED_EVIDENCE_ONLY` / `SOURCE_ONLY` is **not** a real Agent/Host/repository scan. Missing fields remain unknown; neither a healthy live capture nor publication permission is inferred. Do not treat this as a replacement for #81's proposed real capture-health intake.
- I #73 integrates A1/B2/C1/C2/E without changing their exclusive owner modules; real installed Agent CLI and exact-release-candidate Hook ON/OFF remain separate Host tasks (R #74 qualification), and the C2 baseline alone is never candidate PASS.
