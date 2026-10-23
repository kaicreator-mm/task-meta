# task-meta-capture (ZCode plugin)

Metadata-only lifecycle capture for [task-meta](../../../docs/v0.1/DEFINITION.md). It records
_when_ tools ran and _how they ended_, never _what_ they did or said.

## What is captured

One JSON line per hook event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
PostToolUseFailure, Stop), schema `task-meta/zcode-hook/v1`:
- ids: session, turn, trace, tool call; agent name; tool name; mode
- timestamps: the hook's own `timestamp` and the plugin clock (`received_at`)
- Bash only: `input_class`, a fixed enum (TEST, TYPECHECK_LINT, BUILD, DEPENDENCY, VCS,
  READ_SEARCH, FILE_WRITE, OTHER) derived from the command; the command text is dropped
- outcome (`success` / `failure` / `interrupt`), error type (name only), result size in bytes
- Stop: tool call count; SessionStart: source and model id; UserPromptSubmit: prompt size in bytes
- `cwd_digest`: SHA-256 of the working directory (never the path)

## Auto-report (0.2.x)

Stop starts `task-meta auto-report --agent zcode --session <id> --trigger stop` detached
(`TASK_META_HOME` or the plugin-local `config.json`; kill switch `TASK_META_AUTO_REPORT=0`).
Since 0.2.2 the run waits `settle_seconds` (default 180) for the session to go quiet and defers to
a later Stop if another turn starts, so a multi-turn session does not post one report per turn
(`max_revisions_per_session`, default 3).

## What is NOT captured

Tool input and response, result preview, prompts, attachments, model text (responseText,
responsePreview), error messages, the working directory path, permission suggestions, the
transcript. The script reads them from stdin only to measure sizes and then discards them.

## Spool

`<home>/.task-meta/zcode-spool/<sessionId>.jsonl` (override with `TASK_META_ZCODE_SPOOL`).
Each line is `{"d":"<sha256 of JCS(e)>","e":{...}}`, append-only. Failures never reach the agent:
the hook always exits 0, prints nothing, and only an error class name is appended to
`_errors.log` in the spool directory.

Use it with `collect --zcode-hook-spool <spool dir>`.

## Install / remove

Add `plugins/zcode/marketplace.json` (market `dev-task-meta`) as a local marketplace in the
ZCode UI, then install and enable `task-meta-capture`. If no spool appears, check that hooks are enabled in ZCode (its built-in default config has `hooks.enabled=false`).
To remove: disable/uninstall the plugin in the UI and delete the spool directory.
