import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildIssueDag } from "../../src/lineage/dag.ts";
import type {
  AttemptSummary, ManifestPointer, MetricValue, VersionLineage,
} from "../../src/model.ts";
import { compareCounterMetrics } from "../../src/metrics/comparison.ts";
import { findReports, publishReport } from "../../src/publish/publish.ts";
import type { GitHubClient } from "../../src/publish/client.ts";
import {
  CANDIDATE_PIN, loadAdoption, QUALIFIED_V416_MAIN_SHA,
  resolveProfile, VENDORED_V416_SCHEMA_BLOB, vendoredV416SchemaBlob,
} from "../../src/report/pin.ts";
import {
  buildReportDocument, renderReportComment, reportDataDigest, validateReportDocument,
} from "../../src/report/index.ts";
import { dispositionOfCorrection, readCorrectionTarget } from "../../src/correction/index.ts";
import { evaluateGovernedTrajectory, type GovernedSelection } from "../../src/trajectory/index.ts";

const golden = JSON.parse(readFileSync(new URL("./golden-r0.json", import.meta.url), "utf8")) as {
  suite: string;
  implementation_version_base: string;
  ads_v416_qualified_main: string;
  ads_v5_schema_blob: string;
  fixtures: { id: string; task: string; scenario: string; expected: string; source_sha: string }[];
  real_agent_provider_result: string;
  real_github_post_and_readback: string;
  tally_consumer_material_use: string;
  release_qualification: string;
};

test("T05 all source-only Golden oracles have exact source pins; no physical proof fabricated", () => {
  assert.equal(golden.suite, "task-meta/v0.3/golden-source-only/r0");
  assert.equal(golden.ads_v416_qualified_main, QUALIFIED_V416_MAIN_SHA);
  assert.equal(golden.ads_v5_schema_blob, VENDORED_V416_SCHEMA_BLOB);
  assert.equal(vendoredV416SchemaBlob(), golden.ads_v5_schema_blob);
  assert.equal(golden.fixtures.length, 12);
  assert.deepEqual(golden.fixtures.map((f) => f.id), Array.from({ length: 12 }, (_, i) =>
    `G${String(i).padStart(2, "0")}`));
  for (const f of golden.fixtures) {
    assert.match(f.source_sha, /^[0-9a-f]{40}$/);
    assert.ok(f.task.startsWith("T0"));
    assert.ok(f.scenario.length > 10 && f.expected.length > 2);
  }
  for (const key of [
    golden.real_agent_provider_result, golden.real_github_post_and_readback,
    golden.tally_consumer_material_use, golden.release_qualification,
  ]) assert.equal(key, "NOT_RUN");
});

test("G00/G01: historical candidate is no ordinary adoption; real main is qualified", () => {
  const legacy = { adopted: [], owner_authorized: [{
    ads_version: "4.16", ads_pin: CANDIDATE_PIN, report_schema_blob: VENDORED_V416_SCHEMA_BLOB,
    profile: "v5" as const, scope: "all" as const,
    authorization_ref: "legacy-not-effective", authorized_on: "2026-10-23",
  }] };
  const denied = resolveProfile({ adoption: legacy, publish: true, repository: "some/repo" });
  assert.ok(!denied.ok && denied.code === "UNQUALIFIED_CANDIDATE_DEFAULT");
  const normal = resolveProfile({ adoption: loadAdoption(), publish: true, repository: "some/repo" });
  assert.ok(normal.ok && normal.profile === "v5" && normal.mode === "ADOPTED" &&
    normal.adsRevision === QUALIFIED_V416_MAIN_SHA);
});

test("G02: forging candidate E2E purpose on ordinary repository is refused", () => {
  const denial = resolveProfile({
    adoption: loadAdoption(), profile: "v5", adsPin: CANDIDATE_PIN,
    publish: true, repository: "kaicreator-mm/task-meta", e2eTestOnly: true,
  });
  assert.ok(!denial.ok && denial.code === "CANDIDATE_NOT_PUBLISHABLE");
});

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
function lineage(attemptRef: string): VersionLineage {
  return {
    versions: [SHA_A, SHA_B].map((sha) => ({
      version_id: `git:${sha}`, sha, parents: null,
      first_seen_at: null, observed_in: [`run:${attemptRef}`],
      observability: "UNKNOWN" as const, epistemic: "OBSERVED" as const,
    })),
    transitions: [{
      transition_id: "transition-1", from_version: `git:${SHA_A}`,
      to_version: `git:${SHA_B}`, run_segment_ref: "run-1",
      started_at: null, finished_at: null,
      change: { files_changed: 1, insertions: 1, deletions: 0, diff_digest: null },
      verifier_refs: [], kind: "ADVANCE", epistemic: "OBSERVED", limits: [],
    }],
    revisits: [], limits: [],
  };
}
test("G03/G04: genuine distinct Attempts survive identical source transition; replay/conflict do not", async () => {
  const a1 = { attempt_ref: "attempt-1", lineage: lineage("a1"), started_at: null };
  const a2 = { attempt_ref: "attempt-2", lineage: lineage("a2"), started_at: null };
  const real = await buildIssueDag({
    repository: "sample/repo", issue_number: 7, attempts: [a1, a2],
  });
  assert.deepEqual(real.attempts, ["attempt-1", "attempt-2"]);
  assert.equal(real.edges.filter((e) => e.kind === "TRANSITION").length, 2);
  const repeat = await buildIssueDag({
    repository: "sample/repo", issue_number: 7, attempts: [a1, structuredClone(a1)],
  });
  assert.equal(repeat.attempts.length, 1);
  assert.ok(repeat.gaps.some((x) => x.kind === "DUPLICATE_ATTEMPT"));
  const changed = structuredClone(a1);
  changed.lineage.transitions[0]!.change.insertions = 2;
  const conflicting = await buildIssueDag({
    repository: "sample/repo", issue_number: 7, attempts: [a1, changed],
  });
  assert.equal(conflicting.attempts.length, 0);
  assert.ok(conflicting.gaps.some((x) => x.kind === "ATTEMPT_SOURCE_CONFLICT"));
});

const REPO = "sample/repo";
const ISSUE = 7;
const ISSUE_URL = `https://github.com/${REPO}/issues/${ISSUE}`;
const REF = `${ISSUE_URL}#issuecomment-31`;
const manifest: ManifestPointer = {
  ref: "object:private/manifest:sample", sha256: "c".repeat(64), access: "PROJECT_PRIVATE",
};
function source(): AttemptSummary {
  return {
    repository: REPO, issue_number: ISSUE, task_ref: `${REPO}#${ISSUE}`,
    attempt_ref: "attempt:1", attempt_binding: "COLLECTOR_ONLY",
    source_sha: SHA_A, observed_at: "2026-10-24T00:00:00Z",
    actor: { role: "builder", operator_kind: "agent", operator_id: "agent:1",
      session_ref: "session:1", transport_actor: null },
    observation_refs: ["actual-observation:1"], capture_coverage: "PARTIAL",
    limits: ["synthetic Golden source only"], metrics: [],
    cost: { value: null, currency: null, basis: "UNKNOWN", pricing_basis: null,
      epistemic: "UNKNOWN", source_refs: [] },
    attempt_refs: ["attempt:1"], excluded_attempt_refs: [],
    verifier: { status: "PARTIAL", subject_sha: null,
      checked: ["fixture-check"], failed: [], skipped: [],
      unchecked: ["real host"], coverage: "PARTIAL", epistemic: "OBSERVED",
      source_refs: ["test:fixture"] },
    learning: { state: "UNKNOWN", source_refs: [] },
  };
}
function correctionFixture(notice: "DISPUTE" | "REVOKE") {
  const original = buildReportDocument(source(), manifest, {
    profile: "v4", revision: 1, supersedes: null,
  });
  const data = original.data;
  const subject = data.subject as Record<string, unknown>;
  const correction = {
    schema: "ads/github/v4", kind: "report" as const,
    data: {
      report_id: "correction:1", revision: 1, publisher_namespace: data.publisher_namespace,
      report_kind: "EXECUTION_CORRECTION", subject: data.subject, actor: data.actor,
      observed_at: data.observed_at, source_refs: [REF], limits: [], supersedes: null,
      target: { comment_ref: REF, report_id: data.report_id, revision: data.revision,
        report_kind: data.report_kind, publisher_namespace: data.publisher_namespace,
        issue_ref: subject.issue_ref, task_ref: subject.task_ref,
        data_digest: reportDataDigest(data) },
      reason: "source owner correction is an independent immutable notice", notice,
    },
  };
  return { original: renderReportComment(original), correction: renderReportComment(correction), data };
}
test("G05/G06: strict v4 8-field correction and DISPUTE even by owner never revokes", async () => {
  const fx = correctionFixture("DISPUTE");
  const original = { id: 31, html_url: REF, body: fx.original, user_login: "shared-transport" };
  const client = {
    async listIssueComments() { return { comments: [original], hasNext: false }; },
  };
  const target = await readCorrectionTarget(client, REPO, ISSUE, fx.correction);
  assert.equal(target.state, "VERIFIED_CURRENT");
  const disposition = dispositionOfCorrection(fx.correction, target, {
    qualification: "VERIFIED", publisherNamespace: String(fx.data.publisher_namespace),
    taskRef: `${REPO}#${ISSUE}`, attemptRef: null,
    evidenceRefs: ["independent-native-owner:1"],
  });
  assert.equal(disposition.state, "DISPUTED_NONREVOKING");
  assert.equal(disposition.materialUseSafe, false);
  const v5 = JSON.parse(readFileSync(
    new URL("../../vendor/ads/v4.16/report.schema.json", import.meta.url), "utf8",
  )) as { $defs: { correction: { properties: { target: { required: string[] } } } } };
  const v4 = JSON.parse(readFileSync(
    new URL("../../vendor/ads/v4.15/report.schema.json", import.meta.url), "utf8",
  )) as { $defs: { correction: { properties: { target: { required: string[] } } } } };
  assert.equal(Object.keys((JSON.parse(JSON.stringify(v4.$defs.correction.properties.target)) as object)).length > 0, true);
  assert.equal(v4.$defs.correction.properties.target.required.length, 8);
  assert.equal(v5.$defs.correction.properties.target.required.length, 14);
  assert.deepEqual(validateReportDocument(buildReportDocument(source(), manifest, {
    profile: "v4", revision: 1, supersedes: null,
  }), "v4"), { valid: true });
});

test("G07: partial native pagination cannot grant publish/no duplicate POST", async () => {
  let creates = 0;
  const client: GitHubClient = {
    async listIssueComments() { return { comments: [], hasNext: true }; },
    async createIssueComment() { creates++; throw Error("should never POST"); },
  };
  const result = await publishReport(client, {
    repo: REPO, issue: ISSUE, body: correctionFixture("DISPUTE").original,
    publish: true, maxRetries: 0,
  });
  assert.equal(result.state, "NOT_PUBLISHED");
  assert.equal(creates, 0);
  await assert.rejects(findReports(client, REPO, ISSUE), /partial or invalid native GitHub pagination/);
});

function metric(id: string): MetricValue {
  return {
    name: "input_tokens", unit: "token", value: 12,
    epistemic: "OBSERVED", coverage: "COMPLETE", source_refs: ["source:1"],
    identity: { metric_id: "input:1", observation_id: "obs:1", logical_call_ref: "call:1",
      physical_attempt_ref: id, provider_run_ref: null, adapter_id: "zcode",
      measurement_kind: "COUNTER_DELTA", window_id: "window:1", source_revision: 1 },
  };
}
test("G08/G09: repeat physical counter delivery dedups, private-only, mixed profile UNKNOWN", () => {
  const a = { metric: metric("attempt-1"), adsProfile: "v5" as const,
    privacyClearance: "PUBLISHABLE" as const, cohortRef: "cohort:1" };
  const same = compareCounterMetrics([a, structuredClone(a)]);
  assert.equal(same.state, "COMPARABLE");
  assert.equal(same.total, 12);
  assert.equal(same.denominator, 1);
  assert.equal(same.publicationField, null);
  const b = { ...a, adsProfile: "v4" as const };
  const mixed = compareCounterMetrics([a, b]);
  assert.equal(mixed.state, "NOT_COMPARABLE");
  assert.equal(mixed.total, null);
  assert.equal(mixed.denominator, 0);
});

function selection(id: string, previous: string | null, equiv: string | null): GovernedSelection {
  return {
    selectionId: id, previousSelectionId: previous,
    strategyOwnerRef: "strategy-owner:1", scopeRef: "product:1", cohortRef: "task:1",
    lane: "OBSERVED", labelerRevision: null, featureCoverage: "COMPLETE",
    authority: "VERIFIED_SOURCE",
    causalWitnessRefs: previous ? [`native:causal:${id}`] : [],
    ownerWitnessRefs: [`native:owner:${id}`],
    comparison: previous ? "CHANGED" : "UNKNOWN",
    equivalentDepartedSelectionId: equiv,
    nonmatchDepartedSelectionIds: [], equivalenceWitnessRefs: [`native:equivalence:${id}`],
  };
}
test("G10/G11: owner-witnessed A→B→A' 2/2 & 1/1; source ambiguity never yields false zero", () => {
  const a = selection("A", null, null);
  const b = selection("B", "A", null);
  const c = selection("A-prime", "B", "A");
  const yes = evaluateGovernedTrajectory([a, b, c], "OBSERVED", "task:1", "product:1", null);
  assert.equal(yes.pivot.numerator, 2);
  assert.equal(yes.pivot.denominator, 2);
  assert.equal(yes.revisit.numerator, 1);
  assert.equal(yes.revisit.denominator, 1);
  const unknown = { ...b, authority: "SELF_REPORTED" as const };
  const no = evaluateGovernedTrajectory([a, unknown, c], "OBSERVED", "task:1", "product:1", null);
  assert.equal(no.pivot.denominator, 0);
  assert.equal(no.pivot.numerator, null);
  assert.equal(no.revisit.comparability, "NOT_COMPARABLE");
});
