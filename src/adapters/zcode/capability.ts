import type { SourceCapabilityProfile } from "../../model.ts";

/** Honest capability matrix of the ZCode adapter (DEFINITION §3). */
export const ZCODE_CAPABILITY: SourceCapabilityProfile = {
  adapter_id: "zcode",
  adapter_version: "0.1.0",
  provider: "zcode",
  provider_version: null,
  signals: {
    model_requests: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "One model_io rollout line per physical request (requestId#attempt).",
    },
    token_usage: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "Per-request usage from the rollout; input_tokens includes cache reads.",
    },
    cache_tokens: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "cacheReadTokens / cacheWriteTokens from rollout usage.",
    },
    reasoning_tokens: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "Not exposed per request; the headless 0 is indistinguishable from absent.",
    },
    tool_calls: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "Only id and name, taken from model responses; arguments are dropped.",
    },
    tool_input_class: {
      supported: true,
      epistemic: "INFERRED",
      notes:
        "Bash command class (fixed enum) derived at ingress by prefix rules; command text is dropped.",
    },
    experience_exposure: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "ZCode does not expose which experience/recommendations were shown to the agent.",
    },
    tool_timing: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "No per-tool start/end times are exposed.",
    },
    billed_cost: {
      supported: false,
      epistemic: "UNKNOWN",
      notes: "Coding plan; no billed cost is exposed.",
    },
    run_boundary: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "From the dispatch run record (run.txt): start/finish, exit code, head SHAs.",
    },
    verifier: {
      supported: true,
      epistemic: "OBSERVED",
      notes: "Only from an independent gate log EXIT= line; never from agent response text.",
    },
  },
  clock: { domain: "host-local wall clock (run.txt) and provider timestamps", precision: "ms" },
  known_gaps: [
    "reasoning tokens unknown (headless total 0 cannot be told apart from not exposed)",
    "no billed cost (coding plan); cost is UNKNOWN",
    "no per-tool timing; tool calls are known only by id/name inside a model response",
    "headless modelRequestCount may differ from rollout line count on resumed sessions",
    "gate EXIT=0 proves lint/typecheck/test only, not task acceptance",
  ],
};

/**
 * Capability profile when the task-meta-capture hook spool was ingested (DEFINITION §9).
 * The base ZCODE_CAPABILITY is unchanged for runs without a spool.
 */
export function zcodeCapabilityWithHooks(plugin: string): SourceCapabilityProfile {
  return {
    ...ZCODE_CAPABILITY,
    signals: {
      ...ZCODE_CAPABILITY.signals,
      tool_timing: {
        supported: true,
        epistemic: "OBSERVED",
        notes: "PreToolUse/PostToolUse hook timestamps from the capture plugin (hook clock).",
      },
      tool_outcome: {
        supported: true,
        epistemic: "OBSERVED",
        notes:
          "success/failure/interrupt from PostToolUse/PostToolUseFailure hooks; no error text.",
      },
      capture_plugin: { supported: true, epistemic: "OBSERVED", notes: plugin },
    },
    known_gaps: [
      ...ZCODE_CAPABILITY.known_gaps.filter((g) => !g.startsWith("no per-tool timing")),
      "tool timing exists only for calls that ran while the capture plugin was enabled",
    ],
  };
}
