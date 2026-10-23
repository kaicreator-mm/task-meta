// Live fault-injection harness (T18). NOT a test: it talks to the real GitHub API through `gh`.
//
//   node scripts/e2e-fault-injection.ts --repo kaicreator-mm/task-meta-e2e --issue <n> --evidence <dir>
//
// Hard-restricted to the isolated test repository; every write lands on the given Issue and nothing
// is cleaned up (the Issue is the evidence). Each scenario uses a fresh report_id.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { collectZcodeRun } from "../src/adapters/zcode/index.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";
import type { ManifestPointer } from "../src/model.ts";
import {
  GhCliClient,
  type GitHubClient,
  type IssueComment,
  type PublishOutcome,
  publishReport,
} from "../src/publish/index.ts";
import {
  buildReportDocument,
  parseReportComment,
  renderReportComment,
} from "../src/report/index.ts";

const ALLOWED_REPO = "kaicreator-mm/task-meta-e2e";
const CLEARANCE = "owner-authorization:2026-10-23:kaicreator-mm/*";
const SELF = join(import.meta.dirname, "e2e-fault-injection.ts");
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const FIXTURES = join(import.meta.dirname, "..", "test", "fixtures", "zcode");
const MANIFEST: ManifestPointer = {
  ref: "object:private/manifests/t18-fault-injection",
  sha256: "c".repeat(64),
  access: "PROJECT_PRIVATE",
};

const { values: v } = parseArgs({
  options: {
    repo: { type: "string" },
    issue: { type: "string" },
    evidence: { type: "string" },
    "publisher-sha": { type: "string" },
    child: { type: "string" },
    "body-file": { type: "string" },
    "start-at": { type: "string" },
    "per-page": { type: "string" },
    "out-file": { type: "string" },
  },
  strict: true,
});

const repo = v.repo ?? "";
const issue = Number(v.issue);
if (repo !== ALLOWED_REPO) {
  console.error(`refusing: this harness only writes to ${ALLOWED_REPO}`);
  process.exit(2);
}
if (!Number.isInteger(issue) || issue <= 0) {
  console.error("--issue <positive integer> required");
  process.exit(2);
}

function gh(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile(
      "gh",
      args,
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) =>
        err ? reject(new Error(`gh ${args.join(" ")}: ${stderr || err.message}`)) : resolve(stdout),
    );
    if (stdin !== undefined) p.stdin?.end(stdin);
  });
}

/** Wrap a client, counting create calls and recording requested list pages. */
class Probe implements GitHubClient {
  creates = 0;
  pages: number[] = [];
  private readonly inner: GitHubClient;
  private readonly opts: { loseAck?: boolean };
  constructor(inner: GitHubClient, opts: { loseAck?: boolean } = {}) {
    this.inner = inner;
    this.opts = opts;
  }
  async listIssueComments(r: string, i: number, page: number, perPage: number) {
    this.pages.push(page);
    return this.inner.listIssueComments(r, i, page, perPage);
  }
  async createIssueComment(r: string, i: number, body: string): Promise<IssueComment> {
    this.creates++;
    const c = await this.inner.createIssueComment(r, i, body);
    if (this.opts.loseAck && this.creates === 1) {
      throw new Error("network: connection reset by peer (simulated lost POST acknowledgement)");
    }
    return c;
  }
}

// ---------------------------------------------------------------- child processes

if (v.child !== undefined) {
  const startAt = Number(v["start-at"] ?? 0);
  const body = await readFile(v["body-file"] as string, "utf8");
  const wait = startAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const client = new GhCliClient();
  const perPage = v["per-page"] ? Number(v["per-page"]) : undefined;
  let result: unknown;
  if (v.child === "post-and-crash") {
    const c = await client.createIssueComment(repo, issue, body);
    result = { posted: c.id };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(137); // simulated crash right after the POST, before any readback
  }
  const probe = new Probe(client);
  const outcome = await publishReport(probe, {
    repo,
    issue,
    body,
    publish: true,
    ...(perPage ? { perPage } : {}),
  });
  result = { outcome: summarize(outcome), creates: probe.creates, at: new Date().toISOString() };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

function summarize(o: PublishOutcome) {
  if ("comment" in o) {
    return {
      state: o.state,
      comment_id: o.comment.id,
      ...(o.state === "CONFLICT"
        ? { existing_digest: o.existingDigest, new_digest: o.newDigest }
        : {}),
    };
  }
  return o.state === "NOT_PUBLISHED" ? { state: o.state, reason: o.reason } : { state: o.state };
}

function runChild(
  mode: string,
  bodyFile: string,
  extra: string[] = [],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p: ChildProcess = spawn(
      process.execPath,
      [
        SELF,
        "--child",
        mode,
        "--repo",
        repo,
        "--issue",
        String(issue),
        "--body-file",
        bodyFile,
        ...extra,
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => {
      stdout += d;
    });
    p.stderr?.on("data", (d) => {
      stderr += d;
    });
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const lastJson = (s: string): unknown => {
  const l = s.trim().split("\n").filter(Boolean).pop();
  return l ? JSON.parse(l) : null;
};

// ---------------------------------------------------------------- setup

const evidence = v.evidence;
if (evidence === undefined) {
  console.error("--evidence <dir> required");
  process.exit(2);
}
await mkdir(evidence, { recursive: true });

const publisherSha =
  v["publisher-sha"] ?? (await gh(["api", "repos/kaicreator-mm/task-meta/commits/main", "--jq", ".sha"])).trim();
if (!/^[0-9a-f]{40}$/.test(publisherSha)) throw new Error("bad publisher sha");

const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const fx = async (n: string) => readFile(join(FIXTURES, n), "utf8");

async function makeBody(tag: string, limitExtra?: string): Promise<string> {
  const base = collectZcodeRun({
    repository: repo,
    issue_number: issue,
    actor: {
      role: "implementer",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "sess-synth-0001",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: await fx("headless.json.txt"),
    modelIo: await fx("model-io.jsonl"),
    runRecord: await fx("run.txt"),
    gateLog: await fx("gate-pass.log"),
  }).summary;
  const ref = `t18-${runId}-${tag}`;
  const summary = {
    ...base,
    attempt_ref: ref,
    attempt_refs: [ref],
    limits: limitExtra ? [...base.limits, limitExtra] : base.limits,
  };
  const doc = buildReportDocument(summary, MANIFEST, {
    profile: "v5",
    revision: 1,
    supersedes: null,
    publisherSourceSha: publisherSha,
    publication: { clearance_ref: CLEARANCE },
  });
  return renderReportComment(doc);
}

interface Row {
  id: number;
  url: string;
  identity: string | null;
  digest: string | null;
}

async function listAll(): Promise<IssueComment[]> {
  const out = await gh([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/issues/${issue}/comments?per_page=100`,
  ]);
  const pages = JSON.parse(out) as Array<Array<Record<string, unknown>>>;
  return pages.flat().map((c) => ({
    id: c.id as number,
    html_url: String(c.html_url),
    body: String(c.body ?? ""),
    user_login: null,
  }));
}

function rowsOf(comments: IssueComment[]): Row[] {
  return comments.map((c) => {
    const p = parseReportComment(c.body);
    if (!p.ok) return { id: c.id, url: c.html_url, identity: null, digest: null };
    const d = p.doc.data;
    return {
      id: c.id,
      url: c.html_url,
      identity: JSON.stringify([issue, d.publisher_namespace, d.report_id, d.revision, d.report_kind]),
      digest: p.dataDigest,
    };
  });
}

interface Verdict {
  scenario: number | string;
  name: string;
  pass: boolean;
  expected: string;
  observed: Record<string, unknown>;
}
const verdicts: Verdict[] = [];

async function record(
  n: number | string,
  name: string,
  reportTag: string,
  expected: string,
  pass: (rows: Row[], mine: Row[]) => boolean,
  observed: Record<string, unknown>,
) {
  const rows = rowsOf(await listAll());
  const needle = reportTag.startsWith("@") ? reportTag.slice(1) : `t18-${runId}-${reportTag}`;
  const mine = rows.filter((r) => r.identity?.includes(needle));
  const byKey = new Map<string, number>();
  for (const r of mine) {
    const k = `${r.identity}|${r.digest}`;
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  const ok = pass(rows, mine);
  const verdict: Verdict = { scenario: n, name, pass: ok, expected, observed };
  verdicts.push(verdict);
  await writeFile(
    join(evidence as string, `scenario-${n}.json`),
    `${JSON.stringify(
      {
        ...verdict,
        repo,
        issue,
        run_id: runId,
        report_tag: reportTag,
        total_comments: rows.length,
        report_comments: rows.filter((r) => r.identity !== null).length,
        identity_digest_counts: [...byKey].map(([k, count]) => {
          const [identity, digest] = k.split("|");
          return { identity, digest, count };
        }),
        comments: mine,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`scenario ${n} ${name}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(observed)}`);
}

const tmp = await mkdtemp(join(tmpdir(), "tm-t18-"));
async function bodyFile(name: string, body: string): Promise<string> {
  const f = join(tmp, name);
  await writeFile(f, body, "utf8");
  return f;
}
const real = () => new GhCliClient();

// ---------------------------------------------------------------- 1. lost ACK
{
  const body = await makeBody("s1");
  const probe = new Probe(real(), { loseAck: true });
  const o = await publishReport(probe, { repo, issue, body, publish: true, sleep: async () => {} });
  await record(
    1,
    "lost-ack",
    "s1",
    "PUBLISHED via readback reconciliation, exactly 1 POST and exactly 1 comment",
    (_r, mine) => o.state === "PUBLISHED" && probe.creates === 1 && mine.length === 1,
    { outcome: summarize(o), creates: probe.creates },
  );
}

// ---------------------------------------------------------------- 2. crash after POST
{
  const body = await makeBody("s2");
  const f = await bodyFile("s2.md", body);
  const crash = await runChild("post-and-crash", f);
  const again = await runChild("publish", f);
  const o = lastJson(again.stdout) as { outcome: { state: string }; creates: number } | null;
  await record(
    2,
    "crash-after-post",
    "s2",
    "second fresh process returns ALREADY_PUBLISHED and posts nothing; exactly 1 comment",
    (_r, mine) => o?.outcome.state === "ALREADY_PUBLISHED" && o.creates === 0 && mine.length === 1,
    { crash_exit_code: crash.code, second_process: o, stderr: again.stderr.slice(0, 200) },
  );
}

// ---------------------------------------------------------------- 3a. concurrent publishers
{
  const body = await makeBody("s3");
  const f = await bodyFile("s3.md", body);
  const startAt = String(Date.now() + 4000);
  const [a, b] = await Promise.all([
    runChild("publish", f, ["--start-at", startAt]),
    runChild("publish", f, ["--start-at", startAt]),
  ]);
  const oa = lastJson(a.stdout) as { outcome: { state: string }; creates: number } | null;
  const ob = lastJson(b.stdout) as { outcome: { state: string }; creates: number } | null;
  const afterRace = rowsOf(await listAll()).filter((r) => r.identity?.includes(`t18-${runId}-s3`));
  const follow = await publishReport(new Probe(real()), { repo, issue, body, publish: true });
  await record(
    "3",
    "concurrent-duplicate (publishReport x2)",
    "s3",
    "no exactly-once promise: 1 or 2 comments, all equal-digest; follow-up publish is ALREADY_PUBLISHED, never CONFLICT",
    (_r, mine) =>
      mine.length >= 1 &&
      new Set(mine.map((m) => m.digest)).size === 1 &&
      follow.state === "ALREADY_PUBLISHED",
    {
      process_a: oa,
      process_b: ob,
      comments_after_race: afterRace.length,
      duplicate_detected: afterRace.length > 1,
      follow_up: summarize(follow),
    },
  );
}

// ---------------------------------------------------------------- 3b. auto-report session lock
{
  const sess = `t18-synth-${runId}`;
  const root = await mkdtemp(join(tmpdir(), "tm-t18-ar-"));
  const dirs = {
    spool: join(root, "spool"),
    rollout: join(root, "rollout"),
    gates: join(root, "gates"),
    store: join(root, "store"),
    outbox: join(root, "outbox"),
  };
  for (const d of [dirs.spool, dirs.rollout, dirs.gates]) await mkdir(d, { recursive: true });
  const line = (e: unknown) => `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
  const ent = (over: Record<string, unknown>) => ({
    schema: "task-meta/zcode-hook/v1",
    plugin_version: "0.2.0",
    session_id: sess,
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
  });
  const T = (t: string) => `2026-10-22T${t}.000Z`;
  const wt = [
    { source: "WORKTREE", kind: "ISSUE", repo: "task-meta-e2e", number: issue },
    { source: "BRANCH", kind: "ISSUE", repo: "task-meta-e2e", number: issue },
  ];
  const spool =
    line(
      ent({
        event: "SessionStart",
        session_source: "startup",
        hook_ts: T("13:00:00"),
        git_head: "a".repeat(40),
        git_dirty: false,
        git_remote_repo: repo,
        worktree_refs: wt,
      }),
    ) +
    line(
      ent({
        event: "UserPromptSubmit",
        hook_ts: T("13:00:30"),
        binding_refs: [{ kind: "ISSUE", repo: "task-meta-e2e", number: issue }],
      }),
    ) +
    line(ent({ event: "PreToolUse", tool_call_id: "tc-1", tool_name: "Read", hook_ts: T("13:05:00") })) +
    line(ent({ event: "PostToolUse", tool_call_id: "tc-1", tool_name: "Read", hook_ts: T("13:05:10") })) +
    line(
      ent({
        event: "Stop",
        hook_ts: T("13:20:00"),
        git_head: "b".repeat(40),
        git_dirty: false,
        git_remote_repo: repo,
        worktree_refs: wt,
      }),
    );
  await writeFile(join(dirs.spool, `${sess}.jsonl`), spool);
  const cfg = join(root, "auto-report.json");
  await writeFile(
    cfg,
    JSON.stringify({
      enabled: true,
      clearance_ref: CLEARANCE,
      store: dirs.store,
      outbox: dirs.outbox,
      zcode: { spool_dir: dirs.spool, rollout_dir: dirs.rollout },
      gate_log_root: dirs.gates,
      publisher_source_sha: publisherSha,
    }),
  );
  const runAuto = () =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const p = spawn(
        process.execPath,
        [CLI, "auto-report", "--agent", "zcode", "--session", sess, "--config", cfg],
        { windowsHide: true },
      );
      let stdout = "";
      let stderr = "";
      p.stdout?.on("data", (d) => {
        stdout += d;
      });
      p.stderr?.on("data", (d) => {
        stderr += d;
      });
      p.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  const [a, b] = await Promise.all([runAuto(), runAuto()]);
  const ja = lastJson(a.stdout) as { state?: string } | null;
  const jb = lastJson(b.stdout) as { state?: string } | null;
  const states = [ja?.state, jb?.state].sort();
  // Third, sequential run: must be a duplicate of the first, not a new comment.
  const c = await runAuto();
  const jc = lastJson(c.stdout) as { state?: string } | null;
  const rows = rowsOf(await listAll());
  const mine = rows.filter((r) => r.identity?.includes(`task-meta:${sess}`));
  await record(
    "3b",
    "concurrent-duplicate (auto-report, shared outbox lock)",
    `@task-meta:${sess}`,
    "one PUBLISHED; the other ALREADY_RUNNING or ALREADY_PUBLISHED; exactly 1 comment; sequential rerun ALREADY_PUBLISHED",
    () =>
      mine.length === 1 &&
      states.includes("PUBLISHED") &&
      states.filter((s) => s === "PUBLISHED").length === 1 &&
      jc?.state === "ALREADY_PUBLISHED",
    {
      session: sess,
      concurrent_states: states,
      sequential_rerun: jc?.state,
      comments_for_session: mine.length,
      stderr: [a.stderr, b.stderr, c.stderr].map((s) => s.slice(0, 120)),
      session_comments: mine,
    },
  );
}

// ---------------------------------------------------------------- 4. edited comment
{
  const body = await makeBody("s4");
  const f = await bodyFile("s4.md", body);
  const first = await publishReport(new Probe(real()), { repo, issue, body, publish: true });
  if (first.state !== "PUBLISHED") throw new Error(`s4 setup: ${first.state}`);
  const edited = await makeBody("s4", "edited-in-place-by-t18-harness");
  await gh(
    ["api", "-X", "PATCH", `repos/${repo}/issues/comments/${first.comment.id}`, "--input", "-"],
    JSON.stringify({ body: edited }),
  );
  const probe = new Probe(real());
  const o = await publishReport(probe, { repo, issue, body, publish: true });
  await record(
    4,
    "edited-comment",
    "s4",
    "CONFLICT (same identity, different digest); no new POST; exactly 1 comment",
    (_r, mine) => o.state === "CONFLICT" && probe.creates === 0 && mine.length === 1,
    { first: summarize(first), after_edit: summarize(o), creates_after_edit: probe.creates },
  );
}

// ---------------------------------------------------------------- 5. pagination
{
  const fillers: number[] = [];
  for (let i = 1; i <= 12; i++) {
    const c = await real().createIssueComment(repo, issue, `t18 pagination filler ${runId} #${i}`);
    fillers.push(c.id);
  }
  const body = await makeBody("s5");
  const p1 = new Probe(real());
  const first = await publishReport(p1, { repo, issue, body, publish: true, perPage: 5 });
  const p2 = new Probe(real());
  const o = await publishReport(p2, { repo, issue, body, publish: true, perPage: 5 });
  const all = await listAll();
  const idx = all.findIndex((c) => parseReportComment(c.body).ok && c.body.includes(`t18-${runId}-s5`));
  await record(
    5,
    "pagination",
    "s5",
    "report sits beyond page 2 at per_page=5; rerun finds it: ALREADY_PUBLISHED, no POST; exactly 1 comment",
    (_r, mine) =>
      Math.floor(idx / 5) + 1 > 2 &&
      first.state === "PUBLISHED" &&
      o.state === "ALREADY_PUBLISHED" &&
      p2.creates === 0 &&
      mine.length === 1,
    {
      filler_comments: fillers.length,
      report_index: idx,
      report_page_at_5: Math.floor(idx / 5) + 1,
      first: summarize(first),
      rerun: summarize(o),
      rerun_pages_requested: p2.pages,
    },
  );
}

await writeFile(
  join(evidence, "summary.json"),
  `${JSON.stringify({ repo, issue, run_id: runId, publisher_sha: publisherSha, verdicts }, null, 2)}\n`,
);
console.log(
  `rate limit / 5xx: not forced live (offline tests only). overall: ${verdicts.every((x) => x.pass) ? "PASS" : "FAIL"}`,
);
process.exit(verdicts.every((x) => x.pass) ? 0 : 1);
