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
  tool: {
    call_id: string;
    name: string;
    /**
     * Privacy-safe class of the tool input (Bash only today): a fixed enum derived at
     * ingress from the command; the command text itself is never stored.
     */
    input_class?: string;
  } | null;
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
  /** v5 per-metric source identity (ADS v4.16 §16.7). Required to project into ads/github/v5. */
  identity?: MetricIdentity;
}

export interface MetricIdentity {
  metric_id: string;
  observation_id: string;
  logical_call_ref: string;
  physical_attempt_ref: string;
  adapter_id: string;
  /** Raw provider routing is withheld from public projections; null unless cleared. */
  provider_run_ref: string | null;
  measurement_kind: "COUNTER_DELTA" | "CUMULATIVE_SNAPSHOT" | "GAUGE" | "UNKNOWN";
  window_id: string;
  source_revision: number;
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
  /** PROVIDER_REPORTED exists only in ads/github/v5; a v4 projection must refuse it. */
  basis: "BILLED" | "PROVIDER_REPORTED" | "ESTIMATED" | "UNKNOWN";
  pricing_basis: string | null;
  epistemic: Epistemic;
  source_refs: string[];
  /** v5 accounting refs; required by v5 when basis is BILLED. */
  accounting?: {
    accounting_ref: string | null;
    economic_scope_ref: string | null;
    billing_window_ref: string | null;
    cost_category: string | null;
  };
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

// ---- v0.1 R2: private diagnostic records (#11 #15 #16 #17). Never projected to GitHub
// unless the effective ADS report schema has a field for them. ----

/** #11: terminal classification. STRICT_TERMINAL_SUCCESS needs every required check passed on the exact subject. */
export type OutcomeClass =
  | "STRICT_TERMINAL_SUCCESS"
  | "PARTIAL_PROGRESS"
  | "TERMINAL_FAILURE"
  | "BLOCKED"
  | "UNVERIFIED";

/** #11: externally observed quality qualifier of a verifier (oracle revision, contamination, challenge…). */
export interface VerifierQualifier {
  kind: string;
  value: string | null;
  epistemic: Epistemic;
  source_ref: string | null;
  limits: string[];
}

/** #11: one independent verifier execution, as observed. Agent self-report never produces one. */
export interface VerifierRecord {
  verifier_id: string;
  verifier_version: string | null;
  contract_ref: string | null;
  subject_sha: string | null;
  /** Bounded, path-free environment facts (e.g. node major version). */
  environment: Record<string, string>;
  required_scope: string[];
  checked: string[];
  failed: string[];
  skipped: string[];
  unchecked: string[];
  cases: {
    total: number | null;
    passed: number | null;
    failed: number | null;
    skipped: number | null;
    epistemic: Epistemic;
  };
  exit_code: number | null;
  /** CURRENT only when subject_sha equals the attempt's witnessed source_sha. */
  currentness: "CURRENT" | "STALE" | "UNKNOWN";
  qualifiers: VerifierQualifier[];
  source_refs: string[];
  epistemic: Epistemic;
}

export interface VerifierAssessment {
  outcome_class: OutcomeClass;
  records: VerifierRecord[];
  conflicts: string[];
  limits: string[];
}

/** #15: one source state the attempt touched. Never synthesized for uncommitted work. */
export interface VersionState {
  version_id: string;
  sha: string | null;
  parents: string[] | null;
  first_seen_at: string | null;
  observed_in: string[];
  observability: "COMMITTED" | "INCOMPLETE" | "UNKNOWN";
  epistemic: Epistemic;
}

export type TransitionKind = "ADVANCE" | "NO_CHANGE" | "REVISIT" | "INCOMPLETE" | "UNKNOWN";

/** #15: one run segment's before→after source change. */
export interface Transition {
  transition_id: string;
  from_version: string | null;
  to_version: string | null;
  run_segment_ref: string;
  started_at: string | null;
  finished_at: string | null;
  change: {
    files_changed: number | null;
    insertions: number | null;
    deletions: number | null;
    diff_digest: string | null;
  };
  verifier_refs: string[];
  kind: TransitionKind;
  epistemic: Epistemic;
  limits: string[];
}

export interface VersionLineage {
  versions: VersionState[];
  transitions: Transition[];
  revisits: { version_id: string; transition_ids: string[] }[];
  limits: string[];
}

/** T17 (#15): one edge of the cross-attempt version DAG. Direction is earlier state to later state. */
export interface DagEdge {
  /** TRANSITION: an attempt's observed before-to-after change. GIT_PARENT: real git ancestry between two versions present in the DAG. */
  kind: "TRANSITION" | "GIT_PARENT";
  from_version: string;
  to_version: string;
  attempt_ref: string | null;
  transition_id: string | null;
  /** TRANSITION edges only: the underlying transition kind (REVISIT edges point back to an earlier state). */
  transition_kind: TransitionKind | null;
  /** GIT_PARENT edges only: commits strictly between the two versions on the ancestry path (never materialized as versions). */
  intermediate_commits: number | null;
}

/** T17: how a later attempt relates to an earlier one (by start time). Evidence only, no intent judged. */
export type AttemptRelationKind =
  | "CONTINUES"
  | "BRANCHES_FROM"
  | "RESTARTS_FROM_BASE"
  | "UNRELATED"
  | "UNKNOWN";

/** T17: pairwise attempt relation with bounded evidence strings (short SHAs only). */
export interface AttemptRelation {
  earlier_attempt: string;
  later_attempt: string;
  relation: AttemptRelationKind;
  evidence: string[];
}

/** T17 (#15): branch DAG of source versions across all attempts of one Issue. Never an ADS Task DAG. */
export interface IssueVersionDag {
  repository: string;
  issue_number: number;
  attempts: string[];
  versions: VersionState[];
  edges: DagEdge[];
  /** Versions with no outgoing (non-revisit) edge. */
  heads: string[];
  /** Distinct heads; two or more means divergent attempts. */
  branches: string[];
  attempt_relations: AttemptRelation[];
  /** Cross-attempt returns to a state the DAG had already moved past; raw provenance, not judged. */
  revisits: { version_id: string; transition_ids: string[] }[];
  gaps: { kind: string; ref: string; detail: string }[];
}

export type LabelKind =
  | "ACTION_CATEGORY"
  | "EDIT_MAGNITUDE"
  | "LOOP_CLUSTER"
  | "REVISIT_CANDIDATE"
  | "STRATEGY_SHIFT_CANDIDATE"
  | "FAILURE_CLASS_CANDIDATE";

/** #16: append-only derived label with labeler provenance; never overrides verifier/GitHub truth. */
export interface Label {
  label_id: string;
  target_ref: string;
  kind: LabelKind;
  value: string;
  epistemic: Epistemic;
  confidence: number | null;
  labeler: { name: string; version: string; rules_digest: string };
  evidence_refs: string[];
  supersedes: string | null;
}

/** #17: derived diagnostic aggregate with explicit denominator. Private unless ADS has a field. */
export interface DiagnosticAggregate {
  name: string;
  numerator: number | null;
  denominator: number | null;
  unit: string;
  coverage: Coverage;
  epistemic: Epistemic;
  derivation: string;
  source_refs: string[];
  comparability: "COMPARABLE" | "INSUFFICIENT_COMPARABLE_EVIDENCE" | "UNKNOWN";
  limits: string[];
  /** Public field reference when the effective ADS schema has one; null = NOT_PUBLISHABLE. */
  publication_field: string | null;
}

// ---- v0.2: task binding (docs/v0.2/DEFINITION.md §2) ----

export type BindingState = "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED";

/** One piece of evidence for which repository/Issue a session worked on. Never prompt text. */
export interface BindingEvidence {
  kind: "PROMPT_REF" | "WORKTREE_NAME" | "BRANCH_NAME" | "GIT_REMOTE" | "OPERATOR";
  /** Normalized ref only, e.g. "kaicreator-mm/domain-harness#1296" or "kaicreator-mm/x". */
  value: string;
  epistemic: Epistemic;
}

/** Which repository and Issue (and optionally PR) a session's report belongs to. */
export interface TaskBinding {
  repository: string | null;
  issue_number: number | null;
  pr_number: number | null;
  state: BindingState;
  evidence: BindingEvidence[];
  /** Why the binding is AMBIGUOUS/UNRESOLVED (bounded, no content). */
  reasons: string[];
}

// ---- v0.4 T0: versioned private evidence/quality and safe effect vocabulary. ----
// These types are NOT fields in ADS public v4/v5 reports. Existing v0.3 source
// records remain readable; consumers opt in to these separate private facts.

/** Not-observed is never proof of non-instrumentation or proof of zero events. */
export type MissingReason =
  | "NOT_INSTRUMENTED"
  | "HOST_EVENT_NOT_OBSERVED"
  | "ADAPTER_FAILURE"
  | "UNBOUND"
  | "SOURCE_DROPPED"
  | "CLOCK_UNTRUSTED"
  | "OUT_OF_SCOPE"
  | "UNKNOWN";

export type EvidenceLevel =
  | "SOURCE_ONLY"
  | "HOOK_FIXTURE"
  | "REAL_AGENT_CLI"
  | "REAL_HOST_GITHUB"
  | "DESKTOP_ONLY"
  | "REAL_TALLY_APP";

export type CoverageKind = "CONDITIONAL" | "ABSOLUTE";
export type PrivateDiagnosticVersion = "task-meta/private-diagnostics/v1";

/** Private, source-qualified fact: epistemic and missing_reason are orthogonal. */
export interface DiagnosticFact {
  schema: PrivateDiagnosticVersion;
  source_ref: string;
  source_revision: number;
  agent: "zcode" | "claude" | "codex";
  plugin_version: string | null;
  host_class: string | null;
  evidence_level: EvidenceLevel;
  epistemic: Epistemic;
  missing_reason: MissingReason | null;
  clock: { domain: string; precision: string; synchronized: boolean | null };
}

/** Numerator/denominator are null if unproved; an observed-only cohort is conditional. */
export interface CaptureQuality {
  schema: PrivateDiagnosticVersion;
  metric_name:
    | "binding"
    | "tool_pair"
    | "lifecycle"
    | "token_cost_basis"
    | "publication_reconciliation"
    | "verifier_source";
  numerator: number | null;
  denominator: number | null;
  denominator_source_refs: string[];
  coverage_kind: CoverageKind;
  eligible_scope_ref: string | null;
  capability_ref: string | null;
  reason: MissingReason | null;
  epistemic: Epistemic;
  source_refs: string[];
  comparability: "COMPARABLE" | "NOT_COMPARABLE" | "UNKNOWN";
  limits: string[];
}

/**
 * Private transport-effect certainty, NOT an HTTP status and NOT a GitHub
 * permission decision. A complete zero-match native readback after a delayed
 * POST does NOT prove PROVEN_NOT_SENT. No caller may re-POST on uncertainty.
 */
export type PostEffect =
  | "PROVEN_NOT_SENT"
  | "REMOTE_SAME"
  | "REMOTE_DIFFERENT_OR_DAMAGED"
  | "SENT_OR_MAY_HAVE_SENT";

/**
 * T0-shared vocabulary only: B2 exclusively owns persisted Outbox transitions,
 * journal CAS and mapping of legacy FAILED to modern conservative states.
 * JOURNAL_INCOMPLETE is journal-integrity evidence, never a PostEffect or proof
 * of non-send. B2 must persist its conservative UNKNOWN/HELD projection and
 * prove zero follow-on POST after damaged/missing journal data (even when an
 * older PENDING survives or remote readback is empty). T0's pure classifier
 * neither reads journals nor verifies those persistence/runtime guarantees.
 */
export type PrivatePublicationStatus =
  | "PENDING"
  | "IN_FLIGHT"
  | "PUBLISHED"
  | "ALREADY_PUBLISHED"
  | "DENIED"
  | "CONFLICT"
  | "HELD"
  | "UNKNOWN"
  | "JOURNAL_INCOMPLETE"
  | "FAILED_PROVEN_PRE_SEND";

/** Classification is a pure evidence projection, never a grant or retry action. */
export interface PostEffectAssessment {
  effect: PostEffect;
  status: PrivatePublicationStatus;
  /** May be reconsidered ONLY with fresh permission and positive non-send proof. */
  fresh_admission_required: boolean;
  /** Uncertain effect: reconciliation-only; no physical POST. */
  reconciliation_only: boolean;
}

/**
 * Classify externally justified effect evidence, without touching the network.
 * For PROVEN_NOT_SENT the caller still needs positive proof + new admission;
 * this function never authorizes transport just by returning that label.
 */
export function assessPostEffect(effect: PostEffect): PostEffectAssessment {
  switch (effect) {
    case "PROVEN_NOT_SENT":
      return {
        effect,
        status: "FAILED_PROVEN_PRE_SEND",
        fresh_admission_required: true,
        reconciliation_only: false,
      };
    case "REMOTE_SAME":
      return {
        effect,
        status: "ALREADY_PUBLISHED",
        fresh_admission_required: false,
        reconciliation_only: false,
      };
    case "REMOTE_DIFFERENT_OR_DAMAGED":
      return {
        effect,
        status: "CONFLICT",
        fresh_admission_required: false,
        reconciliation_only: true,
      };
    case "SENT_OR_MAY_HAVE_SENT":
      return {
        effect,
        status: "UNKNOWN",
        fresh_admission_required: false,
        reconciliation_only: true,
      };
  }
}
