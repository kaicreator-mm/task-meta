// Shared v0.1 data model. Every module (adapter, store, report, publisher) imports
// these types; changing them is a contract change — see docs/v0.1/DEFINITION.md §4.

/** How a field value is known. UNKNOWN always carries a null value, never 0. */
export type Epistemic = "OBSERVED" | "SELF_REPORTED" | "INFERRED" | "UNKNOWN";
export type Coverage = "COMPLETE" | "PARTIAL" | "UNKNOWN";
export type PrivacyClass = "PROJECT_PRIVATE" | "RESTRICTED" | "PUBLISHABLE";

/** What one adapter version can and cannot observe (honest capability matrix). */
export interface SourceCapabilityProfile {
  adapter_id: string;
  adapter_version: string;
  provider: string;
  /** Agent product version as reported by the source, or null when not exposed. */
  provider_version: string | null;
  signals: Record<string, SignalCapability>;
  clock: { domain: string; precision: string };
  known_gaps: string[];
}

export interface SignalCapability {
  supported: boolean;
  epistemic: Epistemic;
  notes: string;
}

export type ObservationKind =
  | "SESSION_SUMMARY"
  | "MODEL_REQUEST"
  | "TOOL_CALL"
  | "VERIFIER_RESULT"
  | "RUN_BOUNDARY";

/** Token counts. input_tokens INCLUDES cache_read/cache_write tokens; never add them twice. */
export interface TokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
}

/**
 * One sanitized, metadata-only observation. Raw prompts, model text, tool
 * arguments/results, HTTP headers and credentials are never present.
 */
export interface ObservationRecord {
  /** Namespaced stable id: `${adapter_id}:${source_event_id}`. Dedup key together with digest. */
  observation_id: string;
  source_event_id: string;
  /** Monotonic revision of the same source event (1 = first seen). */
  source_revision: number;
  adapter_id: string;
  kind: ObservationKind;
  task_ref: string | null;
  run_ref: string;
  attempt_ref: string | null;
  step_ref: string | null;
  parent_ref: string | null;
  /** Logical call identity (same for physical retries of one call). */
  logical_call_ref: string | null;
  /** Physical attempt identity (distinct per real retry). */
  physical_attempt_ref: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  model: { provider_id: string | null; model_id: string | null } | null;
  tool: { call_id: string; name: string } | null;
  usage: TokenUsage | null;
  status: string | null;
  /** Per-field provenance for every non-identity field that has a value. */
  fields_epistemic: Record<string, Epistemic>;
  privacy_class: PrivacyClass;
}

export interface MetricValue {
  name: string;
  value: number | null;
  unit: string;
  epistemic: Epistemic;
  coverage: Coverage;
  source_refs: string[];
}

export type VerifierStatus = "PASS" | "FAIL" | "PARTIAL" | "NOT_RUN" | "UNKNOWN";

/** Verifier outcome as observed from an independent source; never from agent self-report. */
export interface VerifierOutcome {
  status: VerifierStatus;
  subject_sha: string | null;
  checked: string[];
  failed: string[];
  skipped: string[];
  unchecked: string[];
  coverage: Coverage;
  epistemic: Epistemic;
  source_refs: string[];
}

export interface CostObservation {
  value: number | null;
  currency: string | null;
  basis: "BILLED" | "ESTIMATED" | "UNKNOWN";
  pricing_basis: string | null;
  epistemic: Epistemic;
  source_refs: string[];
}

export type AttemptBinding = "CANONICAL_DISPATCH" | "COLLECTOR_ONLY" | "UNKNOWN";

/** Logical actor attribution. transport_actor (GitHub login) is not identity proof. */
export interface ActorRef {
  role: string;
  operator_kind: string;
  operator_id: string;
  session_ref: string;
  transport_actor: string | null;
}

/**
 * Derived per-Attempt summary: the single input of the report writer
 * (src/report). Produced by the correlator from ObservationRecords.
 */
export interface AttemptSummary {
  repository: string;
  issue_number: number;
  task_ref: string;
  attempt_ref: string;
  attempt_binding: AttemptBinding;
  /** Exact source commit the attempt produced/ran on; null when not witnessed. */
  source_sha: string | null;
  actor: ActorRef;
  observed_at: string;
  observation_refs: string[];
  capture_coverage: Coverage;
  limits: string[];
  metrics: MetricValue[];
  cost: CostObservation;
  /** Leaf physical attempts aggregated into this summary; excluded ones listed separately. */
  attempt_refs: string[];
  excluded_attempt_refs: string[];
  verifier: VerifierOutcome;
  learning: { state: "NONE_MATERIAL" | "REFERENCED" | "UNKNOWN"; source_refs: string[] };
}

/** Private immutable manifest pointer; the manifest body never leaves the private store. */
export interface ManifestPointer {
  ref: string;
  sha256: string;
  access: "PROJECT_PRIVATE" | "RESTRICTED";
}
