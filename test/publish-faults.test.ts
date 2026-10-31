import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttemptSummary, ManifestPointer } from "../src/model.ts";
import {
  findReports,
  type GitHubClient,
  GitHubHttpError,
  type IssueComment,
  publishReport,
} from "../src/publish/index.ts";
import { buildReportDocument, renderReportComment } from "../src/report/index.ts";

const REPO = "example-org/example-repo";
const ISSUE = 42;
const manifest: ManifestPointer = {
  ref: "object:private/manifests/abc",
  sha256: "c".repeat(64),
  access: "PROJECT_PRIVATE",
};

function summary(over: Partial<AttemptSummary> = {}): AttemptSummary {
  return {
    repository: REPO,
    issue_number: ISSUE,
    task_ref: `${REPO}#${ISSUE}`,
    attempt_ref: "sess-0001",
    attempt_binding: "COLLECTOR_ONLY",
    source_sha: "1234567890abcdef1234567890abcdef12345678",
    actor: {
      role: "builder",
      operator_kind: "zcode",
      operator_id: "zcode:synthetic",
      session_ref: "sess-0001",
      transport_actor: null,
    },
    observed_at: "2026-10-22T10:00:00Z",
    observation_refs: ["zcode:evt-1"],
    capture_coverage: "PARTIAL",
    limits: ["synthetic fixture"],
    metrics: [
      {
        name: "input_tokens",
        value: 1200,
        unit: "token",
        epistemic: "OBSERVED",
        coverage: "COMPLETE",
        source_refs: ["zcode:evt-1"],
      },
    ],
    cost: {
      value: null,
      currency: null,
      basis: "UNKNOWN",
      pricing_basis: null,
      epistemic: "UNKNOWN",
      source_refs: [],
    },
    attempt_refs: ["sess-0001"],
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
    ...over,
  };
}

function bodyFor(over: Partial<AttemptSummary> = {}): string {
  const doc = buildReportDocument(summary(over), manifest, {
    profile: "v4",
    revision: 1,
    supersedes: null,
  });
  return renderReportComment(doc);
}

// Offline mirror of scripts/e2e-fault-injection.ts: one test per live scenario, fake client only.
class FaultClient implements GitHubClient {
  comments: IssueComment[] = [];
  creates = 0;
  pages: number[] = [];
  nextId = 5000;
  /** Errors thrown by successive create calls BEFORE anything is stored. */
  failBefore: unknown[] = [];
  /** Errors thrown by successive create calls AFTER the comment was stored (lost ACK). */
  failAfter: unknown[] = [];
  /** First-page list calls park until `need` of them have arrived (deterministic race). */
  private barrier: { need: number; waiting: Array<() => void> } | null = null;
  readonly pageCap: number;
  constructor(pageCap = 100) {
    this.pageCap = pageCap;
  }

  raceOnFirstLists(n: number): void {
    this.barrier = { need: n, waiting: [] };
  }

  add(body: string): IssueComment {
    const id = this.nextId++;
    const c: IssueComment = {
      id,
      html_url: `https://example.invalid/issues/${ISSUE}#issuecomment-${id}`,
      body,
      user_login: "bot",
    };
    this.comments.push(c);
    return c;
  }

  async listIssueComments(_r: string, _i: number, page: number, perPage: number) {
    this.pages.push(page);
    const b = this.barrier;
    if (b && page === 1) {
      await new Promise<void>((resolve) => {
        b.waiting.push(resolve);
        if (b.waiting.length >= b.need) {
          this.barrier = null;
          for (const w of b.waiting) w();
        }
      });
    }
    const size = Math.min(perPage, this.pageCap);
    const start = (page - 1) * size;
    return {
      comments: this.comments.slice(start, start + size).map((c) => ({ ...c })),
      hasNext: start + size < this.comments.length,
    };
  }

  async createIssueComment(_r: string, _i: number, body: string) {
    this.creates++;
    const before = this.failBefore.shift();
    if (before) throw before;
    const c = this.add(body);
    const after = this.failAfter.shift();
    if (after) throw after;
    return { ...c };
  }
}

const noSleep = async () => {};
const publish = (c: GitHubClient, body: string, over: Record<string, unknown> = {}) =>
  publishReport(c, { repo: REPO, issue: ISSUE, body, publish: true, sleep: noSleep, ...over });

const reportComments = async (c: GitHubClient, perPage = 100) =>
  (await findReports(c, REPO, ISSUE, perPage)).entries;

describe("publish faults (offline mirror of the live harness)", () => {
  it("1 lost ACK: POST committed, response lost, readback reconciles to PUBLISHED with one comment", async () => {
    const c = new FaultClient();
    c.failAfter.push(new Error("network: connection reset by peer"));
    const o = await publish(c, bodyFor());
    assert.equal(o.state, "PUBLISHED");
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 1);
    assert.equal((o as { comment: IssueComment }).comment.id, c.comments[0]?.id);
  });

  it("2 crash after POST: a fresh publisher for the same body is ALREADY_PUBLISHED and posts nothing", async () => {
    const c = new FaultClient();
    c.add(bodyFor()); // the previous process posted and died before any readback
    const o = await publish(c, bodyFor());
    assert.equal(o.state, "ALREADY_PUBLISHED");
    assert.equal(c.creates, 0);
    assert.equal(c.comments.length, 1);
  });

  it("3 concurrent duplicate: both read back before either posts => 2 equal-digest comments, then ALREADY_PUBLISHED (not CONFLICT)", async () => {
    const c = new FaultClient();
    c.raceOnFirstLists(2);
    const body = bodyFor();
    const [a, b] = await Promise.all([publish(c, body), publish(c, body)]);
    // No exactly-once promise: the window between readback and POST is real.
    assert.equal(a.state, "PUBLISHED");
    assert.equal(b.state, "PUBLISHED");
    assert.equal(c.creates, 2);
    const entries = await reportComments(c);
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map((e) => e.identity)).size, 1);
    assert.equal(new Set(entries.map((e) => e.dataDigest)).size, 1);
    // Duplicates are equal-digest: a later publisher sees a duplicate, never a conflict or a 3rd POST.
    const follow = await publish(c, body);
    assert.equal(follow.state, "ALREADY_PUBLISHED");
    assert.equal(c.creates, 2);
  });

  it("3 serial publishers (no overlap) never duplicate", async () => {
    const c = new FaultClient();
    const body = bodyFor();
    const first = await publish(c, body);
    const second = await publish(c, body);
    assert.equal(first.state, "PUBLISHED");
    assert.equal(second.state, "ALREADY_PUBLISHED");
    assert.equal(c.comments.length, 1);
  });

  it("4 edited comment: changed digest on the same identity is CONFLICT, nothing is posted or overwritten", async () => {
    const c = new FaultClient();
    const body = bodyFor();
    const first = await publish(c, body);
    assert.equal(first.state, "PUBLISHED");
    const stored = c.comments[0] as IssueComment;
    assert.ok(stored.body.includes("synthetic fixture"));
    stored.body = stored.body.replace("synthetic fixture", "edited in place"); // native edit
    const edited = stored.body;
    const o = await publish(c, body);
    assert.equal(o.state, "CONFLICT");
    if (o.state === "CONFLICT") {
      assert.equal(o.comment.id, stored.id);
      assert.notEqual(o.existingDigest, o.newDigest);
    }
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 1);
    assert.equal(stored.body, edited);
  });

  it("4 a comment edited into an invalid report is UNVERIFIED: no second copy is posted", async () => {
    const c = new FaultClient();
    const body = bodyFor();
    assert.equal((await publish(c, body)).state, "PUBLISHED");
    const stored = c.comments[0] as IssueComment;
    stored.body = stored.body.replace(/schema: ads\/github\/v\d/, "schema: ads/github/v9"); // breaks the schema
    assert.ok(stored.body.includes("schema: ads/github/v9"));
    const o = await publish(c, body);
    assert.equal(o.state, "NOT_PUBLISHED");
    if (o.state === "NOT_PUBLISHED") {
      assert.match(o.reason, /^UNVERIFIED_EXISTING: comment \d+ carries report_id /);
    }
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 1);
  });

  it("4 a marker comment with an unrelated report_id does not block publishing", async () => {
    const c = new FaultClient();
    c.add(
      "<!-- ads:github -->\n```yaml\nschema: broken\ndata:\n  report_id: task-meta:other\n```\n",
    );
    assert.equal((await publish(c, bodyFor())).state, "PUBLISHED");
  });

  it("4 a differing copy next to an equal one still yields CONFLICT, never last-writer-wins", async () => {
    const c = new FaultClient();
    const body = bodyFor();
    c.add(body);
    c.add(body.replace("synthetic fixture", "edited in place"));
    const o = await publish(c, body);
    assert.equal(o.state, "CONFLICT");
    assert.equal(c.creates, 0);
  });

  it("5 pagination: a report beyond page 2 (per_page 5, 12 fillers) is found, not re-posted", async () => {
    const c = new FaultClient(5);
    for (let i = 1; i <= 12; i++) c.add(`plain filler comment ${i}`);
    const body = bodyFor();
    const first = await publish(c, body, { perPage: 5 });
    assert.equal(first.state, "PUBLISHED");
    const idx = c.comments.findIndex((x) => x.body === body);
    assert.ok(Math.floor(idx / 5) + 1 > 2, `report on page ${Math.floor(idx / 5) + 1}`);
    c.pages = [];
    const again = await publish(c, body, { perPage: 5 });
    assert.equal(again.state, "ALREADY_PUBLISHED");
    assert.equal(c.creates, 1);
    assert.deepEqual(c.pages, [1, 2, 3]); // exhaustive: 13 comments at 5 per page
  });

  it("5 pagination: a client page size smaller than requested per_page still paginates fully", async () => {
    const c = new FaultClient(3);
    for (let i = 1; i <= 9; i++) c.add(`filler ${i}`);
    c.add(bodyFor());
    const o = await publish(c, bodyFor(), { perPage: 100 });
    assert.equal(o.state, "ALREADY_PUBLISHED");
    assert.equal(c.creates, 0);
  });

  it("6 HTTP 503 before commit (ambiguous): exactly one POST, no same-call retry, UNKNOWN effect", async () => {
    const c = new FaultClient();
    c.failBefore.push(new GitHubHttpError(503, "unavailable"));
    const sleeps: number[] = [];
    const o = await publish(c, bodyFor(), { sleep: async (ms: number) => void sleeps.push(ms) });
    if (o.state === "NOT_PUBLISHED") {
      assert.match(o.reason, /^AMBIGUOUS_TRANSPORT/);
    } else {
      assert.fail("503-before-commit must stop the same-call POST");
    }
    assert.equal(o.effectMeta?.effect, "SENT_OR_MAY_HAVE_SENT");
    assert.equal(o.effectMeta?.status, "UNKNOWN");
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 0);
    assert.equal(sleeps.length, 1);
  });

  it("6 HTTP 429 with Retry-After: delay honoured once for reconciliation; POST stopped", async () => {
    const c = new FaultClient();
    c.failBefore.push(new GitHubHttpError(429, "slow down", 7));
    const sleeps: number[] = [];
    const o = await publish(c, bodyFor(), { sleep: async (ms: number) => void sleeps.push(ms) });
    assert.equal(o.state, "NOT_PUBLISHED");
    assert.deepEqual(sleeps, [7000]);
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 0);
    assert.equal(o.effectMeta?.effect, "SENT_OR_MAY_HAVE_SENT");
  });

  it("6 HTTP 502 after commit (ambiguous): reconciled by readback, no duplicate", async () => {
    const c = new FaultClient();
    c.failAfter.push(new GitHubHttpError(502, "bad gateway"));
    const o = await publish(c, bodyFor());
    assert.equal(o.state, "PUBLISHED");
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 1);
  });

  it("6 persistent 5xx: exactly one ambiguous POST attempt, nothing committed", async () => {
    const c = new FaultClient();
    for (let i = 0; i < 10; i++) c.failBefore.push(new GitHubHttpError(500, "boom"));
    const o = await publish(c, bodyFor(), { maxRetries: 2 });
    assert.equal(o.state, "NOT_PUBLISHED");
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 0);
    assert.equal(o.effectMeta?.effect, "SENT_OR_MAY_HAVE_SENT");
  });

  it("6 secondary rate limit (403 + Retry-After) is ambiguous and stops; plain 403 is a proven rejection", async () => {
    const c = new FaultClient();
    c.failBefore.push(new GitHubHttpError(403, "rate limit", 30));
    const slow = await publish(c, bodyFor());
    assert.equal(slow.state, "NOT_PUBLISHED");
    assert.equal(slow.effectMeta?.effect, "SENT_OR_MAY_HAVE_SENT");
    assert.equal(c.creates, 1);
    const d = new FaultClient();
    d.failBefore.push(new GitHubHttpError(403, "forbidden"));
    const o = await publish(d, bodyFor());
    assert.equal(o.state, "NOT_PUBLISHED");
    assert.equal(d.creates, 1);
    assert.equal(o.effectMeta?.effect, "PROVEN_NOT_SENT");
    assert.equal(o.effectMeta?.status, "FAILED_PROVEN_PRE_SEND");
  });
});
