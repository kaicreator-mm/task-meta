import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { main } from "../src/cli.ts";
import type { GitHubClient, IssueComment } from "../src/publish/index.ts";
import { parseReportComment } from "../src/report/index.ts";
import {
  add,
  basicSession,
  join as joinLines,
  request,
  resetOrdinal,
  SENTINELS,
  SID,
  sessionMeta,
  turnEnd,
  turnStart,
  usage,
  type ZERO,
} from "./fixtures/codex/build.ts";

const requireCjs = createRequire(import.meta.url);
const cap = requireCjs(
  join(
    import.meta.dirname,
    "..",
    "plugins",
    "codex",
    "task-meta-capture",
    "scripts",
    "capture.cjs",
  ),
) as {
  buildEntry: (i: unknown, now: Date, probe: (cwd: unknown) => unknown) => unknown;
  jcs: (v: unknown) => string;
  sha256Hex: (s: string) => string;
};
const REPO = "kaicreator-mm/task-meta";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

/** A hook spool written the way the capture plugin writes it (git probe faked). */
async function writeSpool(dir: string): Promise<string> {
  const spool = join(dir, "spool");
  await mkdir(spool, { recursive: true });
  const probe = () => ({ git_head: HEAD, git_dirty: false, git_remote_repo: REPO });
  const lines = ["SessionStart", "Stop"].map((ev, i) => {
    const e = cap.buildEntry(
      { session_id: SID, hook_event_name: ev, cwd: dir, turn_id: "turn-2", model: "gpt-test-1" },
      new Date(Date.UTC(2026, 9, 22, 10, 0, i * 40)),
      probe,
    );
    return `{"d":"${cap.sha256Hex(cap.jcs(e))}","e":${cap.jcs(e)}}`;
  });
  await writeFile(
    join(spool, `${SID}.jsonl`),
    lines
      .map(
        (l) => `${l}
`,
      )
      .join(""),
  );
  return spool;
}
const NOW = new Date("2026-10-23T00:00:00.000Z");
const CANDIDATE = "3041a1be3f130e5cc5e676c2e56a99882adfd97c";

class FakeClient implements GitHubClient {
  comments: IssueComment[] = [];
  creates = 0;
  async listIssueComments(_r: string, _i: number, page: number, perPage: number) {
    const start = (page - 1) * perPage;
    return {
      comments: this.comments.slice(start, start + perPage),
      hasNext: start + perPage < this.comments.length,
    };
  }
  async createIssueComment(_r: string, _i: number, body: string) {
    this.creates++;
    const c: IssueComment = {
      id: 1000 + this.creates,
      html_url: "https://example.invalid/c",
      body,
      user_login: "bot",
    };
    this.comments.push(c);
    return c;
  }
}

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-codex-cli-"));
  temps.push(d);
  return d;
}

async function exec(args: string[], client: GitHubClient = new FakeClient(), now = NOW) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    client,
    now: () => now,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr, json: stdout ? JSON.parse(stdout.trim()) : null };
}

async function rolloutFile(dir: string): Promise<string> {
  const f = join(dir, "rollout.jsonl");
  await writeFile(f, basicSession().text);
  await writeSpool(dir);
  return f;
}

function args(dir: string, file: string, extra: string[] = []): string[] {
  return [
    "collect-codex",
    "--repo",
    REPO,
    "--issue",
    "7",
    "--codex-session",
    file,
    "--codex-hook-spool",
    join(dir, "spool"),
    "--store",
    join(dir, "store"),
    "--out",
    join(dir, "out", "report.md"),
    ...extra,
  ];
}
const countFiles = (d: string): number =>
  existsSync(d)
    ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length
    : 0;

test("collect-codex dry run: evidence stored, valid report, no content, zero create calls", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const r = await exec(args(dir, await rolloutFile(dir)), client);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome, "DRY_RUN");
  assert.equal(r.json.attempt_ref, SID);
  assert.equal(r.json.capture_coverage, "COMPLETE");
  assert.equal(r.json.mode, "dry-run");
  assert.equal(r.json.outcome_class, "UNVERIFIED");
  assert.equal(client.creates, 0);
  assert.ok(countFiles(join(dir, "store")) >= 4);
  const body = await readFile(join(dir, "out", "report.md"), "utf8");
  const p = parseReportComment(body);
  assert.ok(p.ok);
  assert.equal(p.profile, "v4");
  assert.match(body, /\| model_requests \| 5 count \|/);
  assert.match(body, /\| input_tokens \| 10000 tokens \|/);
  assert.match(body, /\| reasoning_tokens \| 70 tokens \| OBSERVED \|/);
  assert.match(body, /\| model_wall_ms \| unknown \|/);
  for (const s of SENTINELS) assert.ok(!body.includes(s), `body leaks ${s}`);
  assert.ok(!body.includes(dir));
  assert.ok(!/(^|[\s"'(])[A-Za-z]:[\\/](?!\/)/.test(body), "drive path");
  // every stored object is content-free too
  for (const f of readdirSync(join(dir, "store"), { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue;
    const text = await readFile(join(f.parentPath, f.name), "utf8");
    for (const s of SENTINELS) assert.ok(!text.includes(s), `store leaks ${s}`);
  }
});

test("rerun with the same inputs is idempotent even when the clock moved", async () => {
  const dir = await tmp();
  const file = await rolloutFile(dir);
  const a = await exec(args(dir, file));
  const b = await exec(args(dir, file), new FakeClient(), new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(b.code, 0, b.stderr);
  assert.equal(b.json.manifest.sha256, a.json.manifest.sha256);
  assert.equal(b.json.data_digest, a.json.data_digest);
});

test("--publish posts once, then ALREADY_PUBLISHED (fake client)", async () => {
  const dir = await tmp();
  const file = await rolloutFile(dir);
  const client = new FakeClient();
  const a = await exec(args(dir, file, ["--publish"]), client);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.outcome, "PUBLISHED");
  const b = await exec(args(dir, file, ["--publish"]), client);
  assert.equal(b.json.outcome, "ALREADY_PUBLISHED");
  assert.equal(client.creates, 1);
});

test("--codex-sessions-dir + --session-id finds the base and continuation files", async () => {
  const dir = await tmp();
  const d = [usage(1000, 800, 100, 10), usage(1500, 1200, 60, 0), usage(2000, 1900, 140, 40)];
  const th = [d[0] as typeof ZERO, add(d[0] as typeof ZERO, d[1] as typeof ZERO)];
  th.push(add(th[1] as typeof ZERO, d[2] as typeof ZERO));
  resetOrdinal();
  const baseText = joinLines(
    sessionMeta(),
    turnStart("t1", 10),
    request({
      responseId: "r1",
      turn: "t1",
      s: 12,
      delta: d[0] as typeof ZERO,
      thread: th[0] as typeof ZERO,
    }),
    request({
      responseId: "r2",
      turn: "t1",
      s: 14,
      delta: d[1] as typeof ZERO,
      thread: th[1] as typeof ZERO,
    }),
    turnEnd("t1", 10, 20),
  );
  resetOrdinal(8);
  const childText = joinLines(
    sessionMeta({ historyBase: { thread_id: SID, end_ordinal_exclusive: 8 } }),
    turnStart("t2", 100),
    request({
      responseId: "r3",
      turn: "t2",
      s: 102,
      delta: d[2] as typeof ZERO,
      thread: th[2] as typeof ZERO,
    }),
    turnEnd("t2", 100, 110),
  );
  const day = join(dir, "sessions", "2026", "10", "22");
  await mkdir(day, { recursive: true });
  await writeFile(join(day, `rollout-2026-10-22T18-00-00-${SID}.jsonl`), baseText);
  await writeFile(
    join(day, `rollout-2026-10-22T18-10-00-${SID}_01a1bbbb-1111-7222-8333-444455556666.jsonl`),
    childText,
  );
  await writeFile(
    join(day, "rollout-2026-10-22T19-00-00-01a1ffff-0000-7000-8000-000000000000.jsonl"),
    "{}\n",
  );
  const r = await exec([
    "collect-codex",
    "--repo",
    REPO,
    "--issue",
    "7",
    "--codex-sessions-dir",
    join(dir, "sessions"),
    "--session-id",
    SID,
    "--codex-hook-spool",
    await writeSpool(dir),
    "--store",
    join(dir, "store"),
    "--out",
    join(dir, "out", "report.md"),
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.capture_coverage, "COMPLETE");
  const body = await readFile(join(dir, "out", "report.md"), "utf8");
  assert.match(body, /\| model_requests \| 3 count \|/);
  assert.match(body, /\| input_tokens \| 4500 tokens \|/);
  // unknown id => clean failure, nothing stored
  const dir2 = await tmp();
  const miss = await exec([
    "collect-codex",
    "--repo",
    REPO,
    "--issue",
    "7",
    "--codex-sessions-dir",
    join(dir, "sessions"),
    "--session-id",
    "01a1eeee-nope",
    "--store",
    join(dir2, "store"),
    "--out",
    join(dir2, "out", "report.md"),
  ]);
  assert.equal(miss.code, 1);
  assert.match(miss.stderr, /no rollout file found/);
  assert.equal(countFiles(join(dir2, "store")), 0);
});

test("v5 candidate dry run with clearance writes a v5 report; without clearance it is HELD", async () => {
  const dir = await tmp();
  const file = await rolloutFile(dir);
  const v5 = ["--profile", "v5", "--publisher-source-sha", "b".repeat(40), "--ads-pin", CANDIDATE];
  const held = await exec(args(dir, file, v5));
  assert.equal(held.code, 8);
  assert.equal(held.json.outcome, "HELD");
  assert.ok(!existsSync(join(dir, "out", "report.md")));
  const ok = await exec(args(dir, file, [...v5, "--clearance-ref", "clearance:synthetic"]));
  assert.equal(ok.code, 0, ok.stderr);
  const p = parseReportComment(await readFile(join(dir, "out", "report.md"), "utf8"));
  assert.ok(p.ok);
  assert.equal(p.profile, "v5");
  const metrics = p.doc.data.metrics as Array<{
    name: string;
    adapter_id: string;
    measurement_kind: string;
  }>;
  assert.ok(metrics.length > 0);
  assert.ok(metrics.every((m) => m.adapter_id === "codex"));
  assert.equal(
    metrics.find((m) => m.name === "reasoning_tokens")?.measurement_kind,
    "COUNTER_DELTA",
  );
  assert.equal(metrics.find((m) => m.name === "model_wall_ms")?.measurement_kind, "UNKNOWN");
});

test("usage errors exit 2; zcode-only and codex-only options are not mixed", async () => {
  const dir = await tmp();
  const file = await rolloutFile(dir);
  assert.equal((await exec(args(dir, file, ["--headless", file]))).code, 2);
  assert.equal((await exec(args(dir, file, ["--run", file]))).code, 2);
  assert.equal((await exec(args(dir, file, ["--session-id", SID]))).code, 2);
  assert.equal((await exec(args(dir, file, ["--codex-sessions-dir", dir]))).code, 2);
  const noInput = args(dir, file).filter(
    (a, i, all) => a !== "--codex-session" && all[i - 1] !== "--codex-session",
  );
  assert.equal((await exec(noInput)).code, 2);
  // the zcode command refuses codex options
  const z = await exec([
    "collect",
    "--repo",
    REPO,
    "--issue",
    "7",
    "--headless",
    file,
    "--codex-session",
    file,
    "--store",
    join(dir, "store"),
    "--out",
    join(dir, "o.md"),
  ]);
  assert.equal(z.code, 2);
  assert.equal(countFiles(join(dir, "store")), 0);
  // a file with no session_meta fails cleanly
  const bad = join(dir, "bad.jsonl");
  await writeFile(bad, '{"type":"x"}\n');
  const f = await exec(args(dir, bad));
  assert.equal(f.code, 1);
  assert.match(f.stderr, /no session id/);
});

test("privacy guard still applies: a path-like operator id exits 3 and stores nothing", async () => {
  const dir = await tmp();
  const r = await exec(
    args(dir, await rolloutFile(dir), ["--operator-id", "C:\\Users\\someone\\secret"]),
  );
  assert.equal(r.code, 3);
  assert.equal(countFiles(join(dir, "store")), 0);
});
