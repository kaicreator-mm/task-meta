import type { SourceCapabilityProfile } from "../../model.ts";

/** Honest capability matrix of the Codex (ChatGPT desktop) adapter. */
export const CODEX_CAPABILITY: SourceCapabilityProfile = {
  adapter_id: "codex",
  adapter_version: "0.1.0",
  provider: "codex",
  provider_version: null,
  signals: {
    model_requests: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "One token_usage_record line per model response (response_id); token_count lines are the fallback for older rollouts.",
    },
    token_usage: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "Per-response `usage` deltas. input_tokens INCLUDES cached input; output_tokens INCLUDES reasoning output; total = input + output. Running thread totals are only used to cross-check, never summed.",
    },
    cache_tokens: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "cached_input_tokens (read) and cache_write_input_tokens from the usage record.",
    },
    reasoning_tokens: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "reasoning_output_tokens per response (a subset of output_tokens); 0 means the response had none.",
    },
    tool_calls: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "response_item custom_tool_call/function_call with call_id and name; arguments are dropped. The `exec` wrapper may run several commands per call.",
    },
    tool_input_class: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "Commands live inside the exec script text, which is never read; no input class.",
    },
    tool_timing: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "item_completed started_at_ms/completed_at_ms per executed command/MCP call/file change (ms); call-level timing is the rollout write time of the call and output lines.",
    },
    tool_outcome: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "CommandExecution exit_code and McpToolCall isError; no output text. Items are not linkable to call ids.",
    },
    experience_exposure: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "Codex does not expose which experience/recommendations were shown to the agent.",
    },
    billed_cost: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "Subscription plan; no billed cost is exposed (rate-limit percentages are not read).",
    },
    run_boundary: {
      supported: true,
      epistemic: "OBSERVED",
      notes:
        "task_started / task_complete / turn_aborted per turn (seconds, plus exact duration_ms for finished turns).",
    },
    source_head: {
      supported: true,
      epistemic: "INFERRED",
      notes:
        "session_meta.git.commit_hash is HEAD when the thread started; HEAD at the end needs the capture plugin's Stop entry.",
    },
    verifier: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "Only from an independent gate log; never from agent text.",
    },
  },
  clock: {
    domain: "Codex host clock (rollout write time) and provider-side item times",
    precision: "ms",
  },
  known_gaps: [
    "no per-request start/end times; model_wall_ms is UNKNOWN",
    "no billed cost; cost is UNKNOWN",
    "tool calls are `exec` wrappers; commands/MCP calls inside them (item_completed) cannot be linked to call ids",
    "bash command classes are unavailable (command text is never read)",
    "continuation rollout files only hold lines after the base file's end ordinal; earlier tokens need the base file",
    "a rollout still being written has a truncated last line and no task_complete for the open turn",
  ],
};

/** Capability profile when the task-meta-capture Codex hook spool was ingested. */
export function codexCapabilityWithHooks(plugin: string): SourceCapabilityProfile {
  return {
    ...CODEX_CAPABILITY,
    signals: {
      ...CODEX_CAPABILITY.signals,
      source_head: {
        supported: true,
        epistemic: "OBSERVED",
        notes: "git HEAD at SessionStart and Stop from the capture plugin (hook clock).",
      },
      capture_plugin: { supported: true, epistemic: "OBSERVED", notes: plugin },
    },
  };
}
