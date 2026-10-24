# task-meta-capture (Codex plugin)

Metadata-only lifecycle capture for task-meta, for the Codex in the ChatGPT desktop app
("Codex & OWL", app 26.1016.x, `codex-cli 0.163.0-alpha`). It records _when_ tools ran, _how_
they ended and _where git HEAD was_, never _what_ the agent did or said.

## Mechanism (evidence from the installed app, 2026-10-23)

- Codex plugins live in `<marketplace>/<plugin>/.codex-plugin/plugin.json`; a marketplace is
  `<root>/.agents/plugins/marketplace.json` (`plugins[].source = {source:"local", path}`).
- A plugin manifest may declare `hooks` inline (`{"hooks": {"<Event>": [{"hooks": [handler]}]}}`);
  four bundled OpenAI plugins (browser, chrome, computer-use, unified-computer-use) already do.
  The runtime also reads `hooks/hooks.json` (string `plugin.json#hooks` / `hooks/hooks.json` in
  the binary). Handler types: `command` (`command`, `commandWindows`, `timeout`, `async`,
  `statusMessage`, `additionalContextLimit`) and `mcp_tool`.
- Events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, PreCompact,
  PostCompact, Stop (per turn), SessionEnd, SubagentStart, SubagentStop, Interrupt. The command
  handler receives a JSON object on stdin (`session_id`, `turn_id`, `cwd`, `model`,
  `permission_mode`, `transcript_path`, `hook_event_name`, tool events add `tool_name`,
  `tool_use_id`, `tool_input`, `tool_response`; Stop adds `last_assistant_message`).
- `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` environment variables are exported by the runtime.
- Hooks are subject to a trust step (`hooks.state."<key>".trusted_hash` in `config.toml`,
  `bypass_hook_trust` override): the owner must approve the plugin's hooks in the app once.
- The existing `notify = [program, ...]` in `config.toml` is a single program and is already
  used by another tool; this plugin does not touch it.

## What is captured

One JSON line per hook event, schema `task-meta/codex-hook/v1`, `agent: "codex"`:
ids (session, turn, tool call), tool name, model id, permission mode, `received_at` (plugin
clock), Bash/exec `input_class` (fixed enum, only when the tool input has a `command`), outcome
(`success` / `failure` from `exit_code` or `isError` / `interrupt`), integer `exit_code`,
`result_bytes`, `prompt_bytes`, `message_bytes` (Stop), `end_reason` (token or `OTHER`),
`cwd_digest` (SHA-256, never the path), `has_transcript` (boolean), and at SessionStart / Stop /
SessionEnd only: `git_head`, `git_dirty`, `git_remote_repo` (`owner/name`) via
`git -C <cwd> ...` with a 2 s timeout.

Since 0.2.0 (task binding + auto-report):
- `binding_refs` (UserPromptSubmit): normalized Issue/PR/repo references extracted in memory from
  the prompt; the prompt text itself is dropped.
- `worktree_refs` (SessionStart / Stop / SessionEnd): refs parsed from the cwd directory name and
  the current branch name, same helpers as the ZCode plugin (`plugins/shared`, built to
  `scripts/lib/*.cjs` by `npm run sync-plugins`).
- Stop / SessionEnd start `task-meta auto-report --agent codex --session <id> --trigger
  stop|session-end` detached, using `TASK_META_HOME` or the plugin-local `config.json`
  (`taskMetaHome`). Kill switch: `TASK_META_AUTO_REPORT=0` or `"enabled": false` in
  `config/auto-report.json`.

Since 0.2.3 (per-turn flood guard): Codex fires Stop at the end of every turn, so the spawned
auto-report is told what fired it. A `stop` run waits `settle_seconds` (default 180) for the
session to go quiet and defers to a later Stop if another turn starts; `session-end` publishes
at once; at most `max_revisions_per_session` (default 3) revisions are posted per session.

Since 0.2.4 (watcher): Codex on Windows kills the hook job object when the session exits, which
also kills an auto-report spawned from Stop/SessionEnd. SessionStart therefore starts
`auto-report --agent codex --session <id> --trigger watch` through WMI (`Win32_Process.Create`,
outside the job; elsewhere a detached spawn). The watcher polls the spool and reports on
SessionEnd or on a settled Stop. Stop/SessionEnd keep spawning a direct detached auto-report
(harmless duplicates: lock + idempotency). Extra stop switches for the WMI-created process (it does
not see `TASK_META_AUTO_REPORT=0`): `"enabled": false` or a file `<outbox>/STOP`.

## What is NOT captured

Prompts, assistant text, tool input and response, error messages, the working directory or
transcript path, instructions, reasoning. They are read from stdin only to measure sizes.

## Spool

`<home>/.task-meta/codex-spool/<sessionId>.jsonl` (override: `TASK_META_CODEX_SPOOL`). Each
line is `{"d":"<sha256 of JCS(e)>","e":{...}}`, append-only. The hook always exits 0, prints
nothing and logs only an error class name to `_errors.log`. Use it with
`task-meta collect-codex --codex-hook-spool <spool dir>`.

## Install / remove

```
codex plugin marketplace add <repo>/plugins/codex
```

then enable `task-meta-capture@dev-task-meta` in the app's plugin list and approve its hooks.
Requires `node` on the PATH of the hook process (the command is
`node -e "require(<plugin root>/scripts/run.cjs)"`, so it needs no shell variable expansion and
behaves the same under cmd, PowerShell and sh).

## Verified v0.3 desktop evidence vs still-unknown CLI behavior

The previous 2026-10-23 warning that **no live desktop activation was tested** is now
historical. Windows Codex desktop v0.3.0 **was** installed and all 7 hooks approved in
app, then emitted 5 verified events and a Stop→HELD Outbox with zero unauthorized POST
([actual Host receipt in Issue #46](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6383354474)).
SessionEnd also appeared but under a different Host session ID: **same-session SessionEnd
correlation remains NOT_QUALIFIED**, not PASS. This does not prove that the **Codex CLI**
loads these desktop plugin Hooks or supports the same trust command. Query the installed
`codex --help` / `codex plugin --help` first; if unsupported, record NOT_RUN instead
of replaying a fake Hook or editing trust hashes.

For future validation, read the canonical
[CLI-first Skill](../../../../.agents/skills/task-meta-agent-cli-validation/SKILL.md).
The desktop trust action is only a bounded fallback for app-only behavior; don't default
to GUI verification or overwrite user `~/.codex` preferences. Hook failures may write an
error class to `_errors.log`; the watcher on Windows is not proven by a single
`node scripts/run.cjs` fixture run.

To remove: disable/uninstall the plugin and delete the spool directory.
