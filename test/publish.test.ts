import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { AttemptSummary, ManifestPointer } from "../src/model.ts";
import { dispositionOfCorrection, readCorrectionTarget } from "../src/correction/index.ts";
import {
  GhCliClient,
  type GitHubClient,
  GitHubHttpError,
  type IssueComment,
  publishReport,
} from "../src/publish/index.ts";
import { buildReportDocument, renderReportComment, reportDataDigest, type ReportDocument } from "../src/report/index.ts";

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

function bodyFor(over: Partial<AttemptSummary> = {}, revision = 1): string {
  const doc = buildReportDocument(summary(over), manifest, {
    profile: "v4",
    revision,
    supersedes:
      revision === 1
        ? null
        : {
            revision: revision - 1,
            data_digest: "e".repeat(64),
            comment_ref: `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-99`,
          },
  });
  return renderReportComment(doc);
}

class FakeClient implements GitHubClient {
  comments: IssueComment[] = [];
  creates = 0;
  lists = 0;
  nextId = 1000;
  createErrors: unknown[] = [];
  /** After the next create stores a comment, throw this (lost ACK). */
  lostAckError: unknown = null;
  corruptBodyFor: ((id: number) => boolean) | null = null;

  perPage: number;
  constructor(perPage = 100) {
    this.perPage = perPage;
  }

  add(body: string, login: string | null = "someone"): IssueComment {
    const c: IssueComment = {
      id: this.nextId++,
      html_url: `https://example.invalid/c/${this.nextId}`,
      body,
      user_login: login,
    };
    this.comments.push(c);
    return c;
  }

  async listIssueComments(_repo: string, _issue: number, page: number, perPage: number) {
    this.lists++;
    const size = Math.min(perPage, this.perPage);
    const start = (page - 1) * size;
    const slice = this.comments.slice(start, start + size).map((c) => ({
      ...c,
      body: this.corruptBodyFor?.(c.id)
        ? c.body.replace("synthetic fixture", "tampered fixture")
        : c.body,
    }));
    return { comments: slice, hasNext: start + size < this.comments.length };
  }

  async createIssueComment(_repo: string, _issue: number, body: string) {
    this.creates++;
    const err = this.createErrors.shift();
    if (err) throw err;
    const c = this.add(body, "bot");
    if (this.lostAckError) {
      const e = this.lostAckError;
      this.lostAckError = null;
      throw e;
    }
    return c;
  }
}

const noSleep = async () => {};
const run = (c: FakeClient, body: string, over: Record<string, unknown> = {}) =>
  publishReport(c, { repo: REPO, issue: ISSUE, body, publish: true, sleep: noSleep, ...over });

describe("publishReport", () => {
  it("dry run makes zero create calls", async () => {
    const c = new FakeClient();
    const r = await publishReport(c, { repo: REPO, issue: ISSUE, body: bodyFor(), publish: false });
    assert.equal(r.state, "DRY_RUN");
    assert.equal(c.creates, 0);
    assert.equal(c.comments.length, 0);
  });

  it("first publish posts once and readback confirms; second call is ALREADY_PUBLISHED", async () => {
    const c = new FakeClient();
    const body = bodyFor();
    const r1 = await run(c, body);
    assert.equal(r1.state, "PUBLISHED");
    assert.equal(c.creates, 1);
    assert.equal(c.comments.length, 1);
    const r2 = await run(c, body);
    assert.equal(r2.state, "ALREADY_PUBLISHED");
    assert.equal(c.creates, 1);
    // dry run on an already published report also reports the existing comment
    const r3 = await publishReport(c, { repo: REPO, issue: ISSUE, body, publish: false });
    assert.equal(r3.state, "ALREADY_PUBLISHED");
  });

  it("same identity with different data is CONFLICT and never posts", async () => {
    const c = new FakeClient();
    c.add(bodyFor());
    const r = await run(c, bodyFor({ limits: ["a different limit"] }));
    assert.equal(r.state, "CONFLICT");
    if (r.state === "CONFLICT") assert.notEqual(r.existingDigest, r.newDigest);
    assert.equal(c.creates, 0);
  });

  it("a different revision is a different identity", async () => {
    const c = new FakeClient();
    c.add(bodyFor({}, 1));
    const r = await run(c, bodyFor({ limits: ["rev two"] }, 2));
    assert.equal(r.state, "PUBLISHED");
    assert.equal(c.creates, 1);
  });

  it("finds the report on page 3 of 3", async () => {
    const c = new FakeClient(2);
    c.add("hello");
    c.add("world");
    c.add("more");
    c.add("again");
    c.add(bodyFor());
    const r = await run(c, bodyFor());
    assert.equal(r.state, "ALREADY_PUBLISHED");
    assert.equal(c.creates, 0);
    assert.ok(c.lists >= 3);
  });

  it("429 with Retry-After=7 sleeps 7s then succeeds", async () => {
    const c = new FakeClient();
    c.createErrors = [new GitHubHttpError(429, "slow down", 7)];
    const sleeps: number[] = [];
    const r = await run(c, bodyFor(), {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    assert.equal(r.state, "PUBLISHED");
    assert.deepEqual(sleeps, [7000]);
    assert.equal(c.comments.length, 1);
  });

  it("exponential backoff without Retry-After starts at 1s", async () => {
    const c = new FakeClient();
    c.createErrors = [new GitHubHttpError(502, "bad gateway"), new GitHubHttpError(503, "x")];
    const sleeps: number[] = [];
    const r = await run(c, bodyFor(), {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    assert.equal(r.state, "PUBLISHED");
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("lost ACK: create stores the comment then throws a network error -> exactly one comment", async () => {
    const c = new FakeClient();
    c.lostAckError = new Error("socket hang up");
    const r = await run(c, bodyFor());
    assert.equal(r.state, "PUBLISHED");
    assert.equal(c.comments.length, 1);
    assert.equal(c.creates, 1);
  });

  it("persistent 503 gives NOT_PUBLISHED after maxRetries with bounded attempts", async () => {
    const c = new FakeClient();
    c.createErrors = Array.from({ length: 50 }, () => new GitHubHttpError(503, "down"));
    const r = await run(c, bodyFor(), { maxRetries: 2 });
    assert.equal(r.state, "NOT_PUBLISHED");
    assert.equal(c.creates, 3);
    assert.equal(c.comments.length, 0);
  });

  it("422 is NOT_PUBLISHED immediately; plain 403 is not retried", async () => {
    const c = new FakeClient();
    c.createErrors = [new GitHubHttpError(422, "invalid")];
    assert.equal((await run(c, bodyFor())).state, "NOT_PUBLISHED");
    assert.equal(c.creates, 1);
    const d = new FakeClient();
    d.createErrors = [new GitHubHttpError(403, "forbidden")];
    assert.equal((await run(d, bodyFor())).state, "NOT_PUBLISHED");
    assert.equal(d.creates, 1);
  });

  it("invalid body, wrong repo, wrong issue: NOT_PUBLISHED with zero creates", async () => {
    const c = new FakeClient();
    assert.equal((await run(c, "just text")).state, "NOT_PUBLISHED");
    assert.equal((await run(c, bodyFor({ repository: "other-org/other" }))).state, "NOT_PUBLISHED");
    assert.equal((await run(c, bodyFor({ issue_number: 7 }))).state, "NOT_PUBLISHED");
    assert.equal(c.creates, 0);
  });

  it("readback mismatch is NOT_PUBLISHED and does not post again", async () => {
    const c = new FakeClient();
    c.corruptBodyFor = (id) => id >= 1000;
    const r = await run(c, bodyFor());
    assert.equal(r.state, "NOT_PUBLISHED");
    if (r.state === "NOT_PUBLISHED") assert.match(r.reason, /readback mismatch/);
    assert.equal(c.creates, 1);
  });

  it("ignores non-report comments and invalid ads:github comments", async () => {
    const c = new FakeClient();
    c.add("looks good to me");
    c.add("<!-- ads:github -->\nnot a fence");
    c.add("<!-- ads:github -->\n```yaml\nschema: ads/github/v4\nkind: report\ndata: {}\n```\n");
    const r = await run(c, bodyFor());
    assert.equal(r.state, "PUBLISHED");
    assert.equal(c.creates, 1);
  });

  it("two existing comments with the same identity and different digests: CONFLICT", async () => {
    const c = new FakeClient();
    c.add(bodyFor());
    c.add(bodyFor({ limits: ["other"] }));
    const r = await run(c, bodyFor());
    assert.equal(r.state, "CONFLICT");
    assert.equal(c.creates, 0);
  });

  it("a comment's own URL is not part of the posted body", async () => {
    const c = new FakeClient();
    const body = bodyFor();
    const r = await run(c, body);
    assert.equal(r.state, "PUBLISHED");
    if (r.state === "PUBLISHED") assert.ok(!r.comment.body.includes(r.comment.html_url));
  });
});

describe("GhCliClient", () => {
  it("builds argv without a shell and never puts the body in argv", async () => {
    const calls: { file: string; args: string[]; bodyFile: string | null }[] = [];
    const secretBody = "<!-- body-secret-marker -->; rm -rf / $(whoami)";
    const client = new GhCliClient({
      exec: async (file, args) => {
        const f = args.find((a) => a.startsWith("body=@"));
        calls.push({ file, args, bodyFile: f ? readFileSync(f.slice(6), "utf8") : null });
        if (f) {
          return {
            stdout: JSON.stringify({
              id: 5,
              html_url: "u",
              body: secretBody,
              user: { login: "b" },
            }),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      },
    });
    const listed = await client.listIssueComments(REPO, ISSUE, 3, 50);
    assert.deepEqual(listed, { comments: [], hasNext: false });
    const created = await client.createIssueComment(REPO, ISSUE, secretBody);
    assert.equal(created.id, 5);
    assert.equal(calls[0]?.file, "gh");
    assert.ok(calls[0]?.args.includes(`repos/${REPO}/issues/${ISSUE}/comments?per_page=50&page=3`));
    const create = calls[1];
    assert.ok(create?.args.includes("POST"));
    assert.equal(create?.bodyFile, secretBody);
    assert.ok(!create?.args.some((a) => a.includes("body-secret-marker")));
  });

  it("maps HTTP status from gh error output and rejects bad targets", async () => {
    const client = new GhCliClient({
      exec: async () => {
        throw Object.assign(new Error("exit 1"), { stderr: "gh: Validation Failed (HTTP 422)" });
      },
    });
    await assert.rejects(client.listIssueComments(REPO, ISSUE, 1, 10), (e: unknown) => {
      assert.ok(e instanceof GitHubHttpError);
      assert.equal((e as GitHubHttpError).status, 422);
      return true;
    });
    await assert.rejects(client.listIssueComments("bad repo; x", ISSUE, 1, 10), /invalid repo/);
  });
});

describe("v0.3 T02 native readback/currentness", () => {
  it("never posts when a native pagination page claims continuation without data", async () => {
    const c = new FakeClient();
    c.listIssueComments = async () => ({ comments: [], hasNext: true });
    const result = await run(c, bodyFor());
    assert.equal(result.state, "NOT_PUBLISHED");
    assert.equal(c.creates, 0);
  });

  it("same native comment ID with different body across pages is a source CONFLICT", async () => {
    const c = new FakeClient();
    const original = c.add(bodyFor());
    let calls = 0;
    c.listIssueComments = async () => {
      calls++;
      if (calls === 1) return { comments: [original], hasNext: true };
      return {
        comments: [{ ...original, body: bodyFor({ limits: ["changed body"] }) }],
        hasNext: false,
      };
    };
    const result = await run(c, bodyFor());
    assert.equal(result.state, "NOT_PUBLISHED");
    assert.equal(c.creates, 0);
  });

  it("POST success with incomplete trailing native readback remains NOT_PUBLISHED", async () => {
    const c = new FakeClient();
    let after = 0;
    c.listIssueComments = async () => {
      if (c.creates === 0) return { comments: [], hasNext: false };
      after++;
      if (after === 1) return { comments: [...c.comments], hasNext: true };
      throw new Error("HTTP 403 during terminal readback");
    };
    const result = await run(c, bodyFor());
    assert.equal(result.state, "NOT_PUBLISHED");
    assert.equal(c.creates, 1, "do not repeat a POST with lost readback");
  });
});

function v4CorrectionFixture(notice: "REVOKE" | "REDACT" | "DISPUTE" = "DISPUTE") {
  const original = buildReportDocument(summary(), manifest, {
    profile: "v4", revision: 1, supersedes: null,
  });
  const d = original.data;
  const sub = d.subject as Record<string, unknown>;
  const ref = `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-1000`;
  const correction: ReportDocument = {
    schema: "ads/github/v4",
    kind: "report",
    data: {
      report_id: "correction:1",
      revision: 1,
      publisher_namespace: d.publisher_namespace,
      report_kind: "EXECUTION_CORRECTION",
      subject: d.subject,
      actor: d.actor,
      observed_at: d.observed_at,
      source_refs: [ref],
      limits: [],
      supersedes: null,
      target: {
        comment_ref: ref,
        report_id: d.report_id,
        revision: d.revision,
        report_kind: d.report_kind,
        publisher_namespace: d.publisher_namespace,
        issue_ref: sub.issue_ref,
        task_ref: sub.task_ref,
        data_digest: reportDataDigest(d),
      },
      reason: "source-owning actor disputes or revokes this exact prior publication",
      notice,
    },
  };
  return { original: renderReportComment(original), correction: renderReportComment(correction), ref, data: d };
}

describe("v0.3 T02 immutable exact-target correction", () => {
  it("qualified original native comment with v4 8-key target is read back to terminal page", async () => {
    const fixture = v4CorrectionFixture();
    const c = new FakeClient();
    const original = c.add(fixture.original);
    original.html_url = fixture.ref;
    const target = await readCorrectionTarget(c, REPO, ISSUE, fixture.correction);
    assert.equal(target.state, "VERIFIED_CURRENT");
    if (target.state !== "VERIFIED_CURRENT") return;
    const result = dispositionOfCorrection(fixture.correction, target, {
      qualification: "VERIFIED",
      publisherNamespace: String(fixture.data.publisher_namespace),
      taskRef: String((fixture.data.subject as Record<string, unknown>).task_ref),
      attemptRef: null,
      evidenceRefs: ["native:owner:verified"],
    });
    assert.equal(result.state, "DISPUTED_NONREVOKING");
  });

  it("same-owner DISPUTE is nonrevoking; REVOKE without source owner witness stays UNKNOWN", async () => {
    const fixture = v4CorrectionFixture("REVOKE");
    const c = new FakeClient();
    c.add(fixture.original).html_url = fixture.ref;
    const target = await readCorrectionTarget(c, REPO, ISSUE, fixture.correction);
    assert.equal(target.state, "VERIFIED_CURRENT");
    const denied = dispositionOfCorrection(fixture.correction, target, {
      qualification: "UNKNOWN",
      publisherNamespace: String(fixture.data.publisher_namespace),
      taskRef: String((fixture.data.subject as Record<string, unknown>).task_ref),
      attemptRef: null, evidenceRefs: [],
    });
    assert.equal(denied.state, "UNKNOWN");
    const accepted = dispositionOfCorrection(fixture.correction, target, {
      qualification: "VERIFIED",
      publisherNamespace: String(fixture.data.publisher_namespace),
      taskRef: String((fixture.data.subject as Record<string, unknown>).task_ref),
      attemptRef: null, evidenceRefs: ["native:source-owner:verified"],
    });
    assert.equal(accepted.state, "VERIFIED_REVOKED_OR_REDACTED");
  });

  it("edited native body, wrong URL, or incomplete comment pages cannot qualify a target", async () => {
    const fixture = v4CorrectionFixture();
    const c = new FakeClient();
    c.add(fixture.original).html_url = "https://github.com/another/repo/issues/1#issuecomment-1000";
    const wrongUrl = await readCorrectionTarget(c, REPO, ISSUE, fixture.correction);
    assert.equal(wrongUrl.state, "CONFLICT");
    c.comments[0]!.html_url = fixture.ref;
    c.comments[0]!.body = fixture.original.replace("synthetic fixture", "edited source");
    const drift = await readCorrectionTarget(c, REPO, ISSUE, fixture.correction);
    assert.equal(drift.state, "UNKNOWN" === drift.state ? "UNKNOWN" : "CONFLICT");
    c.listIssueComments = async () => ({ comments: [], hasNext: true });
    const incomplete = await readCorrectionTarget(c, REPO, ISSUE, fixture.correction);
    assert.equal(incomplete.state, "UNKNOWN");
  });
});
