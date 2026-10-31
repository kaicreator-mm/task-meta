// v0.4 B2 (#69) R1 — crash-safe journal, interprocess CAS, strict reads,
// revision binding, chain integrity, budgets, full-hash locks.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyRecoveryError,
  computeChainEvidence,
  DEFAULT_BUDGETS,
  parseRecoveryConfig,
  RecoveryJournal,
  RecoveryRefusedError,
  recordKey,
  recoveryHooks,
  reportIdHash,
} from "../../src/autoreport/recovery.ts";
import type { AttemptSummary, ManifestPointer } from "../../src/model.ts";
import { type GitHubClient, type IssueComment, publishReport } from "../../src/publish/index.ts";
import { buildReportDocument, renderReportComment } from "../../src/report/index.ts";

const REPO = "example-org/example-repo";
const ISSUE = 42;

function summaryFor(): AttemptSummary {
  return {
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
}

function bodyFor(): string {
  const manifest: ManifestPointer = {
    ref: "object:private/manifests/abc",
    sha256: "c".repeat(64),
    access: "PROJECT_PRIVATE",
  };
  const doc = buildReportDocument(summaryFor(), manifest, {
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
  return mkdtemp(join(tmpdir(), `tm-b2r1-${seq++}-`));
}
const REPORT_ID = "task-meta:sess-b2-0001"; // the document's actual report_id
const isRefusal = (code: string) => (e: unknown) =>
  e instanceof RecoveryRefusedError && e.code === code;

test("B2 R1: journal AND lock names use full hashes; legacy-truncation collisions impossible", () => {
  const a = "task-meta:x".padEnd(200, "A");
  const b = "task-meta:x".padEnd(200, "B");
  assert.equal(a.slice(0, 128) !== b.slice(0, 128), true);
  assert.notEqual(reportIdHash(a), reportIdHash(b));
  assert.notEqual(recordKey(a, 1), recordKey(b, 1));
  assert.equal(recordKey(a, 1).length, 64);
});

test("B2 R1: config opt-in parses with strict bounds and fails closed on invalid", () => {
  assert.equal(parseRecoveryConfig(undefined).enabled, false);
  const on = parseRecoveryConfig({ enabled: true, get_page_budget: 500 });
  assert.equal(on.enabled, true);
  assert.equal(on.budgets.getPage, 500);
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

test("B2 R1: two interleaved instances reserve exactly once (interprocess single winner)", async () => {
  const dir = await tmpDir();
  const j1 = new RecoveryJournal(dir);
  const j2 = new RecoveryJournal(dir);
  const target = { repo: REPO, issue: ISSUE, reportId: REPORT_ID, dataDigest: "a".repeat(64) };
  const results = await Promise.allSettled([
    j1.reserve(target),
    j2.reserve(target),
    j2.reserve(target),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 2);
  // The winner's IN_FLIGHT is durable; every loser saw a fail-closed refusal.
  const raw = JSON.parse(await readFile(join(dir, `${recordKey(REPORT_ID, 1)}.json`), "utf8")) as {
    state: string;
  };
  assert.equal(raw.state, "IN_FLIGHT");
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: a read failure is never a fresh PENDING (fail closed, no POST claim)", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  // A directory in the record path makes readFile fail with a non-ENOENT code.
  await mkdir(join(dir, `${recordKey(REPORT_ID, 1)}.json`), { recursive: true });
  await assert.rejects(
    journal.reserve({ repo: REPO, issue: ISSUE, reportId: REPORT_ID, dataDigest: "a".repeat(64) }),
    isRefusal("JOURNAL_UNREADABLE"),
  );
  const projection = await journal.projectRecovery(REPORT_ID, 1);
  assert.equal(projection.state, "HELD");
  assert.equal(projection.last_cause, "JOURNAL_UNREADABLE");
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: malformed persisted records are JOURNAL_CORRUPT, never admitted", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const path = join(dir, `${recordKey(REPORT_ID, 1)}.json`);
  await writeFile(
    path,
    JSON.stringify({ schema: "task-meta/recovery-journal/v1", counters: "bad" }),
    "utf8",
  );
  await assert.rejects(
    journal.reserve({ repo: REPO, issue: ISSUE, reportId: REPORT_ID, dataDigest: "a".repeat(64) }),
    isRefusal("JOURNAL_CORRUPT"),
  );
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: corrupt or concurrently raced GET sidecar never resets nor over-admits", async () => {
  const dir = await tmpDir();
  const cap1 = new RecoveryJournal(dir, {
    ...DEFAULT_BUDGETS,
    getPage: 1,
    post: 3,
    wallMs: 600_000,
    cycles: 3,
  });
  // Concurrent charges with cap=1: exactly one winner.
  const grants = await Promise.all([
    cap1.chargeForPage(REPORT_ID, 1),
    cap1.chargeForPage(REPORT_ID, 1),
    cap1.chargeForPage(REPORT_ID, 1),
  ]);
  assert.equal(grants.filter((g) => g.granted).length, 1);
  // Corrupt the sidecar: further charges refuse (no reset to zero).
  await writeFile(join(dir, `${reportIdHash(REPORT_ID)}.pages.json`), "{torn", "utf8");
  assert.deepEqual(await cap1.chargeForPage(REPORT_ID, 2), { granted: false });
  const stillOne = new RecoveryJournal(dir, {
    ...DEFAULT_BUDGETS,
    getPage: 1,
    post: 3,
    wallMs: 600_000,
    cycles: 3,
  });
  assert.deepEqual(await stillOne.chargeForPage(REPORT_ID, 3), { granted: false });
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1 P1-05 golden: revision 2 is admissible; same-revision conflict is not", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const d1 = "1".repeat(64);
  const d2 = "2".repeat(64);
  await (await journal.reserve({ repo: REPO, issue: ISSUE, reportId: REPORT_ID, dataDigest: d1 }))
    .token;
  await journal.recordEffect(
    REPORT_ID,
    "REMOTE_SAME",
    { attempts: 1, lastHttpStatus: null, outcomeState: "PUBLISHED" },
    1,
  );
  // Same revision, same digest: never re-post.
  await assert.rejects(
    journal.reserve({ repo: REPO, issue: ISSUE, reportId: REPORT_ID, dataDigest: d1 }),
    isRefusal("JOURNAL_TERMINAL_NO_REPOST"),
  );
  // Same revision, differing digest: conflict refusal.
  await assert.rejects(
    journal.reserve({ repo: REPO, issue: ISSUE, reportId: REPORT_ID, dataDigest: d2 }),
    isRefusal("JOURNAL_DIGEST_CONFLICT"),
  );
  // A legitimate revision 2 with valid supersedes gets its own admission.
  const rev2 = await journal.reserve({
    repo: REPO,
    issue: ISSUE,
    reportId: REPORT_ID,
    dataDigest: d2,
    revision: 2,
    supersedes: 1,
  });
  assert.ok(rev2.token.length > 0);
  // The aggregated POST budget charged both admissions.
  const ledger = JSON.parse(
    await readFile(join(dir, `${reportIdHash(REPORT_ID)}.budget.json`), "utf8"),
  ) as { post: number; cycles: number };
  assert.equal(ledger.post, 2);
  assert.equal(ledger.cycles, 2, "a new admission after prior POSTs is a new cycle");
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: ambiguous prior revision blocks a later revision (no bypass)", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  await (
    await journal.reserve({
      repo: REPO,
      issue: ISSUE,
      reportId: REPORT_ID,
      dataDigest: "1".repeat(64),
    })
  ).token;
  await journal.recordEffect(
    REPORT_ID,
    "SENT_OR_MAY_HAVE_SENT",
    { attempts: 1, lastHttpStatus: 503, outcomeState: "NOT_PUBLISHED" },
    1,
  );
  await assert.rejects(
    journal.reserve({
      repo: REPO,
      issue: ISSUE,
      reportId: REPORT_ID,
      dataDigest: "2".repeat(64),
      revision: 2,
      supersedes: 1,
    }),
    isRefusal("CHAIN_PREDECESSOR_UNRESOLVED"),
  );
  // And revision 2 without any predecessor record at all refuses the same way.
  await assert.rejects(
    journal.reserve({
      repo: REPO,
      issue: ISSUE,
      reportId: REPORT_ID,
      dataDigest: "3".repeat(64),
      revision: 3,
      supersedes: 2,
    }),
    isRefusal("CHAIN_PREDECESSOR_UNRESOLVED"),
  );
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: recovery cycles advance and hit the persistent cycle ceiling", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir, {
    ...DEFAULT_BUDGETS,
    post: 3,
    getPage: 50,
    wallMs: 600_000,
    cycles: 2,
  });
  const t = (digest: string, revision: number) => ({
    repo: REPO,
    issue: ISSUE,
    reportId: REPORT_ID,
    dataDigest: digest,
    revision,
    supersedes: revision > 1 ? revision - 1 : null,
  });
  for (const rev of [1, 2]) {
    await (await journal.reserve(t(`${rev}`.repeat(64), rev))).token;
    await journal.recordEffect(
      REPORT_ID,
      "REMOTE_SAME",
      { attempts: 1, lastHttpStatus: null, outcomeState: "PUBLISHED" },
      rev,
    );
  }
  // Third admission would be cycle 3 > ceiling 2.
  await assert.rejects(journal.reserve(t("3".repeat(64), 3)), isRefusal("CYCLE_BUDGET_EXHAUSTED"));
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: spool chain reorder/edit marks HELD; skips are consumed as tokens", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const line = (n: number) => JSON.stringify({ n, event: "Stop", session_id: "s" });
  const good = `${line(1)}\n${line(2)}\n`;
  await journal.attachReplayEvidence(REPORT_ID, computeChainEvidence(good));
  let rec = await journal.load(REPORT_ID);
  assert.equal(rec.seq, 2);
  assert.equal(rec.replay_skipped.length, 0);
  // Appending is a valid extension.
  await journal.attachReplayEvidence(REPORT_ID, computeChainEvidence(`${good}${line(3)}\n`));
  rec = await journal.load(REPORT_ID);
  assert.equal(rec.seq, 3);
  // Editing an earlier segment breaks the chain -> HELD, POSTs refuse.
  await journal.attachReplayEvidence(
    REPORT_ID,
    computeChainEvidence(
      `${JSON.stringify({ n: 1, event: "Stop", session_id: "tampered" })}\n${line(2)}\n${line(3)}\n`,
    ),
  );
  rec = await journal.load(REPORT_ID);
  assert.equal(rec.state, "HELD");
  assert.equal(rec.last_cause, "CHAIN_INTEGRITY_BROKEN");
  await assert.rejects(
    journal.reserve({ repo: REPO, issue: ISSUE, reportId: REPORT_ID, dataDigest: "a".repeat(64) }),
    isRefusal("CHAIN_INTEGRITY_BROKEN"),
  );
  // Skipped lines are consumed as bounded tokens.
  const withSkip = computeChainEvidence(`${line(1)}\nnot-json\n`);
  await journal.attachReplayEvidence("task-meta:other", withSkip);
  const other = await journal.load("task-meta:other");
  assert.deepEqual(other.replay_skipped, ["line2:invalid JSON"]);
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: governed integration publishes once and journals terminal with page charges", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const client = new ListClient();
  const hooks = recoveryHooks(journal, REPORT_ID, 1);
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
  const rec = await journal.load(REPORT_ID);
  assert.equal(rec.state, "TERMINAL");
  assert.equal(rec.effect, "REMOTE_SAME");
  const pages = JSON.parse(
    await readFile(join(dir, `${reportIdHash(REPORT_ID)}.pages.json`), "utf8"),
  ) as { getPage: number };
  assert.ok(pages.getPage >= 2, "every physical GET page was charged");
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: torn IN_FLIGHT is UNKNOWN/HELD, GET-only reconciliation, zero POST", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  await (
    await journal.reserve({
      repo: REPO,
      issue: ISSUE,
      reportId: REPORT_ID,
      dataDigest: "d".repeat(64),
    })
  ).token;
  // Simulate the crash: a NEW journal instance (no live nonce) sees IN_FLIGHT.
  const fresh = new RecoveryJournal(dir);
  const client = new ListClient();
  const o = await publishReport(client, {
    repo: REPO,
    issue: ISSUE,
    body: bodyFor(),
    publish: true,
    sleep: noSleep,
    publicationContext: { kind: "governed_outbox", hooks: recoveryHooks(fresh, REPORT_ID, 1) },
  });
  assert.equal(o.state, "NOT_PUBLISHED");
  if (o.state === "NOT_PUBLISHED") {
    assert.match(o.reason, /^PRE_POST_RESERVATION_REFUSED/);
  }
  assert.equal(o.effectMeta?.effect, "PROVEN_NOT_SENT");
  assert.ok(client.lists >= 1);
  assert.equal(client.creates, 0);
  const projection = await fresh.projectRecovery(REPORT_ID, 1);
  assert.equal(projection.state, "UNKNOWN");
  assert.equal(projection.last_cause, "JOURNAL_TORN_IN_FLIGHT");
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: ambiguous transport persists UNKNOWN-terminal with a single POST", async () => {
  const dir = await tmpDir();
  const journal = new RecoveryJournal(dir);
  const client = new ListClient();
  client.failCreates.push(new Error("network: connection reset"));
  const o = await publishReport(client, {
    repo: REPO,
    issue: ISSUE,
    body: bodyFor(),
    publish: true,
    sleep: noSleep,
    publicationContext: { kind: "governed_outbox", hooks: recoveryHooks(journal, REPORT_ID, 1) },
  });
  assert.equal(o.state, "NOT_PUBLISHED");
  assert.equal(o.effectMeta?.effect, "SENT_OR_MAY_HAVE_SENT");
  assert.equal(client.creates, 1);
  const rec = await journal.load(REPORT_ID);
  assert.equal(rec.state, "TERMINAL");
  assert.equal(rec.effect, "SENT_OR_MAY_HAVE_SENT");
  await rm(dir, { recursive: true, force: true });
});

test("B2 R1: A21 resource errors classify to bounded tokens, never raw text", () => {
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
