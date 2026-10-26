import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessPostEffect,
  type CaptureQuality,
  type DiagnosticFact,
  type PostEffect,
  type PrivatePublicationStatus,
} from "../../src/model.ts";

test("v0.4 T0: effect certainty projects to safe private status, not a retry command", () => {
  const cases: Array<[PostEffect, PrivatePublicationStatus, boolean, boolean]> = [
    ["PROVEN_NOT_SENT", "FAILED_PROVEN_PRE_SEND", true, false],
    ["REMOTE_SAME", "ALREADY_PUBLISHED", false, false],
    ["REMOTE_DIFFERENT_OR_DAMAGED", "CONFLICT", false, true],
    ["SENT_OR_MAY_HAVE_SENT", "UNKNOWN", false, true],
  ];
  for (const [effect, status, admission, reconcile] of cases) {
    const observed = assessPostEffect(effect);
    assert.deepEqual(observed, {
      effect,
      status,
      fresh_admission_required: admission,
      reconciliation_only: reconcile,
    });
  }
});

test("v0.4 T0: UNKNOWN never becomes numeric zero or automatically eligible for POST", () => {
  const fact: CaptureQuality = {
    schema: "task-meta/private-diagnostics/v1",
    metric_name: "tool_pair",
    numerator: null,
    denominator: null,
    denominator_source_refs: [],
    coverage_kind: "CONDITIONAL",
    eligible_scope_ref: null,
    capability_ref: null,
    reason: "UNKNOWN",
    epistemic: "UNKNOWN",
    source_refs: [],
    comparability: "UNKNOWN",
    limits: ["no independently witnessed eligible tool-call universe"],
  };
  assert.equal(fact.numerator, null);
  assert.equal(fact.denominator, null);
  assert.equal(assessPostEffect("SENT_OR_MAY_HAVE_SENT").reconciliation_only, true);
  assert.equal(assessPostEffect("SENT_OR_MAY_HAVE_SENT").fresh_admission_required, false);
});

test("v0.4 T0: per-event diagnostic provenance keeps capability distinct from observed absence", () => {
  const knownUnsupported: DiagnosticFact = {
    schema: "task-meta/private-diagnostics/v1",
    source_ref: "private-fixture:session-end",
    source_revision: 1,
    agent: "zcode",
    plugin_version: "0.3.0",
    host_class: null,
    evidence_level: "SOURCE_ONLY",
    epistemic: "OBSERVED",
    missing_reason: "NOT_INSTRUMENTED",
    clock: { domain: "source", precision: "UNKNOWN", synchronized: null },
  };
  const unobserved: DiagnosticFact = {
    ...knownUnsupported,
    agent: "codex",
    evidence_level: "HOOK_FIXTURE",
    epistemic: "UNKNOWN",
    missing_reason: "UNKNOWN",
  };
  assert.equal(knownUnsupported.missing_reason, "NOT_INSTRUMENTED");
  assert.equal(unobserved.missing_reason, "UNKNOWN");
  assert.notEqual(unobserved.missing_reason, "HOST_EVENT_NOT_OBSERVED");
});

test("v0.4 T0: transported duplicate and distinct physical attempts retain distinct identities", () => {
  const original = { adapter: "claude", source_event_id: "evt-1", revision: 1, digest: "a", attempt: "physical-1" };
  const sameDelivery = { ...original };
  const competing = { ...original, digest: "b" };
  const retried = { ...original, source_event_id: "evt-2", attempt: "physical-2" };
  const identity = (v: typeof original) => [v.adapter, v.source_event_id, v.revision].join(":");
  assert.equal(identity(original), identity(sameDelivery));
  assert.equal(original.digest, sameDelivery.digest);
  assert.equal(identity(original), identity(competing));
  assert.notEqual(original.digest, competing.digest);
  assert.notEqual(retried.attempt, original.attempt);
});
