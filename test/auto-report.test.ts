import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { expandHome, loadAutoReportConfig } from "../src/autoreport/config.ts";
import { type AutoReportGitHub, autoReportSession, Outbox } from "../src/autoreport/index.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";
import { main } from "../src/cli.ts";
import type { IssueComment } from "../src/publish/index.ts";
import { parseReportComment } from "../src/report/index.ts";
import { EvidenceStore, Spool } from "../src/store/index.ts";

const fxDir = join(import.meta.dirname, "fixtures", "zcode");
const SID = "sess-synth-0001";
const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const H3 = "c".repeat(40);
const PUB_SHA = "d".repeat(40);
const REPO = "kaicreator-mm/domain-harness";
const OWNER_LIMIT =
  "ADS v4.16 adopted from version/v4.16@3041a1b by project-owner authorization; not ADS-main qualified";
const NOW = new Date("2026-10-23T08:00:00.000Z");
const LATER = new Date("2026-10-23T09:00:00.000Z");

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

// ---- spool builders (same wire format as the capture plugin) ----

const line = (e: unknown): string => `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
const T = (hhmmss: string) => `2026-10-22T${hhmmss}.000Z`;

function ent(over: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: "task-meta/zcode-hook/v1",
    plugin_version: "0.2.0",
    session_id: SID,
    turn_id: "turn-1",
    trace_id: "trace-1",
    agent_name: "main",
    tool_call_id: null,
    tool_name: null,
    hook_ts: null,
    received_at: "2026-10-22T13:00:00.000Z",
    mode: "default",
    input_class: null,
    outcome: null,
    error_type: null,
    result_bytes: null,
    tool_call_count: null,
    session_source: null,
    model: null,
    prompt_bytes: null,
    cwd_digest: null,
    binding_refs: null,
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    worktree_refs: null,
    ...over,
  };
}

const WT = [
  { source: "WORKTREE", kind: "ISSUE", repo: "domain-harness", number: 1296 },
  { source: "BRANCH", kind: "ISSUE", repo: "domain-harness", number: 1296 },
];
const start = (head = H1, wt: unknown = WT) =>
  line(
    ent({
      event: "SessionStart",
      session_source: "startup",
      hook_ts: T("13:00:00"),
      git_head: head,
      git_dirty: false,
      git_remote_repo: REPO,
      worktree_refs: wt,
    }),
  );
const prompt = (refs: unknown[], ts = "13:00:30") =>
  line(ent({ event: "UserPromptSubmit", hook_ts: T(ts), binding_refs: refs }));
const toolPair = (id: string, ts1: string, ts2: string) =>
  line(ent({ event: "PreToolUse", tool_call_id: id, tool_name: "Read", hook_ts: T(ts1) })) +
  line(ent({ event: "PostToolUse", tool_call_id: id, tool_name: "Read", hook_ts: T(ts2) }));
const stop = (head = H2, ts = "13:20:00", wt: unknown = WT) =>
  line(
    ent({
      event: "Stop",
      hook_ts: T(ts),
      git_head: head,
      git_dirty: false,
      git_remote_repo: REPO,
      worktree_refs: wt,
    }),
  );
const ISSUE_REF = { kind: "ISSUE", repo: "domain-harness", number: 1296 };

// ---- fake GitHub ----

class FakeGh implements AutoReportGitHub {
  comments: IssueComment[] = [];
  creates = 0;
  linked = new Map<number, number[]>();
  delayMs = 0;
  async listIssueComments(_r: string, _i: number, page: number, perPage: number) {
    const s = (page - 1) * perPage;
    return {
      comments: this.comments.slice(s, s + perPage),
      hasNext: s + perPage < this.comments.length,
    };
  }
  async createIssueComment(repo: string, issue: number, body: string) {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    this.creates++;
    const id = 1000 + this.creates;
    const c: IssueComment = {
      id,
      html_url: `https://github.com/${repo}/issues/${issue}#issuecomment-${id}`,
      body,
      user_login: "bot",
      created_at: "2026-10-23T08:00:00Z",
    };
    this.comments.push(c);
    return c;
  }
  async linkedIssuesOfPr(_repo: string, pr: number) {
    return this.linked.get(pr) ?? [];
  }
}

interface Env {
  root: string;
  spool: string;
  rollout: string;
  store: string;
  outbox: string;
  gates: string;
  config: string;
}

async function setup(
  opts: { spool?: string; rollout?: boolean; cfg?: Record<string, unknown> } = {},
): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), "tm-autorep-"));
  temps.push(root);
  const env: Env = {
    root,
    spool: join(root, "spool"),
    rollout: join(root, "rollout"),
    store: join(root, "store"),
    outbox: join(root, "outbox"),
    gates: join(root, "gates"),
    config: join(root, "auto-report.json"),
  };
  await mkdir(env.spool, { recursive: true });
  await mkdir(env.rollout, { recursive: true });
  await mkdir(env.gates, { recursive: true });
  await writeFile(
    env.config,
    JSON.stringify({
      enabled: true,
      clearance_ref: "owner-authorization:2026-10-23:kaicreator-mm/*",
      store: env.store,
      outbox: env.outbox,
      zcode: { spool_dir: env.spool, rollout_dir: env.rollout },
      gate_log_root: env.gates,
      publisher_source_sha: PUB_SHA,
      ...(opts.cfg ?? {}),
    }),
  );
  if (opts.spool !== undefined) await writeFile(join(env.spool, `${SID}.jsonl`), opts.spool);
  if (opts.rollout !== false) {
    await writeFile(
      join(env.rollout, `model-io-${SID}.jsonl`),
      await readFile(join(fxDir, "model-io.jsonl"), "utf8"),
    );
  }
  return env;
}

const GOOD = () =>
  start() + prompt([ISSUE_REF]) + toolPair("tc-1", "13:05:00", "13:05:10") + stop();

const run = (
  env: Env,
  gh: FakeGh,
  over: Record<string, unknown> = {},
  now: Date = NOW,
  extra: Record<string, unknown> = {},
) =>
  autoReportSession(
    {
      agent: "zcode",
      session: SID,
      configPath: env.config,
      ...over,
    },
    { client: gh, now: () => now, sleep: async () => {}, settleMs: 0, env: {}, ...extra },
  );

const bodyOf = (c: IssueComment | undefined) => {
  const p = parseReportComment(c?.body ?? "");
  assert.ok(p.ok, "comment is a valid report");
  return p;
};

async function outboxEntries(env: Env): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let names: string[] = [];
  try {
    names = (await readdir(env.outbox)).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    const r = await new Spool(join(env.outbox, n)).replay();
    assert.deepEqual(r.skipped, [], "outbox lines verify");
    out.push(...(r.entries as Array<Record<string, unknown>>));
  }
  return out;
}

async function allText(dir: string): Promise<string> {
  let acc = "";
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) acc += await readFile(join(e.parentPath, e.name), "utf8");
  }
  return acc;
}

describe("auto-report publish", () => {
  test("synthetic UI session: PUBLISHED to the bound Issue, v5 + owner limit, outbox verifies", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
    assert.equal(gh.creates, 1);
    assert.equal(r.binding?.state, "RESOLVED");
    assert.equal(r.binding?.repository, REPO);
    assert.equal(r.binding?.issue_number, 1296);
    assert.equal(r.revision, 1);
    assert.match(r.comment_url ?? "", /#issuecomment-1001$/);
    const p = bodyOf(gh.comments[0]);
    assert.equal(p.profile, "v5");
    const d = p.doc.data as Record<string, unknown>;
    const subject = d.subject as Record<string, unknown>;
    assert.equal(subject.repository, REPO);
    assert.equal(subject.issue_ref, `https://github.com/${REPO}/issues/1296`);
    assert.equal(subject.source_sha, H2);
    assert.equal(subject.ads_revision, "3041a1be3f130e5cc5e676c2e56a99882adfd97c");
    assert.equal(subject.publisher_source_sha, PUB_SHA);
    assert.ok((d.limits as string[]).includes(OWNER_LIMIT));
    assert.equal(d.revision, 1);
    assert.equal(d.supersedes, null);
    assert.equal((d.verifier as { status: string }).status, "NOT_RUN");
    assert.equal(
      (d.publication as { clearance_ref: string }).clearance_ref,
      "owner-authorization:2026-10-23:kaicreator-mm/*",
    );
    assert.equal(r.data_digest, p.dataDigest);

    const lines = await outboxEntries(env);
    assert.equal(lines.length, 1);
    const l = lines[0] as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(l)
        .filter((k) => k !== "revision")
        .sort(),
      ["agent", "at", "binding", "comment_url", "data_digest", "reasons", "session", "state"],
    );
    assert.equal(l.state, "PUBLISHED");
    assert.equal(l.session, SID);
    // lock released
    assert.deepEqual(await readdir(join(env.outbox, "locks")), []);
  });

  test("rerun of the same session is ALREADY_PUBLISHED and posts nothing", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    const a = await run(env, gh);
    const b = await run(env, gh, {}, LATER);
    assert.equal(a.state, "PUBLISHED");
    assert.equal(b.state, "ALREADY_PUBLISHED", b.reasons.join(";"));
    assert.equal(gh.creates, 1);
    assert.equal(b.data_digest, a.data_digest);
    assert.equal(b.comment_url, a.comment_url);
  });

  test("works without a model-io rollout (hook spool only)", async () => {
    const env = await setup({ spool: GOOD(), rollout: false });
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
    const p = bodyOf(gh.comments[0]);
    assert.ok(p.ok);
    assert.ok(
      ((p.doc.data as Record<string, unknown>).limits as string[]).some((l) =>
        l.includes("derived from hook git heads"),
      ),
    );
  });

  test("dry run: no create call, no outbox entry, DRY_RUN state", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    const r = await run(env, gh, { dryRun: true });
    assert.equal(r.state, "DRY_RUN");
    assert.equal(gh.creates, 0);
    assert.deepEqual(await outboxEntries(env), []);
    assert.equal(r.binding?.state, "RESOLVED");
  });

  test("missing Stop after the settle wait still collects, with a limit", async () => {
    const env = await setup({ spool: start() + prompt([ISSUE_REF]) });
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
    const d = bodyOf(gh.comments[0]).doc.data as Record<string, unknown>;
    assert.ok((d.limits as string[]).some((l) => l.includes("no Stop entry after waiting")));
  });

  test("gate log found by convention (GATE_SUBJECT_SHA) feeds the verifier; unrelated dirs ignored", async () => {
    const env = await setup({ spool: GOOD() });
    const good = await readFile(join(fxDir, "gate-steps-green.log"), "utf8");
    await mkdir(join(env.gates, "dh-i1296-zcode"), { recursive: true });
    await writeFile(
      join(env.gates, "dh-i1296-zcode", "gate.log"),
      `GATE_SUBJECT_SHA=${H2}\nGATE_TREE_CLEAN=yes\n${good}`,
    );
    await mkdir(join(env.gates, "dh-i77-other"), { recursive: true });
    await writeFile(join(env.gates, "dh-i77-other", "gate.log"), "EXIT=1\n");
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
    const v = (bodyOf(gh.comments[0]).doc.data as Record<string, unknown>).verifier as {
      status: string;
      subject_sha: string;
    };
    assert.equal(v.status, "PASS");
    assert.equal(v.subject_sha, H2);
  });
});

describe("binding", () => {
  test("AMBIGUOUS binding is HELD, nothing posted, reasons in the outbox", async () => {
    const env = await setup({
      spool:
        start(H1, null) +
        prompt([ISSUE_REF, { kind: "ISSUE", repo: "domain-harness", number: 1300 }]) +
        stop(H2, "13:20:00", null),
    });
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "HELD");
    assert.equal(r.binding?.state, "AMBIGUOUS");
    assert.ok(r.reasons.some((x) => x.includes("several issues")));
    assert.equal(gh.creates, 0);
    const lines = await outboxEntries(env);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.state, "HELD");
  });

  test("UNRESOLVED binding (no refs at all) is HELD", async () => {
    const env = await setup({ spool: start(H1, null) + stop(H2, "13:20:00", null) });
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "HELD");
    assert.equal(gh.creates, 0);
  });

  test("no spool for the session is HELD", async () => {
    const env = await setup();
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "HELD");
    assert.deepEqual(r.reasons, ["no hook spool entries for this session"]);
  });

  const prOnly = () =>
    start(H1, null) +
    prompt([{ kind: "PR", repo: "domain-harness", number: 1298 }]) +
    stop(H2, "13:20:00", null);

  test("PR-only with exactly one closing Issue resolves through it", async () => {
    const env = await setup({ spool: prOnly() });
    const gh = new FakeGh();
    gh.linked.set(1298, [1296]);
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
    assert.equal(r.binding?.state, "RESOLVED");
    assert.equal(r.binding?.issue_number, 1296);
    assert.equal(r.binding?.pr_number, 1298);
    assert.ok(r.binding?.reasons.includes("pr-linked-issue"));
    assert.ok(
      r.binding?.evidence.some((e) => e.kind === "PROMPT_REF" && e.value === `${REPO}#1296`),
    );
    const subject = (bodyOf(gh.comments[0]).doc.data as Record<string, unknown>).subject as {
      issue_ref: string;
    };
    assert.match(subject.issue_ref, /\/issues\/1296$/);
  });

  test("PR-only with two linked Issues, or none, is HELD", async () => {
    for (const linked of [[1296, 1297], []]) {
      const env = await setup({ spool: prOnly() });
      const gh = new FakeGh();
      gh.linked.set(1298, linked);
      const r = await run(env, gh);
      assert.equal(r.state, "HELD");
      assert.ok(r.reasons.some((x) => x.startsWith("pr-linked-issue")));
      assert.equal(gh.creates, 0);
    }
  });
});

describe("kill switch, lock, failures", () => {
  test("enabled:false and TASK_META_AUTO_REPORT=0 both give DISABLED; other values run", async () => {
    const off = await setup({ spool: GOOD(), cfg: { enabled: false } });
    const gh = new FakeGh();
    const a = await run(off, gh);
    assert.equal(a.state, "DISABLED");
    assert.equal(gh.creates, 0);
    assert.equal((await outboxEntries(off))[0]?.state, "DISABLED");

    const on = await setup({ spool: GOOD() });
    const gh2 = new FakeGh();
    const b = await run(on, gh2, {}, NOW, { env: { TASK_META_AUTO_REPORT: "0" } });
    assert.equal(b.state, "DISABLED");
    assert.equal(gh2.creates, 0);
    const c = await run(on, gh2, {}, NOW, { env: { TASK_META_AUTO_REPORT: "1" } });
    assert.equal(c.state, "PUBLISHED");
    assert.equal(gh2.creates, 1);
  });

  test("an existing session lock yields ALREADY_RUNNING without posting", async () => {
    const env = await setup({ spool: GOOD() });
    await mkdir(join(env.outbox, "locks"), { recursive: true });
    await writeFile(
      join(env.outbox, "locks", `${SID.replace(/[^A-Za-z0-9_-]/g, "_")}.lock`),
      "1 x\n",
    );
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "ALREADY_RUNNING");
    assert.equal(gh.creates, 0);
    assert.equal((await outboxEntries(env))[0]?.state, "ALREADY_RUNNING");
  });

  test("two concurrent runs for one session post exactly once", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    gh.delayMs = 80;
    const [a, b] = await Promise.all([run(env, gh), run(env, gh)]);
    const states = [a.state, b.state].sort();
    assert.deepEqual(states, ["ALREADY_RUNNING", "PUBLISHED"]);
    assert.equal(gh.creates, 1);
  });

  test("a failing GitHub client yields FAILED, never throws, lock released", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    gh.listIssueComments = async () => {
      throw Object.assign(new Error("HTTP 500 at C:\\Users\\someone\\x"), { status: 500 });
    };
    const r = await run(env, gh);
    assert.equal(r.state, "FAILED");
    assert.ok(!r.reasons.join(" ").includes("someone"));
    assert.deepEqual(await readdir(join(env.outbox, "locks")), []);
  });

  test("bad agent, bad session, unreadable config are FAILED", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    assert.equal((await run(env, gh, { agent: "codex" })).state, "FAILED");
    assert.equal((await run(env, gh, { session: "../evil" })).state, "FAILED");
    const bad = await run(env, gh, { configPath: join(env.root, "nope.json"), outbox: env.outbox });
    assert.equal(bad.state, "FAILED");
    assert.equal(gh.creates, 0);
  });
});

describe("agent write-back citation", () => {
  const mk = (id: number, created: string, body: string): IssueComment => ({
    id,
    html_url: "",
    body,
    user_login: "agent",
    created_at: created,
  });

  test("cites in-window non-report comments only; no content is copied", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    gh.comments = [
      mk(11, "2026-10-22T13:03:00Z", "Result SENTINEL_WB_TEXT done"),
      mk(12, "2026-10-22T12:00:00Z", "before the session"),
      mk(13, "2026-10-22T13:04:00Z", "<!-- ads:github -->\n```yaml\nnot valid\n```\n"),
      mk(14, "2026-10-22T13:20:00Z", "inside the grace window (Stop + 10 min)"),
      mk(15, "2026-10-22T13:31:00Z", "after the grace window"),
    ];
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
    const posted = gh.comments[gh.comments.length - 1] as IssueComment;
    const d = bodyOf(posted).doc.data as Record<string, unknown>;
    const refs = (d.source_refs as string[]).filter((x) => x.startsWith("github:comment:"));
    assert.deepEqual(refs, ["github:comment:11", "github:comment:14"]);
    assert.ok((d.limits as string[]).includes("agent write-back comments cited: 2"));
    assert.ok(!posted.body.includes("SENTINEL_WB_TEXT"));
  });

  test("at most five comments are cited (the latest five)", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    for (let i = 0; i < 8; i++) {
      gh.comments.push(mk(20 + i, `2026-10-22T13:0${i}:00Z`, `note ${i}`));
    }
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED");
    const d = bodyOf(gh.comments[gh.comments.length - 1]).doc.data as Record<string, unknown>;
    const refs = (d.source_refs as string[]).filter((x) => x.startsWith("github:comment:"));
    assert.equal(refs.length, 5);
    assert.deepEqual(
      refs,
      [23, 24, 25, 26, 27].map((n) => `github:comment:${n}`),
    );
  });
});

describe("revisions", () => {
  test("late events change the data: revision 2 with supersedes of the published revision 1", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    const a = await run(env, gh);
    assert.equal(a.state, "PUBLISHED");
    await appendFile(
      join(env.spool, `${SID}.jsonl`),
      toolPair("tc-2", "13:21:00", "13:21:30") + stop(H3, "13:22:00"),
    );
    const b = await run(env, gh, {}, LATER);
    assert.equal(b.state, "PUBLISHED", b.reasons.join(";"));
    assert.equal(b.revision, 2);
    assert.equal(gh.creates, 2);
    const d = bodyOf(gh.comments[1]).doc.data as Record<string, unknown>;
    assert.equal(d.revision, 2);
    assert.equal(d.report_id, `task-meta:${SID}`);
    assert.deepEqual(d.supersedes, {
      revision: 1,
      data_digest: a.data_digest,
      comment_ref: `https://github.com/${REPO}/issues/1296#issuecomment-1001`,
    });
    assert.equal((d.subject as { source_sha: string }).source_sha, H3);
    // revision 1 is untouched
    assert.equal((bodyOf(gh.comments[0]).doc.data as { revision: number }).revision, 1);
    // store holds both revisions, linked
    const store = new EvidenceStore(env.store);
    const m2 = await store.readManifest(SID);
    assert.equal(m2.revision, 2);
    assert.equal(m2.created_at, LATER.toISOString());
    assert.equal((await store.readManifest(SID, 1)).created_at, NOW.toISOString());
    // idempotent afterwards
    const c = await run(env, gh, {}, new Date("2026-10-24T00:00:00.000Z"));
    assert.equal(c.state, "ALREADY_PUBLISHED", c.reasons.join(";"));
    assert.equal(c.revision, 2);
    assert.equal(gh.creates, 2);
  });

  test("changed data with the predecessor missing on readback is HELD and writes nothing", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    await run(env, gh);
    gh.comments = []; // predecessor comment is gone
    await appendFile(
      join(env.spool, `${SID}.jsonl`),
      toolPair("tc-2", "13:21:00", "13:21:30") + stop(H3, "13:22:00"),
    );
    const b = await run(env, gh, {}, LATER);
    assert.equal(b.state, "HELD");
    assert.ok(b.reasons.some((x) => x.includes("predecessor revision 1 not found")));
    assert.equal(gh.creates, 1);
    assert.equal((await new EvidenceStore(env.store).readManifest(SID)).revision, 1);
  });
});

describe("retry", () => {
  const cli = async (args: string[], gh: FakeGh, now: Date = LATER) => {
    let stdout = "";
    let stderr = "";
    const code = await main(args, {
      client: gh,
      now: () => now,
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
      autoReport: { sleep: async () => {}, settleMs: 0, env: {} },
    });
    return { code, stdout, stderr };
  };

  test("--retry re-drives a HELD entry once its binding resolves, then skips it", async () => {
    const env = await setup({ spool: start(H1, null) + stop(H2, "13:20:00", null) });
    const gh = new FakeGh();
    const first = await run(env, gh);
    assert.equal(first.state, "HELD");
    // the binding becomes resolvable: a later turn names the Issue
    await appendFile(
      join(env.spool, `${SID}.jsonl`),
      prompt([ISSUE_REF], "13:21:00") + stop(H2, "13:22:00", null),
    );
    const args = ["auto-report", "--retry", "--config", env.config];
    const r = await cli(args, gh);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout.trim()) as { retried: number; results: { state: string }[] };
    assert.equal(j.retried, 1);
    assert.equal(j.results[0]?.state, "PUBLISHED");
    assert.equal(gh.creates, 1);
    const again = await cli(args, gh);
    assert.equal((JSON.parse(again.stdout.trim()) as { retried: number }).retried, 0);
    assert.equal(gh.creates, 1);
    const lines = await outboxEntries(env);
    assert.deepEqual(
      lines.map((l) => l.state),
      ["HELD", "PUBLISHED"],
    );
    const latest = await new Outbox(env.outbox).latestPerSession();
    assert.equal(latest.length, 1);
  });

  test("--retry also re-drives FAILED entries", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    const orig = gh.createIssueComment.bind(gh);
    let broken = true;
    gh.createIssueComment = async (...a) => {
      if (broken) throw Object.assign(new Error("HTTP 403 forbidden"), { status: 403 });
      return orig(...a);
    };
    const first = await run(env, gh);
    assert.equal(first.state, "FAILED");
    broken = false;
    const r = await cli(["auto-report", "--retry", "--config", env.config], gh);
    assert.equal(r.code, 0);
    assert.equal(gh.creates, 1);
    assert.equal((await outboxEntries(env)).at(-1)?.state, "PUBLISHED");
  });
});

describe("cli surface and config", () => {
  test("usage errors exit 2; HELD and DISABLED outcomes exit 0", async () => {
    const run2 = async (args: string[]) => {
      let stderr = "";
      const code = await main(args, { stdout: () => {}, stderr: (s) => (stderr += s) });
      return { code, stderr };
    };
    assert.equal((await run2(["auto-report"])).code, 2);
    assert.equal((await run2(["auto-report", "--agent", "zcode"])).code, 2);
    assert.equal((await run2(["auto-report", "--bogus"])).code, 2);
    assert.equal((await run2(["auto-report", "--agent", "zcode", "--session", "-x"])).code, 2);

    const env = await setup({ cfg: { enabled: false } });
    const r = await run2([
      "auto-report",
      "--agent",
      "zcode",
      "--session",
      SID,
      "--config",
      env.config,
    ]);
    assert.equal(r.code, 0);
  });

  test("config expands ~ and applies defaults", () => {
    assert.equal(expandHome("~/x", "/home/u").replace(/\\/g, "/").endsWith("/home/u/x"), true);
    const cfg = loadAutoReportConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.clearance_ref, "owner-authorization:2026-10-23:kaicreator-mm/*");
    assert.equal(cfg.publisher_source_sha, "auto");
    assert.ok(!cfg.store.startsWith("~"));
    assert.ok(!cfg.zcode.rollout_dir.startsWith("~"));
  });
});

describe("privacy", () => {
  test("no prompt/command/response text reaches the store, outbox or comments", async () => {
    const env = await setup({ spool: GOOD() });
    const gh = new FakeGh();
    const r = await run(env, gh);
    assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
    const everything = [
      await allText(env.store),
      await allText(env.outbox),
      ...gh.comments.map((c) => c.body),
      JSON.stringify(r),
    ].join("\n");
    for (const s of ["SENTINEL", "someonesecret", "ghp_", "Bearer", env.root, "C:\\Users"]) {
      assert.ok(!everything.includes(s), `leaked ${s}`);
    }
    assert.ok(!/\bhook_ts\b.*prompt/.test(everything));
  });
});
