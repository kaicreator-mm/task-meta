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
- Stop / SessionEnd start `task-meta auto-report --agent codex --session <id>` detached, using
  `TASK_META_HOME` or the plugin-local `config.json` (`taskMetaHome`). Kill switch:
  `TASK_META_AUTO_REPORT=0` or `"enabled": false` in `config/auto-report.json`.

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

Not verified on the live app (the implementer must not modify `~/.codex`): that the desktop
build substitutes/exports the plugin root for plugin hook commands exactly as above, that it
fires SessionEnd, and that `node` is on the hook PATH. After installing, run one short task and
check that a `<sessionId>.jsonl` appears in the spool; an empty spool plus `_errors.log` means a
host-side problem, not a task-meta one.

To remove: disable/uninstall the plugin and delete the spool directory.
