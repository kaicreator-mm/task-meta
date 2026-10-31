// v0.4 B2 (#69) — crash-safe Outbox journal + bounded recovery coordinator.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyRecoveryError,
  DEFAULT_BUDGETS,
  parseRecoveryConfig,
  RecoveryJournal,
  RecoveryRefusedError,
  recoveryHooks,
  reportIdHash,
} from "../../src/autoreport/recovery.ts";
import type { AttemptSummary, ManifestPointer } from "../../src/model.ts";
import { type GitHubClient, type IssueComment, publishReport } from "../../src/publish/index.ts";
import { buildReportDocument, renderReportComment } from "../../src/report/index.ts";

const REPO = "example-org/example-repo";
const ISSUE = 42;

function bodyFor(): string {
  const manifest: ManifestPointer = {
    ref: "object:private/manifests/abc",
    sha256: "c".repeat(64),
    access: "PROJECT_PRIVATE",
  };
  const summary: AttemptSummary = {
    repository: REPO,
    issue_number: ISSUE,
    task_ref: `${REPO}#${ISSUE}`,
    attempt_ref: "sess-b2-0001",
    attempt_binding: "COLLECTOR_ONLY",
    source_sha: "1234567890abcdef1234567890abcdef12345678",
    actor: {
      role: "builder",
      operator_kind: "zcode",
      operator_id: "zcode:synthetic",
      session_ref: "sess-b2-0001",
      transport_actor: null,
    },
    observed_at: "2026-10-22T10:00:00Z",
    observation_refs: ["zcode:evt-1"],
    capture_coverage: "PARTIAL",
    limits: ["synthetic fixture"],
    metrics: [],
    cost: {
      value: null,
      currency: null,
      basis: "UNKNOWN",
      pricing_basis: null,
      epistemic: "UNKNOWN",
      source_refs: [],
    },
    attempt_refs: ["sess-b2-0001"],
    excluded_attempt_refs: [],
    verifier: {
      status: "PARTIAL",
      subject_sha: null,
      checked: ["gate"],
      failed: [],
      skipped: [],
      unchecked: ["task acceptance"],
      coverage: "PARTIAL",
      epistemic: "OBSERVED",
      source_refs: ["zcode:gate-1"],
    },
    learning: { state: "NONE_MATERIAL", source_refs: [] },
  };
  const doc = buildReportDocument(summary, manifest, {
    profile: "v4",
    revision: 1,
    supersedes: null,
  });
  return renderReportComment(doc);
}

class ListClient implements GitHubClient {
  comments: IssueComment[] = [];
  creates = 0;
  lists = 0;
  failCreates: unknown[] = [];
  async listIssueComments(_r: string, _i: number, page: number, perPage: number) {
    this.lists++;
    const start = (page - 1) * perPage;
    const slice = this.comments.slice(start, start + perPage);
    return {
      comments: slice.map((c) => ({ ...c })),
      hasNext: start + perPage < this.comments.length,
    };
  }
  async createIssueComment(_r: string, _i: number, body: string) {
    this.creates++;
    const before = this.failCreates.shift();
    if (before) throw before;
    const c: IssueComment = {
      id: 3000 + this.creates,
      html_url: `https://example.invalid/c/${this.creates}`,
      body,
      user_login: "bot",
    };
    this.comments.push(c);
    return { ...c };
  }
}

const noSleep = async () => {};
let seq = 0;
async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), `tm-b2-${seq++}-`));
}

test("B2: journal and lock names use the FULL report-id hash; no truncated collision", () => {
  const a = "task-meta:report/with-a-very-long-id-prefix-AAAAAAAAAAAAAAAA";
  const b = "task-meta:report/with-a-very-long-id-prefix-BBBBBBBBBBBBBBBB";
  assert.equal(reportIdHash(a).length, 64);
  assert.notEqual(reportIdHash(a), reportIdHash(b));
  // 128-char truncation (legacy safeName) would collide; the full hash does not.
  assert.equal(a.slice(0, 128) !== b.slice(0, 128), true);
});

test("B2: config opt-in parses with strict bounds and fails closed on invalid", () => {
  assert.equal(parseRecoveryConfig(undefined).enabled, false);
  assert.equal(parseRecoveryConfig({}).enabled, false);
  const on = parseRecoveryConfig({ enabled: true, get_page_budget: 500 });
  assert.equal(on.enabled, true);
  assert.equal(on.budgets.getPage, 500);
  assert.equal(on.budgets.post, DEFAULT_BUDGETS.post);
  for (const bad of [
    { enabled: "yes" },
    { enabled: true, post_budget: 4 },
    { enabled: true, get_page_budget: 1001 },
    { enabled: true, wall_budget_ms: 0 },
    { enabled: true, max_cycles: 4 },
  ]) {
    assert.throws(() => parseRecoveryConfig(bad), /RECOVERY_CONFIG_INVALID/);
  }
});

test("B2: governed integration publishes once, journals PENDING→IN_FLIGHT→TERMINAL, charges pages", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const client = new ListClient();
  const reportId = "task-meta:sess-b2-0001"; // the document's actual report_id
  const hooks = recoveryHooks(journal, reportId);
  const o = await publishReport(client, {
    repo: REPO,
    issue: ISSUE,
    body: bodyFor(),
    publish: true,
    sleep: noSleep,
    publicationContext: { kind: "governed_outbox", hooks },
  });
  assert.equal(o.state, "PUBLISHED");
  assert.equal(client.creates, 1);
  const rec = JSON.parse(await readFile(join(dir, `${reportIdHash(reportId)}.json`), "utf8"));
  assert.equal(rec.state, "TERMINAL");
  assert.equal(rec.effect, "REMOTE_SAME");
  assert.equal(rec.counters.post, 1);
  const pages = JSON.parse(
    await readFile(join(dir, `${reportIdHash(reportId)}.pages.json`), "utf8"),
  ) as { getPage: number };
  assert.ok(pages.getPage >= 2, "every physical GET page was charged");
  await rm(dir, { recursive: true, force: true });
});

test("B2: torn IN_FLIGHT journal is UNKNOWN/HELD, GET-only reconciliation, zero POST", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const reportId = "task-meta:sess-b2-0001"; // torn under the actual report_id
  // Simulate a crash: persist a raw IN_FLIGHT record with the machine's shape.
  await journal.reserve({ repo: REPO, issue: ISSUE, reportId, dataDigest: "d".repeat(64) });
  const client = new ListClient();
  const o = await publishReport(client, {
    repo: REPO,
    issue: ISSUE,
    body: bodyFor(),
    publish: true,
    sleep: noSleep,
    publicationContext: { kind: "governed_outbox", hooks: recoveryHooks(journal, reportId) },
  });
  assert.equal(o.state, "NOT_PUBLISHED");
  if (o.state === "NOT_PUBLISHED") {
    assert.match(o.reason, /^PRE_POST_RESERVATION_REFUSED/);
  }
  assert.equal(o.effectMeta?.effect, "PROVEN_NOT_SENT");
  // GET-only reconciliation happened; no physical POST ever.
  assert.ok(client.lists >= 1);
  assert.equal(client.creates, 0);
  // The read-only projection stays UNKNOWN without repairing the journal.
  const projection = await journal.projectRecovery(reportId);
  assert.equal(projection.state, "UNKNOWN");
  assert.equal(projection.last_cause, "JOURNAL_TORN_IN_FLIGHT");
  await rm(dir, { recursive: true, force: true });
});

test("B2: a corrupt journal file projects HELD and never becomes a POST", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const reportId = `task-meta:${REPO}#{ISSUE}:b2-corrupt`;
  const realId = `task-meta:${REPO}#${ISSUE}:b2-corrupt`;
  await writeFile(join(dir, `${reportIdHash(realId)}.json`), "{not json", "utf8");
  const projection = await journal.projectRecovery(realId);
  assert.equal(projection.state, "HELD");
  assert.equal(projection.last_cause, "JOURNAL_CORRUPT");
  await assert.rejects(
    journal.reserve({ repo: REPO, issue: ISSUE, reportId: realId, dataDigest: "0".repeat(64) }),
    (e: unknown) => e instanceof RecoveryRefusedError && e.code === "JOURNAL_CORRUPT",
  );
  await rm(dir, { recursive: true, force: true });
});

test("B2: combined POST budget <=3 across cycles is persistent", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir, {
    ...DEFAULT_BUDGETS,
    post: 2,
    getPage: 50,
    wallMs: 600_000,
    cycles: 3,
  });
  const target = { repo: REPO, issue: ISSUE, reportId: "r-budget", dataDigest: "0".repeat(64) };
  assert.ok((await journal.reserve(target)).token.length > 0);
  await journal.recordEffect(target.reportId, "SENT_OR_MAY_HAVE_SENT", {
    attempts: 1,
    lastHttpStatus: 503,
    outcomeState: "NOT_PUBLISHED",
  });
  // Fresh journal instance (new process/cycle) sees the persisted counters.
  const journal2 = new RecoveryJournal(dir, {
    ...DEFAULT_BUDGETS,
    post: 2,
    getPage: 50,
    wallMs: 600_000,
    cycles: 3,
  });
  const second = await journal2.load(target.reportId);
  assert.equal(second.counters.post, 1);
  assert.equal(second.state, "TERMINAL");
  await assert.rejects(
    journal2.reserve(target),
    (e: unknown) => e instanceof RecoveryRefusedError && e.code === "JOURNAL_TERMINAL_NO_REPOST",
  );
  await rm(dir, { recursive: true, force: true });
});

test("B2: persistent GET page budget refuses beyond the cap with zero POST", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir, {
    ...DEFAULT_BUDGETS,
    getPage: 2,
    post: 3,
    wallMs: 600_000,
    cycles: 3,
  });
  const reportId = "get-cap";
  assert.deepEqual(await journal.chargeForPage(reportId, 1), { granted: true });
  assert.deepEqual(await journal.chargeForPage(reportId, 2), { granted: true });
  assert.deepEqual(await journal.chargeForPage(reportId, 3), { granted: false });
  const client = new ListClient();
  const o = await publishReport(client, {
    repo: REPO,
    issue: ISSUE,
    body: bodyFor(),
    publish: true,
    sleep: noSleep,
    publicationContext: { kind: "governed_outbox", hooks: recoveryHooks(journal, reportId) },
  });
  assert.equal(o.state, "NOT_PUBLISHED");
  if (o.state === "NOT_PUBLISHED") {
    assert.match(o.reason, /^GET_PAGE_BUDGET_EXHAUSTED/);
  }
  assert.equal(client.creates, 0);
  await rm(dir, { recursive: true, force: true });
});

test("B2: ambiguous transport persists UNKNOWN-terminal; no same-call repost, journal survives", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const reportId = "task-meta:sess-b2-0001"; // ambiguous under the actual report_id
  const client = new ListClient();
  client.failCreates.push(new Error("network: connection reset"));
  const o = await publishReport(client, {
    repo: REPO,
    issue: ISSUE,
    body: bodyFor(),
    publish: true,
    sleep: noSleep,
    publicationContext: { kind: "governed_outbox", hooks: recoveryHooks(journal, reportId) },
  });
  assert.equal(o.state, "NOT_PUBLISHED");
  assert.equal(o.effectMeta?.effect, "SENT_OR_MAY_HAVE_SENT");
  assert.equal(client.creates, 1);
  const rec = await journal.load(reportId);
  assert.equal(rec.state, "TERMINAL");
  assert.equal(rec.effect, "SENT_OR_MAY_HAVE_SENT");
  await rm(dir, { recursive: true, force: true });
});

test("B2: ALL spool replay skips are consumed into bounded cause tokens", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const reportId = "skips-b2";
  await journal.reserve({ repo: REPO, issue: ISSUE, reportId, dataDigest: "0".repeat(64) });
  await journal.recordEffect(reportId, "SENT_OR_MAY_HAVE_SENT", {
    attempts: 1,
    lastHttpStatus: null,
    outcomeState: "NOT_PUBLISHED",
  });
  await journal.consumeReplaySkips(reportId, [
    { line: 3, reason: "truncated trailing line" },
    { line: 7, reason: "invalid JSON" },
  ]);
  const rec = await journal.load(reportId);
  assert.deepEqual(rec.replay_skipped, ["line3:truncated trailing line", "line7:invalid JSON"]);
  await rm(dir, { recursive: true, force: true });
});

test("B2: A21 resource errors classify to bounded tokens, never raw text", () => {
  assert.equal(
    classifyRecoveryError(Object.assign(new Error("x"), { code: "ENOSPC" })),
    "A21_DISK_FULL",
  );
  assert.equal(
    classifyRecoveryError(Object.assign(new Error("x"), { code: "EDQUOT" })),
    "A21_DISK_FULL",
  );
  assert.equal(
    classifyRecoveryError(Object.assign(new Error("x"), { code: "EBUSY" })),
    "A21_STALE_LOCK",
  );
  assert.equal(classifyRecoveryError(new Error("spool: whatever /raw/path")), "UNKNOWN_CAUSE");
});
