// v0.4 B1 (#68) — publisher finality, per-POST permission and governed-mode fail-closed.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttemptSummary, ManifestPointer, PostEffect } from "../../src/model.ts";
import {
  type GitHubClient,
  GitHubHttpError,
  type IssueComment,
  type PublisherEffectHooks,
  publishReport,
} from "../../src/publish/index.ts";
import { buildReportDocument, renderReportComment } from "../../src/report/index.ts";

const REPO = "example-org/example-repo";
const ISSUE = 42;
const manifest: ManifestPointer = {
  ref: "object:private/manifests/abc",
  sha256: "c".repeat(64),
  access: "PROJECT_PRIVATE",
};

function bodyFor(): string {
  const summary: AttemptSummary = {
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
    metrics: [],
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
  };
  const doc = buildReportDocument(summary, manifest, {
    profile: "v4",
    revision: 1,
    supersedes: null,
  });
  return renderReportComment(doc);
}

class CountingClient implements GitHubClient {
  comments: IssueComment[] = [];
  creates = 0;
  lists = 0;
  nextId = 7000;
  /** Errors thrown by successive create calls BEFORE anything is stored. */
  failBefore: unknown[] = [];

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
    const before = this.failBefore.shift();
    if (before) throw before;
    const c: IssueComment = {
      id: this.nextId++,
      html_url: `https://example.invalid/c/${this.nextId}`,
      body,
      user_login: "bot",
    };
    this.comments.push(c);
    return { ...c };
  }
}

function recordingHooks(over: Partial<PublisherEffectHooks> = {}) {
  const calls = { reserve: 0, charges: [] as number[], effects: [] as [PostEffect, string][] };
  const hooks: PublisherEffectHooks = {
    reservePrePost: async () => {
      calls.reserve++;
      return { token: `res-${calls.reserve}` };
    },
    chargeGetPage: async (page: number) => {
      calls.charges.push(page);
      return { granted: true };
    },
    recordEffect: async (effect: PostEffect, detail: { outcomeState: string }) => {
      calls.effects.push([effect, detail.outcomeState]);
    },
    ...over,
  };
  return { hooks, calls };
}

const noSleep = async () => {};
const publish = (c: GitHubClient, over: Record<string, unknown> = {}) =>
  publishReport(c, {
    repo: REPO,
    issue: ISSUE,
    body: bodyFor(),
    publish: true,
    sleep: noSleep,
    ...over,
  });

test("B1: direct mode keeps authorized PUBLISHED behavior with additive effect metadata", async () => {
  const c = new CountingClient();
  const o = await publish(c);
  assert.equal(o.state, "PUBLISHED");
  assert.equal(o.effectMeta?.effect, "REMOTE_SAME");
  assert.equal(o.effectMeta?.denialCode, null);
  assert.equal(c.creates, 1);
});

test("B1: governed mode charges every GET page and reserves before the single POST", async () => {
  const c = new CountingClient();
  const { hooks, calls } = recordingHooks();
  const o = await publish(c, { publicationContext: { kind: "governed_outbox", hooks } });
  assert.equal(o.state, "PUBLISHED");
  assert.equal(o.effectMeta?.effect, "REMOTE_SAME");
  assert.equal(c.creates, 1);
  assert.equal(c.lists, 2); // pre-readback + post-commit verification
  assert.deepEqual(calls.charges, [1, 1]); // a charge precedes every physical GET page
  assert.equal(calls.reserve, 1); // reservation precedes EVERY create (one POST here)
  assert.deepEqual(calls.effects, [["REMOTE_SAME", "PUBLISHED"]]);
});

test("B1: governed_outbox with missing/invalid hooks is fail-closed with zero network", async () => {
  for (const bad of [
    undefined,
    null,
    {},
    { reservePrePost: async () => ({ token: "t" }) },
    { chargeGetPage: async () => ({ granted: true }) },
  ]) {
    const c = new CountingClient();
    const o = await publish(c, {
      publicationContext: { kind: "governed_outbox", hooks: bad as never },
    });
    assert.equal(o.state, "NOT_PUBLISHED", `hooks=${JSON.stringify(bad)}`);
    if (o.state === "NOT_PUBLISHED") {
      assert.match(o.reason, /^GOVERNED_HOOKS_INVALID/);
    }
    assert.equal(o.effectMeta?.effect, "PROVEN_NOT_SENT");
    // Never reached the direct path: zero network calls of any kind.
    assert.equal(c.creates, 0);
    assert.equal(c.lists, 0);
  }
});

test("B1: refused durable reservation is zero-POST fail-closed", async () => {
  const c = new CountingClient();
  const { hooks } = recordingHooks({
    reservePrePost: async () => {
      throw new Error("journal unavailable");
    },
  });
  const o = await publish(c, { publicationContext: { kind: "governed_outbox", hooks } });
  assert.equal(o.state, "NOT_PUBLISHED");
  if (o.state === "NOT_PUBLISHED") {
    assert.match(o.reason, /^PRE_POST_RESERVATION_REFUSED/);
  }
  assert.equal(o.effectMeta?.effect, "PROVEN_NOT_SENT");
  assert.equal(c.creates, 0);
  assert.ok(c.lists >= 1, "pre-readback pages were charged and listed before the refusal");
});

test("B1: exhausted GET budget stops pagination with zero POST", async () => {
  const c = new CountingClient();
  for (let i = 0; i < 5; i++) {
    c.comments.push({
      id: c.nextId++,
      html_url: `https://example.invalid/c/${c.nextId}`,
      body: `filler ${i}`,
      user_login: "someone",
    });
  }
  let first = true;
  const { hooks } = recordingHooks({
    chargeGetPage: async () => {
      if (first) {
        first = false;
        return { granted: true };
      }
      return { granted: false };
    },
  });
  const o = await publish(c, {
    perPage: 2,
    publicationContext: { kind: "governed_outbox", hooks },
  });
  assert.equal(o.state, "NOT_PUBLISHED");
  if (o.state === "NOT_PUBLISHED") {
    assert.match(o.reason, /^GET_PAGE_BUDGET_EXHAUSTED/);
  }
  assert.equal(o.effectMeta?.effect, "PROVEN_NOT_SENT");
  assert.equal(c.creates, 0);
  assert.equal(c.lists, 1, "the denied charge stops pagination before the second page");
});

test("B1: admission denial is evaluated before reservation (denial ordering oracle)", async () => {
  // Identity mismatch is a hard admission denial; a hook that would also refuse
  // must never be consulted for the outcome to stay the denial.
  const c = new CountingClient();
  const { hooks, calls } = recordingHooks({
    reservePrePost: async () => {
      throw new Error("would refuse");
    },
  });
  const wrongRepo = bodyFor().replace(`repository: ${REPO}`, "repository: other-org/other-repo");
  const o = await publishReport(c, {
    repo: REPO,
    issue: ISSUE,
    body: wrongRepo,
    publish: true,
    sleep: noSleep,
    publicationContext: { kind: "governed_outbox", hooks },
  });
  assert.equal(o.state, "NOT_PUBLISHED");
  if (o.state === "NOT_PUBLISHED") {
    assert.match(o.reason, /does not match target repo/);
  }
  assert.equal(o.effectMeta?.denialCode, "REPO_IDENTITY_MISMATCH");
  assert.equal(o.effectMeta?.effect, "PROVEN_NOT_SENT");
  assert.equal(calls.reserve, 0);
  assert.equal(c.creates, 0);
});

test("B1: ambiguous delayed-commit in governed mode allows exactly one physical POST", async () => {
  const c = new CountingClient();
  c.failBefore.push(new GitHubHttpError(503, "unavailable"));
  const { hooks, calls } = recordingHooks();
  const o = await publish(c, { publicationContext: { kind: "governed_outbox", hooks } });
  assert.equal(o.state, "NOT_PUBLISHED");
  if (o.state === "NOT_PUBLISHED") {
    assert.match(o.reason, /^AMBIGUOUS_TRANSPORT/);
  }
  assert.equal(o.effectMeta?.effect, "SENT_OR_MAY_HAVE_SENT");
  assert.equal(o.effectMeta?.status, "UNKNOWN");
  // Exactly one total physical POST in durable mode; reservation ran once.
  assert.equal(c.creates, 1);
  assert.equal(calls.reserve, 1);
  assert.deepEqual(
    calls.effects.map(([e]) => e),
    ["SENT_OR_MAY_HAVE_SENT"],
  );
});

test("B1: governed lost-ACK reconciles to PUBLISHED with a single POST", async () => {
  const c = new CountingClient();
  // Store the comment, then lose the ACK.
  const original = c.createIssueComment.bind(c);
  c.createIssueComment = async (r: string, i: number, body: string) => {
    await original(r, i, body);
    throw new Error("network: connection reset by peer");
  };
  const { hooks } = recordingHooks();
  const o = await publish(c, { publicationContext: { kind: "governed_outbox", hooks } });
  assert.equal(o.state, "PUBLISHED");
  assert.equal(c.creates, 1);
  assert.equal(c.comments.length, 1);
});
