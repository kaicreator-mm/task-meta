# task-meta v0.2 — definition and Task DAG

Status: **FROZEN for v0.2 implementation by user instruction (2026-10-23)**. Builds on
v0.1.0 (`docs/v0.1/DEFINITION.md`). Issues: #2, #8, #15, #16 (+ new auto-report scope).

## 1. Decisions (project owner, 2026-10-23)

1. **ADS v4.16 is the effective profile now.** `ads/github/v5` from
   `version/v4.16@3041a1be3f130e5cc5e676c2e56a99882adfd97c` (schema blob `7478313c…`) is
   adopted for all repositories by **project-owner authorization**: the normative spec is
   complete; remaining ADS work is testing. Recorded in `config/ads-adoption.json` as an
   `owner_authorized` entry; default profile becomes v5. Every report carries the public limit
   `ADS v4.16 adopted from version/v4.16@3041a1b by project-owner authorization; not ADS-main qualified`.
   v4 stays selectable with `--profile v4`. When ADS merges v4.16 to `main`, the main SHA
   replaces the candidate pin (same schema blob ⇒ no wire change).
2. **Every agent task is reported automatically.** At session end the capture plugin starts
   `task-meta auto-report` in the background: bind the session to repository + Issue, collect,
   publish one ADS `EXECUTION_SUMMARY` to that Issue, read back. No manual step.
3. **Same moment as the agent's own write-back.** Agents are told to write results back to the
   Issue at the end of the task. task-meta does not rewrite or merge into that comment (it is the
   agent's own content); its report is published right after the session ends to the same Issue
   and cites the agent's write-back comment(s) made during the session in `source_refs`
   (`github:comment:<id>`), found by readback of comments created in the session window.
4. **Codex** is the ChatGPT desktop app's Codex ("Codex & OWL", app 26.1016.62342). Adapter
   reads `~/.codex/sessions`; a capture hook/plugin is built if Codex exposes one (owner installs
   it into ChatGPT); the Codex CLI may be installed for headless real runs.
5. **#16 golden set** is built from this v0.2 development itself (real Claude Code / ZCode / Codex
   sessions), metadata only, two independent labelers, owner adjudicates disagreements.

## 2. Task binding (new contract)

`TaskBinding` (`src/model.ts`): `{ repository, issue_number, pr_number, state: RESOLVED |
AMBIGUOUS | UNRESOLVED, evidence: BindingEvidence[] }`. Evidence sources, each with
`kind`, `value`, `epistemic`:

| Source | Example | Strength |
| --- | --- | --- |
| Prompt refs (extracted in memory at UserPromptSubmit; prompt text never stored) | `domain-harness v0.10.1 #1296`, `PR #1298`, `kaicreator-mm/x#12`, issue URLs | primary |
| Worktree / branch name (workspace convention `<repo>-i<issue>-<agent>`, `task/<name>`) | `dh-i1296-zcode` → domain-harness #1296 | primary |
| Git remote of the session cwd | `github.com/kaicreator-mm/domain-harness` | repository only |
| Repo aliases (`config/repo-aliases.json`, e.g. `dh` → `domain-harness`) | | resolver input |

Rules: repository must be a known `kaicreator-mm/*` repo (inventory cached from `gh`); prompt
and worktree agree ⇒ RESOLVED; only one source ⇒ RESOLVED if unambiguous; conflicting issue
numbers or several candidate issues with no tie-break ⇒ AMBIGUOUS ⇒ **not published**, HELD
locally with reason. A PR ref binds `pr_number`; the report goes to the Issue (ADS `issue_ref`
must be an Issue); PR-only tasks resolve the Issue via the PR's closing/linked refs, else HELD.

## 3. Plugins capture more metadata (still no content)

All capture plugins add: `git_head` + `git_dirty` at SessionStart and Stop (from the session
cwd via `git rev-parse HEAD` / `git status --porcelain`, 2 s timeout; cwd itself never stored),
`git_remote_repo` (`owner/name` only), and a `binding` entry (extracted refs only). These replace
run.txt for UI sessions: `source_sha` = Stop `git_head`, `head_before` = SessionStart `git_head`.

## 4. Auto-report pipeline

`task-meta auto-report --agent zcode|claude|codex --session <id>` (detached, idempotent):
binding → artifacts (agent rollout/transcript, hook spool, git heads) → collect → store →
v5 report → publish (clearance `config/auto-report.json` `clearance_ref`) → readback.
Outcomes and failures go to a local outbox `~/.task-meta/outbox/` (append-only); `task-meta
auto-report --retry` re-drives HELD/failed ones. Never blocks or slows the agent; never posts
more than one report per (Issue, session, revision). Kill switch: `config/auto-report.json`
`enabled:false` or env `TASK_META_AUTO_REPORT=0`. Verifier: gate logs found by convention are
used; otherwise verifier NOT_RUN (honest).

## 5. Scope / Task DAG

| Task | Issue | Delivers | Depends |
| --- | --- | --- | --- |
| V2-0 | — | this doc, `TaskBinding` types (controller) | — |
| T13 | new | binding resolver + shared plugin helpers + ZCode plugin 0.2.0 (binding, git heads, Stop trigger) | V2-0 |
| T16 | #2 | Codex adapter (`~/.codex/sessions`) + capture hook/plugin if supported | V2-0 |
| T14 | new | auto-report pipeline, outbox/retry, owner-authorized v5 default, write-back citation | T13 |
| T17 | #15 | branch DAG across attempts of one Issue | V2-0 |
| T15 | #2 | Claude Code adapter (transcripts) + Claude Code plugin with auto-report | T13, T14 |
| T18 | #8 | live fault injection on `kaicreator-mm/task-meta-e2e` (lost ACK, concurrent duplicate, edited comment, pagination) | T14 |
| T19 | #16 | golden set from v0.2 dev sessions, 2 independent labelers, agreement, owner adjudication | T13–T16 data |
| E2E | all | real runs: ZCode + Claude Code + Codex tasks auto-reported to their Issues | all |

Not in v0.2: Tally reader leg (#8/#14), #7, #9, #17 publication (ADS field), billed cost.

## 6. Acceptance

1. A real task in each of ZCode, Claude Code and Codex, started with a normal prompt naming the
   project/Issue, ends with an ADS v5 report on that Issue **without any manual task-meta step**;
   readback digest equal; rerun of auto-report is idempotent.
2. Ambiguous/unknown binding is HELD, never mis-posted; kill switch works.
3. Fault injection on the test repo: lost ACK, concurrent duplicate, edited comment ⇒ no
   duplicate report, CONFLICT surfaced.
4. Golden set: agreement and confusion matrix published in the repo; owner adjudication done.
5. `tools/task-check.sh` 全绿.

## 7. T13 status (binding resolver + ZCode plugin 0.2.0)

Delivered on `task/tm-t13-sonnet`:
- `plugins/shared/binding-extract.mjs` (`extractRefs`, `parseWorktreeName`) and `git-meta.mjs`
  (`gitInfo`, 2 s per call / 3.5 s total budget); copied into plugins by `npm run sync-plugins`
  (also copies `config/repo-aliases.json`); a test fails the gate on drift.
- `src/binding/index.ts`: `resolveBinding`, `loadRepoInventory`. A bare `REPO` mention in the prompt
  is weak: it binds the repository only when no prompt ref, worktree, branch or remote names one.
  Git remotes outside `kaicreator-mm/*` are ignored with a reason.
- ZCode plugin 0.2.0: `binding_refs` (UserPromptSubmit), `git_head`/`git_dirty`/`git_remote_repo`/
  `worktree_refs` (SessionStart, Stop); Stop spawns `node <TASK_META_HOME|config.json>/src/cli.ts
  auto-report --agent zcode --session <id>` detached (`TASK_META_AUTO_REPORT=0` disables).
- Ingestion: without run.txt, run segments derive from Stop/SessionStart git heads;
  `bindingInputFromSpool(entries)` feeds the resolver.
T14 must implement the `auto-report` command and PR-to-Issue resolution; the spawned CLI path is
`src/cli.ts` run with the hook's `node` (needs Node >= 24 for native TypeScript).

## 8. T14 status (auto-report, owner-authorized v5 default)

Delivered on `task/tm-t14-sonnet`:
- `config/ads-adoption.json` `owner_authorized`: `resolveProfile` with no profile returns v5 pinned to
  the candidate, mode `OWNER_AUTHORIZED` (publish allowed for any repository, schema blob checked);
  an `adopted` main entry still wins; `--profile v4` still works. Reports carry the public owner limit
  (`collect` too; the E2E test-subject limit is kept for that mode only).
- `src/collect-core.ts`: evidence assembly / store persistence shared by `collect` and `auto-report`.
- `task-meta auto-report --agent zcode --session <id> [--spool-dir --rollout-dir --store --outbox
  --config --dry-run]` and `auto-report --retry` (`src/autoreport/*`). Exit 0 for every outcome
  (usage errors exit 2); `--dry-run` posts nothing and writes no outbox line.
  - Reads `<spool_dir>/<id>.jsonl` (waits up to 5 s for the Stop line), binds with `resolveBinding`.
    PR-only: `gh api graphql` `closingIssuesReferences`, else same-repo `#n` refs of the PR title/body;
    exactly one Issue => RESOLVED (evidence `PROMPT_REF`, reason `pr-linked-issue`), else HELD.
    AMBIGUOUS/UNRESOLVED => HELD (outbox entry with reasons, nothing posted).
  - Collects spool + optional `model-io-<id>.jsonl`; no run.txt (git-head derived segments) and no
    headless result are fine (`collectZcodeRun` needs at least one of headless / model-io / spool).
  - Gate logs by convention: `<gate_log_root>/<worktree>/gate*.log` (default root
    `C:/xDev/kAiCreator/_tmp`) where the directory name parses to an Issue ref also carried by the
    session's worktree refs and the newest log contains `GATE_SUBJECT_SHA` or `EXIT=`; otherwise
    verifier `NOT_RUN`.
  - Write-back citation: Issue comments created between SessionStart and last Stop + 10 min that
    are not ADS reports are cited as `github:comment:<id>` (latest five) plus the limit
    `agent write-back comments cited: N`; no comment content is read into the report.
  - Revisions: unchanged data => same report (`ALREADY_PUBLISHED`); changed data => revision N+1 with
    `supersedes` {revision, data_digest, comment_ref} of the predecessor found by readback, else HELD
    (store not advanced). Report revision == store manifest revision.
  - Outbox `<outbox>/<YYYY-MM-DD>.jsonl` (`Spool` format) with states PUBLISHED, ALREADY_PUBLISHED,
    HELD, FAILED, DISABLED, ALREADY_RUNNING; per-session lock `<outbox>/locks/<id>.lock`
    (stale after 15 min). `--retry` re-drives the latest HELD/FAILED entry per session.
