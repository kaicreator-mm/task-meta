import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ComparableMetricInput,
  type CostFact,
  compareCounterMetrics,
  sumWitnessedBilledCost,
} from "../src/metrics/comparison.ts";
import type { MetricValue } from "../src/model.ts";

function sample(
  id: string,
  attempt: string,
  value: number | null = 12,
  over: Partial<ComparableMetricInput> = {},
): ComparableMetricInput {
  const metric: MetricValue = {
    name: "input_tokens",
    value,
    unit: "token",
    epistemic: "OBSERVED",
    coverage: "COMPLETE",
    source_refs: [`observed:${id}`],
    identity: {
      metric_id: `input:${id}`,
      observation_id: `obs:${id}`,
      logical_call_ref: `call:${id}`,
      physical_attempt_ref: attempt,
      adapter_id: "zcode",
      provider_run_ref: null,
      measurement_kind: "COUNTER_DELTA",
      window_id: `window:${id}`,
      source_revision: 1,
    },
  };
  return {
    metric,
    adsProfile: "v5",
    privacyClearance: "PUBLISHABLE",
    cohortRef: "qualified-cohort",
    ...over,
  };
}

test("T03 distinct physical attempts are counted; identical deliveries not billed twice", () => {
  const a = sample("one", "attempt-1");
  const b = sample("two", "attempt-2");
  const r = compareCounterMetrics([a, a, b]);
  assert.equal(r.state, "COMPARABLE");
  assert.equal(r.total, 24);
  assert.equal(r.denominator, 2);
  assert.equal(r.excluded, 1);
  assert.equal(r.publicationField, null);
});

test("T03 unknown, restricted or mixed profile never yields a fabricated zero", () => {
  assert.equal(compareCounterMetrics([]).total, null);
  assert.equal(compareCounterMetrics([sample("zero", "attempt-1", null)]).total, null);
  assert.equal(
    compareCounterMetrics([sample("one", "attempt-1", 12, { adsProfile: "v4" })]).state,
    "NOT_COMPARABLE",
  );
  assert.equal(
    compareCounterMetrics([sample("one", "attempt-1", 12, { privacyClearance: "RESTRICTED" })])
      .state,
    "NOT_COMPARABLE",
  );
});

test("T03 same economic/call physical identity with conflicting observations is held", () => {
  const a = sample("one", "attempt-1", 12);
  const b = sample("one", "attempt-1", 23);
  const r = compareCounterMetrics([a, b]);
  assert.equal(r.state, "NOT_COMPARABLE");
  assert.equal(r.total, null);
});

test("T03 no input+cache token addition or inferred cumulative snapshot", () => {
  const a = sample("one", "attempt-1");
  const cache = sample("two", "attempt-1");
  cache.metric.name = "cache_read_tokens";
  assert.equal(compareCounterMetrics([a, cache]).state, "NOT_COMPARABLE");
  const cumulative = sample("one", "attempt-1");
  if (cumulative.metric.identity)
    cumulative.metric.identity.measurement_kind = "CUMULATIVE_SNAPSHOT";
  assert.equal(compareCounterMetrics([cumulative]).state, "NOT_COMPARABLE");
});

const billed = (value: number, scope = "scope-1", window = "invoice-1"): CostFact => ({
  actualProviderReceipt: true,
  economicScope: scope,
  billingWindow: window,
  observation: {
    value,
    currency: "USD",
    basis: "BILLED",
    pricing_basis: "provider invoice",
    epistemic: "OBSERVED",
    source_refs: [`invoice:${window}`],
    accounting: {
      accounting_ref: `acct:${window}`,
      economic_scope_ref: scope,
      billing_window_ref: window,
      cost_category: "model",
    },
  },
});
test("T03 invoice-confirmed distinct economic billing windows are comparable", () => {
  const r = sumWitnessedBilledCost([billed(1), billed(2, "scope-1", "invoice-2")]);
  assert.equal(r.state, "COMPARABLE");
  if (r.state === "COMPARABLE") assert.equal(r.total, 3);
});
test("T03 no double billing and no source-free or estimated invoice promotion", () => {
  assert.equal(sumWitnessedBilledCost([billed(1), billed(1)]).state, "NOT_COMPARABLE");
  const estimated = billed(1);
  estimated.observation.basis = "ESTIMATED";
  assert.equal(sumWitnessedBilledCost([estimated]).state, "NOT_COMPARABLE");
  const unwitnessed = billed(1);
  unwitnessed.actualProviderReceipt = false;
  assert.equal(sumWitnessedBilledCost([unwitnessed]).state, "NOT_COMPARABLE");
});
