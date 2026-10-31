// v0.4 C1 (#70) — six denominator-safe private Capture Quality metrics.
// Built ONLY on the T0 private vocabulary (DiagnosticFact, PrivatePublicationStatus,
// MissingReason, Epistemic) and existing aggregate conventions. No A2 lifecycle
// implementation import (A2∥C1 stay parallel), no second billing pipeline, no
// Agent ranking. Private facts: none of these are ADS public report fields.
import type {
  CaptureQuality,
  DiagnosticFact,
  Epistemic,
  MissingReason,
  PrivateDiagnosticVersion,
  PrivatePublicationStatus,
} from "../model.ts";

const SCHEMA: PrivateDiagnosticVersion = "task-meta/private-diagnostics/v1";
const REFS_LIMIT = 20;

/** A witnessed lifecycle step; only OBSERVED facts prove the step happened. */
export interface LifecycleStepObservation {
  session_ref: string;
  step: "SESSION_START" | "STOP" | "SESSION_END" | "HOOK_ERROR";
  fact: DiagnosticFact;
}

export interface BindingObservation {
  session_ref: string;
  /** null = binding unproved (never counted as unbound). */
  bound: boolean | null;
  missing_reason: MissingReason | null;
}

export interface ToolCallObservation {
  call_ref: string;
  /** null = pairing unproved (response side not witnessed). */
  response_ref: string | null;
  missing_reason: MissingReason | null;
}

export interface TokenBasisObservation {
  call_ref: string;
  /** null = cost basis unproved for this call. */
  counted_basis: boolean | null;
  /** Pricing revision this observation was computed against; null = no basis. */
  pricing_basis: string | null;
  missing_reason: MissingReason | null;
}

export interface PublicationAttemptObservation {
  attempt_ref: string;
  status: PrivatePublicationStatus;
}

export interface VerifierRecordObservation {
  record_ref: string;
  /** null = currentness unproved. */
  current: boolean | null;
  required_scope: string[];
  missing_reason: MissingReason | null;
}

/** A12 time span. Child/cache spans never add wall time; physical retries stay independent. */
export interface SpanObservation {
  ref: string;
  parent_ref: string | null;
  kind: "ATTEMPT" | "PHYSICAL_RETRY" | "CACHE_HIT" | "WITNESS";
  start_ms: number;
  /** null = end unwitnessed; the span contributes no duration. */
  end_ms: number | null;
}

export interface QualityCohortInput {
  cohort_ref: string;
  /**
   * True ONLY when the full eligible scope universe is positively witnessed.
   * ABSOLUTE denominators cover every listed observation; observed-only
   * CONDITIONAL cohorts count provable observations only.
   */
  universe_witnessed: boolean;
  cohort_facts: DiagnosticFact[];
  bindings: BindingObservation[];
  tool_calls: ToolCallObservation[];
  lifecycle: LifecycleStepObservation[];
  token_basis: TokenBasisObservation[];
  publication_attempts: PublicationAttemptObservation[];
  verifier_records: VerifierRecordObservation[];
  spans: SpanObservation[];
}

type MetricName = CaptureQuality["metric_name"];

function build(
  input: QualityCohortInput,
  name: MetricName,
  provable: { numerator: number; denominator: number },
  refs: { numerator: string[]; denominator: string[] },
  opts: {
    reason: MissingReason | null;
    epistemic: Epistemic;
    comparability: CaptureQuality["comparability"];
    limits?: string[];
  },
): CaptureQuality {
  const unproved = provable.denominator === 0;
  return {
    schema: SCHEMA,
    metric_name: name,
    numerator: unproved ? null : provable.numerator,
    denominator: unproved ? null : provable.denominator,
    denominator_source_refs: refs.denominator.slice(0, REFS_LIMIT),
    coverage_kind: input.universe_witnessed ? "ABSOLUTE" : "CONDITIONAL",
    eligible_scope_ref: input.cohort_ref,
    capability_ref: null,
    reason: unproved ? (opts.reason ?? "UNKNOWN") : opts.reason,
    epistemic: unproved ? "UNKNOWN" : opts.epistemic,
    source_refs: [...input.cohort_facts.map((f) => f.source_ref), ...refs.numerator].slice(
      0,
      REFS_LIMIT,
    ),
    comparability: unproved && opts.comparability === "COMPARABLE" ? "UNKNOWN" : opts.comparability,
    limits: [
      ...(input.universe_witnessed
        ? []
        : ["observed-only cohort: CONDITIONAL, not the full eligible universe"]),
      ...(opts.limits ?? []),
    ],
  };
}

const TERMINAL_PUBLICATION: ReadonlySet<PrivatePublicationStatus> = new Set([
  "PUBLISHED",
  "ALREADY_PUBLISHED",
  "DENIED",
  "CONFLICT",
  "FAILED_PROVEN_PRE_SEND",
] as const);

/**
 * A12: union duration in ms of closed top-level spans. Nested child spans and
 * CACHE_HIT spans contribute nothing (no double count); overlapping/nested
 * intervals merge instead of summing; physical retries stay independent roots.
 * Returns 0 for an empty set; never infers wall-clock meaning beyond the union.
 */
export function unionSpanMs(spans: SpanObservation[]): number {
  const roots = spans.filter(
    (s) =>
      (s.parent_ref === null || s.kind === "PHYSICAL_RETRY") &&
      s.kind !== "CACHE_HIT" &&
      typeof s.end_ms === "number" &&
      s.end_ms >= s.start_ms,
  );
  const intervals = roots
    .map((s) => [s.start_ms, s.end_ms as number] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let open: number | null = null;
  let close = 0;
  for (const [start, end] of intervals) {
    if (open === null || start > close) {
      if (open !== null) total += close - open;
      open = start;
      close = end;
    } else if (end > close) {
      close = end;
    }
  }
  if (open !== null) total += close - open;
  return total;
}

/** Count independent physical attempts (roots + physical retries; cache/child excluded). */
export function countPhysicalAttempts(spans: SpanObservation[]): number {
  return spans.filter(
    (s) => (s.parent_ref === null || s.kind === "PHYSICAL_RETRY") && s.kind !== "CACHE_HIT",
  ).length;
}

/** Compute all six private capture-quality metrics for one source cohort. */
export function computeCaptureQuality(input: QualityCohortInput): CaptureQuality[] {
  const out: CaptureQuality[] = [];

  // 1) binding — proven-bound sessions / provable binding observations.
  const bindProvable = input.bindings.filter((b) => b.bound !== null);
  out.push(
    build(
      input,
      "binding",
      {
        numerator: bindProvable.filter((b) => b.bound === true).length,
        denominator: bindProvable.length,
      },
      {
        numerator: bindProvable.filter((b) => b.bound === true).map((b) => b.session_ref),
        denominator: bindProvable.map((b) => b.session_ref),
      },
      {
        reason: input.bindings.find((b) => b.bound === null)?.missing_reason ?? null,
        epistemic: "OBSERVED",
        comparability: "COMPARABLE",
        limits: ["unproved bindings are excluded from the denominator, never read as unbound"],
      },
    ),
  );

  // 2) tool_pair — paired request/response calls / observed request cohort.
  // Denominator semantics: every OBSERVED tool request stays in the denominator
  // in BOTH coverage kinds — an unpaired request is an observed fact, never
  // dropped to inflate the pairing rate (two known requests with one pair are
  // 1/2, not 1/1). ABSOLUTE only additionally asserts the listed cohort is the
  // complete eligible universe; CONDITIONAL marks it observed-only.
  const paired = input.tool_calls.filter((t) => t.response_ref !== null);
  out.push(
    build(
      input,
      "tool_pair",
      { numerator: paired.length, denominator: input.tool_calls.length },
      {
        numerator: paired.map((t) => t.call_ref),
        denominator: input.tool_calls.map((t) => t.call_ref),
      },
      {
        reason: input.tool_calls.find((t) => t.response_ref === null)?.missing_reason ?? null,
        epistemic: "OBSERVED",
        comparability: "COMPARABLE",
        limits: [
          input.universe_witnessed
            ? "ABSOLUTE: the listed calls are the complete eligible request universe"
            : "CONDITIONAL: denominator covers every observed request; unpaired requests stay counted",
        ],
      },
    ),
  );

  // 3) lifecycle — sessions with witnessed STOP and SESSION_END / observed sessions.
  const witnessed = new Map<string, Set<string>>();
  for (const step of input.lifecycle) {
    // A fact with a missing_reason (e.g. ZCode SessionEnd NOT_INSTRUMENTED) never
    // proves the step happened, even when other fields look observed.
    if (step.fact.epistemic !== "OBSERVED" || step.fact.missing_reason !== null) continue;
    const set = witnessed.get(step.session_ref) ?? new Set<string>();
    set.add(step.step);
    witnessed.set(step.session_ref, set);
  }
  const complete = [...witnessed.entries()].filter(
    ([, steps]) => steps.has("STOP") && steps.has("SESSION_END"),
  );
  const activeUnion = unionSpanMs(input.spans);
  out.push(
    build(
      input,
      "lifecycle",
      { numerator: complete.length, denominator: witnessed.size },
      {
        numerator: complete.map(([ref]) => ref),
        denominator: [...witnessed.keys()],
      },
      {
        reason: input.lifecycle.some((s) => s.fact.missing_reason === "NOT_INSTRUMENTED")
          ? "NOT_INSTRUMENTED"
          : null,
        epistemic: "OBSERVED",
        comparability: "COMPARABLE",
        limits: [
          ...(input.spans.length > 0
            ? [
                `active_union_ms=${activeUnion} (nested/overlapping union, cache/child excluded)`,
                `physical_attempts=${countPhysicalAttempts(input.spans)}`,
              ]
            : []),
          "SELF_REPORTED/INFERRED lifecycle facts never prove a step",
        ],
      },
    ),
  );

  // 4) token_cost_basis — calls on one witnessed pricing basis / comparable basis calls.
  // Without a witnessed pricing revision there is NO comparable rate at all:
  // numerator/denominator stay null and the metric is NOT_COMPARABLE — never a
  // misleading success-style ratio built on missing price provenance.
  const basisProvable = input.token_basis.filter(
    (t) => t.counted_basis === true && t.pricing_basis !== null,
  );
  const countedWithoutBasis = input.token_basis.filter(
    (t) => t.counted_basis === true && t.pricing_basis === null,
  ).length;
  const bases = new Set(
    basisProvable.map((t) => t.pricing_basis).filter((b): b is string => b !== null),
  );
  const mixedPricing = bases.size > 1;
  out.push(
    build(
      input,
      "token_cost_basis",
      { numerator: basisProvable.length, denominator: basisProvable.length },
      {
        numerator: basisProvable.map((t) => t.call_ref),
        denominator: basisProvable.map((t) => t.call_ref),
      },
      {
        reason: input.token_basis.find((t) => t.counted_basis !== true)?.missing_reason ?? null,
        epistemic: "OBSERVED",
        comparability: mixedPricing || bases.size === 0 ? "NOT_COMPARABLE" : "COMPARABLE",
        limits: [
          ...(bases.size > 0
            ? [`pricing_basis=${[...bases].join("|")}`]
            : [
                "no witnessed pricing basis: no comparable rate is expressible",
                ...(countedWithoutBasis > 0
                  ? [`counted_without_pricing_basis=${countedWithoutBasis}`]
                  : []),
              ]),
          "missing source universe or price revision => NOT_COMPARABLE, never a numeric 0",
        ],
      },
    ),
  );

  // 5) publication_reconciliation — terminal resolutions / publish attempts.
  const attempts = input.publication_attempts;
  const terminal = attempts.filter((a) => TERMINAL_PUBLICATION.has(a.status));
  const success = attempts.filter((a) => a.status === "PUBLISHED");
  const unknown = attempts.filter((a) => !TERMINAL_PUBLICATION.has(a.status));
  out.push(
    build(
      input,
      "publication_reconciliation",
      { numerator: terminal.length, denominator: attempts.length },
      {
        numerator: terminal.map((a) => a.attempt_ref),
        denominator: attempts.map((a) => a.attempt_ref),
      },
      {
        reason: null,
        epistemic: "OBSERVED",
        comparability: "COMPARABLE",
        limits: [
          `actual_success=${success.length}`,
          `unresolved_unknown=${unknown.length}`,
          "terminal = PUBLISHED/ALREADY_PUBLISHED/DENIED/CONFLICT/FAILED_PROVEN_PRE_SEND",
        ],
      },
    ),
  );

  // 6) verifier_source — proven-current verifier records / provable currentness.
  const verProvable = input.verifier_records.filter((v) => v.current !== null);
  out.push(
    build(
      input,
      "verifier_source",
      {
        numerator: verProvable.filter((v) => v.current === true).length,
        denominator: verProvable.length,
      },
      {
        numerator: verProvable.filter((v) => v.current === true).map((v) => v.record_ref),
        denominator: verProvable.map((v) => v.record_ref),
      },
      {
        reason: input.verifier_records.find((v) => v.current === null)?.missing_reason ?? null,
        epistemic: "OBSERVED",
        comparability: "COMPARABLE",
      },
    ),
  );

  return out;
}
