// v0.3 T03 — bounded PRIVATE diagnostics. Do not project these as new ADS fields.
import { canonicalDigest } from "../canonical.ts";
import type { CostObservation, MetricValue } from "../model.ts";

export interface ComparableMetricInput {
  metric: MetricValue;
  adsProfile: "v4" | "v5";
  privacyClearance: "PUBLISHABLE" | "PROJECT_PRIVATE" | "RESTRICTED";
  /** Source-owned capture cohort. Never infer a comparison population from a model name. */
  cohortRef: string;
}
export interface MetricComparison {
  state: "COMPARABLE" | "NOT_COMPARABLE";
  metricName: string | null;
  unit: string | null;
  /** Null means evidence insufficient; NEVER synthesize zero for missing observations. */
  total: number | null;
  denominator: number;
  excluded: number;
  coverage: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  sourceRefs: string[];
  limits: string[];
  /** Private-only unless separate existing public schema + clearance admits it. */
  publicationField: null;
}

function refuse(reason: string, excluded: number): MetricComparison {
  return {
    state: "NOT_COMPARABLE", metricName: null, unit: null, total: null,
    denominator: 0, excluded, coverage: "UNKNOWN", sourceRefs: [],
    limits: [reason], publicationField: null,
  };
}

/** A source-only sum of comparable COUNTER_DELTA observations, never a model ranking. */
export function compareCounterMetrics(inputs: ComparableMetricInput[]): MetricComparison {
  if (inputs.length === 0) return refuse("no qualified metric observations", 0);
  const first = inputs[0];
  if (!first) return refuse("no qualified metric observations", 0);
  const m0 = first.metric;
  const id0 = m0.identity;
  if (m0.name === "total_tokens" && inputs.some((i) =>
    i.metric.name === "input_tokens" || i.metric.name === "cache_read_tokens" ||
    i.metric.name === "cache_write_tokens" || i.metric.name === "output_tokens"
  )) return refuse("total_tokens cannot be recomputed by adding included cache/input components", inputs.length);
  if (!id0 || id0.measurement_kind !== "COUNTER_DELTA") {
    return refuse("source identity or COUNTER_DELTA witness missing", inputs.length);
  }
  let total = 0;
  const seen = new Map<string, string>();
  const refs = new Set<string>();
  let duplicates = 0;
  for (const { metric: m, adsProfile, privacyClearance, cohortRef } of inputs) {
    const id = m.identity;
    if (
      adsProfile !== "v5" || first.adsProfile !== "v5" ||
      privacyClearance !== "PUBLISHABLE" || !cohortRef ||
      cohortRef !== first.cohortRef ||
      m.name !== m0.name || m.unit !== m0.unit ||
      m.epistemic !== "OBSERVED" || m.coverage !== "COMPLETE" ||
      !Array.isArray(m.source_refs) || m.source_refs.length === 0 ||
      id === undefined || id.adapter_id !== id0.adapter_id ||
      id.measurement_kind !== "COUNTER_DELTA" ||
      !id.metric_id || !id.observation_id || !id.logical_call_ref ||
      !id.physical_attempt_ref || !id.window_id || id.source_revision < 1 ||
      typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < 0
    ) {
      return refuse("mixed profile/cohort/coverage/privacy/measurement or missing source", inputs.length);
    }
    // Physical leaf/retry and observation revision define source identity, not
    // the current GitHub login, model label, or report arrival order.
    const key = JSON.stringify([
      id.adapter_id, id.observation_id, id.physical_attempt_ref,
      id.metric_id, id.window_id, id.source_revision,
    ]);
    const digest = canonicalDigest({
      value: m.value, name: m.name, unit: m.unit, refs: [...m.source_refs].sort(),
      logicalCall: id.logical_call_ref,
    });
    const old = seen.get(key);
    if (old !== undefined) {
      if (old !== digest) return refuse("same physical metric identity carries conflicting facts", inputs.length);
      duplicates++;
      continue;
    }
    seen.set(key, digest);
    total += m.value;
    if (!Number.isFinite(total) || !Number.isSafeInteger(total) && m.unit === "token") {
      return refuse("unsafe or overflowed public counter", inputs.length);
    }
    for (const ref of m.source_refs) refs.add(ref);
  }
  const denominator = seen.size;
  return {
    state: denominator > 0 ? "COMPARABLE" : "NOT_COMPARABLE",
    metricName: m0.name, unit: m0.unit,
    total: denominator > 0 ? total : null, denominator,
    excluded: duplicates,
    coverage: duplicates > 0 ? "PARTIAL" : "COMPLETE",
    sourceRefs: [...refs].sort().slice(0, 100),
    limits: duplicates > 0 ? ["duplicate delivery deduplicated by physical source identity"] : [],
    publicationField: null,
  };
}

export interface CostFact {
  observation: CostObservation;
  /** External source-accounting identity, never a local estimate interpreted as an invoice. */
  economicScope: string | null;
  billingWindow: string | null;
  actualProviderReceipt: boolean;
}
export type CostEvaluation =
  | { state: "COMPARABLE"; total: number; currency: string; basis: "BILLED"; denominator: number }
  | { state: "NOT_COMPARABLE"; total: null; currency: null; denominator: 0; limits: string[] };

/** No summation of estimates, unknown invoices or overlapping economic windows. */
export function sumWitnessedBilledCost(facts: CostFact[]): CostEvaluation {
  if (facts.length === 0) return {
    state: "NOT_COMPARABLE", total: null, currency: null, denominator: 0,
    limits: ["no witnessed billing facts"],
  };
  let total = 0;
  let currency: string | null = null;
  const windows = new Set<string>();
  for (const f of facts) {
    const o = f.observation;
    const economic = f.economicScope;
    const window = f.billingWindow;
    const accounting = o.accounting;
    if (
      !f.actualProviderReceipt || o.basis !== "BILLED" ||
      o.epistemic !== "OBSERVED" || typeof o.value !== "number" ||
      !Number.isFinite(o.value) || o.value < 0 ||
      !o.currency || !economic || !window ||
      !accounting?.accounting_ref ||
      accounting.economic_scope_ref !== economic ||
      accounting.billing_window_ref !== window ||
      !accounting.cost_category ||
      o.source_refs.length === 0
    ) return { state: "NOT_COMPARABLE", total: null, currency: null, denominator: 0,
      limits: ["non-billed/estimated, missing invoice witness or accounting identity"] };
    if (currency !== null && currency !== o.currency) return {
      state: "NOT_COMPARABLE", total: null, currency: null, denominator: 0,
      limits: ["mixed currencies without approved FX basis"],
    };
    currency = o.currency;
    const identity = JSON.stringify([economic, window, accounting.cost_category]);
    if (windows.has(identity)) return {
      state: "NOT_COMPARABLE", total: null, currency: null, denominator: 0,
      limits: ["overlapping/duplicate billing window; cannot count twice"],
    };
    windows.add(identity);
    total += o.value;
    if (!Number.isFinite(total)) return {
      state: "NOT_COMPARABLE", total: null, currency: null, denominator: 0,
      limits: ["billing sum overflow"],
    };
  }
  return { state: "COMPARABLE", total, currency: currency as string, basis: "BILLED", denominator: windows.size };
}
