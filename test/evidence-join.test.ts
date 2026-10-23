import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttemptSummary, ManifestPointer } from "../src/model.ts";
import { joinFeedbackToSummary, readQualifiedReports, type QualifiedReportRef } from "../src/evidence-join/index.ts";
import type { GitHubClient, IssueComment } from "../src/publish/client.ts";
import { buildReportDocument, renderReportComment } from "../src/report/index.ts";

const REPO = "kaicreator-mm/testrepo";
const ISSUE = 7;
const URL = `https://github.com/${REPO}/issues/${ISSUE}`;
const manifest: ManifestPointer = {
  ref: "object:private/manifests/example",
  sha256: "c".repeat(64), access: "PROJECT_PRIVATE",
};
function sourceSummary(): AttemptSummary {
  return {
    repository: REPO, issue_number: ISSUE, task_ref: `${REPO}#${ISSUE}`,
    attempt_ref: "actual-attempt-1", attempt_binding: "COLLECTOR_ONLY",
    source_sha: "a".repeat(40),
    actor: { role: "builder", operator_kind: "agent",
      operator_id: "agent:1", session_ref: "session:1", transport_actor: null },
    observed_at: "2026-10-24T00:00:00Z",
    observation_refs: ["agent:event:1"],
    capture_coverage: "PARTIAL",
    limits: ["incomplete test source"],
    metrics: [], cost: { value: null, currency: null, basis: "UNKNOWN",
      pricing_basis: null, epistemic: "UNKNOWN", source_refs: [] },
    attempt_refs: ["actual-attempt-1"], excluded_attempt_refs: [],
    verifier: { status: "PARTIAL", subject_sha: null,
      checked: ["synthetic gate"], failed: [], skipped: [], unchecked: ["independent verifier"],
      coverage: "PARTIAL", epistemic: "OBSERVED", source_refs: ["synthetic:gate"] },
    learning: { state: "UNKNOWN", source_refs: [] },
  };
}
const goodBody = () => renderReportComment(buildReportDocument(sourceSummary(), manifest,
  { profile: "v4", revision: 1, supersedes: null }));
const comment = (id: number, body: string): IssueComment => ({
  id, body, user_login: "shared-github-login",
  html_url: `${URL}#issuecomment-${id}`,
});
function fake(pages: IssueComment[][], failAt = -1): Pick<GitHubClient, "listIssueComments"> {
  return {
    async listIssueComments(_repo, _issue, page) {
      if (page === failAt) throw Error("HTTP 403");
      return { comments: pages[page - 1] ?? [], hasNext: page < pages.length };
    },
  };
}

test("T01 real native report reference parses only from canonical owning GitHub comment", async () => {
  const v = await readQualifiedReports(fake([[comment(17, "non ADS comment"), comment(18, goodBody())]]), REPO, ISSUE);
  assert.equal(v.state, "COMPLETE");
  if (v.state !== "COMPLETE") return;
  assert.equal(v.ignored, 1);
  assert.equal(v.reports.length, 1);
  assert.equal(v.reports[0]?.commentUrl, `${URL}#issuecomment-18`);
  assert.equal(v.reports[0]?.reportKind, "EXECUTION_SUMMARY");
  assert.equal(v.reports[0]?.attemptRef, "actual-attempt-1");
});

test("T01 foreign or edited source comment never becomes verified fact", async () => {
  const foreign = { ...comment(18, goodBody()), html_url: `https://github.com/other/repo/issues/1#issuecomment-18` };
  const v = await readQualifiedReports(fake([[foreign]]), REPO, ISSUE);
  assert.equal(v.state, "UNKNOWN");
  const changed = await readQualifiedReports(fake([
    [comment(18, goodBody())], [comment(18, goodBody() + "changed")],
  ]), REPO, ISSUE);
  assert.equal(changed.state, "CONFLICT");
});

test("T01 interrupted pagination is UNKNOWN, never an empty successful absence", async () => {
  const v = await readQualifiedReports(fake([[comment(18, goodBody())], []], 2), REPO, ISSUE);
  assert.equal(v.state, "UNKNOWN");
  if (v.state !== "COMPLETE") assert.equal(v.reports.length, 0);
});
function ref(id: number, kind: string, refs: string[], phase: QualifiedReportRef["feedbackPhase"] = null): QualifiedReportRef {
  return {
    kind: "ADS_REPORT", repository: REPO, issueNumber: ISSUE,
    commentId: id, commentUrl: `${URL}#issuecomment-${id}`,
    profile: "v5", reportId: `report:${id}`, revision: 1,
    publisherNamespace: id === 18 ? "task-meta:publisher" : "tally:publisher",
    reportKind: kind, taskRef: `${REPO}#${ISSUE}`, attemptRef: "actual-attempt-1",
    dataDigest: "a".repeat(64), sourceRefs: refs, feedbackPhase: phase,
  };
}

test("T01 factual feedback join remains material-use/effect UNKNOWN even if source link witnessed", () => {
  const s = ref(18, "EXECUTION_SUMMARY", []);
  const f = ref(19, "EXPERIENCE_USE_FEEDBACK", [s.commentUrl], "APPLIED");
  const view = { state: "COMPLETE" as const, reports: [s, f], ignored: 0 };
  const joined = joinFeedbackToSummary(view, s.commentUrl, f.commentUrl);
  assert.equal(joined.state, "VERIFIED_REFERENCE");
  assert.equal(joined.phase, "APPLIED");
  assert.equal(joined.materialUse, "UNKNOWN");
  assert.equal(joined.effectiveness, "UNKNOWN");
  // No actual native source-reference edge, no factual linkage can be claimed.
  const unlinked = joinFeedbackToSummary(
    { ...view, reports: [s, { ...f, sourceRefs: ["unrelated"] }] },
    s.commentUrl, f.commentUrl,
  );
  assert.equal(unlinked.state, "UNKNOWN");
  const wrongAttempt = joinFeedbackToSummary(
    { ...view, reports: [s, { ...f, attemptRef: "different-attempt" }] },
    s.commentUrl, f.commentUrl,
  );
  assert.equal(wrongAttempt.state, "UNKNOWN");
});
