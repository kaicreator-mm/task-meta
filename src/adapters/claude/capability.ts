import type { SourceCapabilityProfile } from "../../model.ts";

/** Honest capability matrix of the Claude Code transcript adapter. */
export const CLAUDE_CAPABILITY: SourceCapabilityProfile = {
  adapter_id: "claude",
  adapter_version: "0.1.0",
  provider: "claude-code",
  provider_version: null,
  signals: {
    model_requests: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "One request per distinct assistant message.id (repeated lines of one API response are folded). Client-side `<synthetic>` placeholders are not requests. Subagent (sidechain) requests are included once and counted in subagent_requests.",
    },
    token_usage: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "Per-message `usage`. Anthropic `input_tokens` EXCLUDES cache reads/writes, unlike ZCode and Codex; task-meta normalizes to its inclusive convention: input_tokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens (exact sum of the three reported counters). output_tokens INCLUDES thinking tokens; total = inclusive input + output.",
    },
    cache_tokens: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "cache_read_tokens = cache_read_input_tokens; cache_write_tokens = cache_creation_input_tokens (5m and 1h tiers summed).",
    },
    reasoning_tokens: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "usage.output_tokens_details.thinking_tokens (a subset of output_tokens) when the transcript exposes it; UNKNOWN (never 0) for responses or versions without it.",
    },
    tool_calls: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "assistant `tool_use` blocks (id, name); tool input is dropped. Main-chain and subagent calls are both counted once per tool_use id.",
    },
    tool_input_class: {
      supported: false,
      epistemic: "UNKNOWN",
      notes:
        "Only available for Bash from the capture plugin's PreToolUse entry (command text is never stored).",
    },
    tool_timing: {
      supported: true,
      epistemic: "INFERRED",
      notes:
        "Transcript timestamps of the tool_use and tool_result lines (includes streaming and permission wait). With the capture plugin, PostToolUse `duration_ms` (tool execution only) is used instead.",
    },
    tool_outcome: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "tool_result `is_error`; permission denials are reported as `denied`; hook outcome `interrupt` from the capture plugin. No output text.",
    },
    experience_exposure: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "Claude Code does not expose which experience/recommendations were shown.",
    },
    billed_cost: {
      supported: false,
      epistemic: "UNKNOWN",
      notes:
        "Subscription plan; the transcript's cost-state estimates are not billed cost and are never read.",
    },
    run_boundary: {
      supported: true,
      epistemic: "INFERRED",
      notes:
        "A turn runs from a human prompt line to the last main-chain assistant/tool_result line before the next prompt (transcript timestamps).",
    },
    source_head: {
      supported: true,
      epistemic: "INFERRED",
      notes:
        "The transcript carries no commit; HEAD at the start and end of the session needs the capture plugin's SessionStart and Stop/SessionEnd entries.",
    },
    verifier: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "Only from an independent gate log; never from agent text.",
    },
  },
  clock: {
    domain: "Claude Code host clock (transcript line write time)",
    precision: "ms",
  },
  known_gaps: [
    "no per-request start/end times; model_wall_ms is UNKNOWN",
    "no billed cost; cost is UNKNOWN",
    "tool timing from transcript timestamps includes streaming and permission wait unless the capture plugin supplied duration_ms",
    "bash command classes need the capture plugin (command text is never read)",
    "a transcript still being written has a truncated last line",
    "subagent transcripts are separate files; invocations without a file are reported as a limit",
  ],
};

/** Capability profile when the task-meta-capture Claude Code hook spool was ingested. */
export function claudeCapability(
  providerVersion: string | null,
  plugin: string | null,
): SourceCapabilityProfile {
  const base: SourceCapabilityProfile = {
    ...CLAUDE_CAPABILITY,
    provider_version: providerVersion,
  };
  if (plugin === null) return base;
  return {
    ...base,
    signals: {
      ...base.signals,
      source_head: {
        supported: true,
        epistemic: "OBSERVED",
        notes: "git HEAD at SessionStart and Stop/SessionEnd from the capture plugin (hook clock).",
      },
      tool_input_class: {
        supported: true,
        epistemic: "INFERRED",
        notes: "Bash command class from the capture plugin's PreToolUse entry.",
      },
      capture_plugin: { supported: true, epistemic: "OBSERVED", notes: plugin },
    },
  };
}
