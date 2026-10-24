# task-meta-capture (Claude Code plugin)

Metadata-only lifecycle capture for [task-meta](../../../docs/v0.2/DEFINITION.md). It records
_when_ tools ran and _how they ended_, the git heads at session boundaries and the Issue/PR
references named in the prompt, never _what_ the agent did or said.

## What is captured

One JSON line per hook event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
PostToolUseFailure, Stop, SubagentStop, SessionEnd, PreCompact, Notification), schema
`task-meta/claude-hook/v1`:
- ids: session, subagent (`agent_id`), tool call (`tool_use_id`); tool name; permission mode
- `received_at` (plugin clock); PostToolUse/PostToolUseFailure `duration_ms` as reported by Claude
  Code (tool execution only)
- Bash only: `input_class`, a fixed enum (TEST, TYPECHECK_LINT, BUILD, DEPENDENCY, VCS,
  READ_SEARCH, FILE_WRITE, OTHER) derived from the command; the command text is dropped
- outcome (`success` / `failure` / `interrupt`), response size in bytes
- SessionStart: source and model id; SessionEnd: reason (fixed token); UserPromptSubmit: prompt
  size in bytes and `binding_refs` (normalized Issue/PR/repo references extracted in memory)
- SessionStart / Stop: `git_head`, `git_dirty`, `git_remote_repo` (`owner/name` only) and
  `worktree_refs` (refs parsed from the cwd directory name and branch name), via
  `git -C <cwd> ...` with a 2 s timeout per call
- SessionEnd: `git_head` and `git_dirty` only, with a hard ~0.9 s ceiling (Claude Code cuts
  SessionEnd hooks off after 1.5 s)
- `cwd_digest`: SHA-256 of the working directory (never the path)

## What is NOT captured

Prompt text, tool input and response, error messages, `last_assistant_message`, the
`transcript_path`, the working directory path, session title, notification text. The script reads
them from stdin only to measure sizes or extract references and then discards them. The transcript
location is not recorded: the task-meta adapter finds it by session id under `~/.claude/projects`.

## Spool

`<home>/.task-meta/claude-spool/<sessionId>.jsonl` (override: `TASK_META_CLAUDE_SPOOL`). Each line
is `{"d":"<sha256 of JCS(e)>","e":{...}}`, append-only. The hook always exits 0, prints nothing
and logs only an error class name to `_errors.log`. Use it with
`task-meta collect-claude --claude-hook-spool <spool dir>`.

## Auto-report

Stop and SessionEnd start `task-meta auto-report --agent claude --session <id> --trigger
stop|session-end` detached, using `TASK_META_HOME` or the plugin-local `config.json`
(`taskMetaHome`). Claude Code fires Stop after every turn, so a `stop` run waits
`settle_seconds` (default 180) for the session to go quiet and defers to a later Stop if another
turn starts; `session-end` publishes at once; at most `max_revisions_per_session` (default 3)
revisions are posted per session, after which only a session end or `auto-report --retry` may
post one final revision. Kill switch: `TASK_META_AUTO_REPORT=0` or `"enabled": false` in
`config/auto-report.json`.

## Install / remove

Add `plugins/claude` as a local marketplace (`claude plugin marketplace add <path>`, market
`dev-task-meta`), then `claude plugin install task-meta-capture@dev-task-meta`. Validate the
package with `claude plugin validate plugins/claude/task-meta-capture`. The hooks use the exec form
(`command: node`, `args: [...]`), so no shell quoting is involved on Windows.
To remove: `claude plugin uninstall task-meta-capture` and delete the spool directory.

## v0.3+ reusable CLI acceptance

Use the canonical
[task-meta-agent-cli-validation Skill](../../../.agents/skills/task-meta-agent-cli-validation/SKILL.md)
for verified commands, version/currentness, real headless Claude Code vs synthetic
Hook fixtures, `SessionEnd` deadlines, Stop settle, Outbox privacy and GitHub permissions.
The real Windows 0.3.0 Hook capture was independently witnessed at
[PR #54](https://github.com/kaicreator-mm/task-meta/pull/54#issuecomment-6382732452),
but the corresponding model request hit an expired OAuth login; it is a **Hook PASS**,
not a successful Claude model-run claim. First check `claude plugin --help` on a new Host.
