import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type AutoReportGitHub, Outbox, watchSession } from "../src/autoreport/index.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";
import { main } from "../src/cli.ts";
import type { IssueComment } from "../src/publish/index.ts";
import { basicSession, SID } from "./fixtures/codex/build.ts";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const H3 = "c".repeat(40);
const REPO = "kaicreator-mm/domain-harness";
const T0 = new Date("2026-10-23T08:00:00.000Z").getTime();

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

const line = (e: unknown): string => `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
const WT = [
  { source: "WORKTREE", kind: "ISSUE", repo: "domain-harness", number: 1296 },
  { source: "BRANCH", kind: "ISSUE", repo: "domain-harness", number: 1296 },
];
function ent(over: Record<string, unknown>): string {
  return line({
    schema: "task-meta/codex-hook/v1",
    plugin_version: "0.2.4",
    agent: "codex",
    session_id: SID,
    turn_id: "turn-1",
    tool_call_id: null,
    tool_name: null,
    received_at: "2026-10-22T10:00:00.000Z",
    mode: "default",
    model: "gpt-test-1",
    session_source: null,
    input_class: null,
    outcome: null,
    exit_code: null,
    result_bytes: null,
    prompt_bytes: null,
    message_bytes: null,
    end_reason: null,
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    binding_refs: null,
    worktree_refs: null,
    cwd_digest: null,
    ...over,
  });
}
const START = ent({
  event: "SessionStart",
  session_source: "startup",
  git_head: H1,
  git_dirty: false,
  git_remote_repo: REPO,
  worktree_refs: WT,
});
const PROMPT = (ts: string) =>
  ent({
    event: "UserPromptSubmit",
    received_at: ts,
    binding_refs: [{ kind: "ISSUE", repo: "domain-harness", number: 1296 }],
  });
const STOP = (ts: string, head: string) =>
  ent({
    event: "Stop",
    received_at: ts,
    git_head: head,
    git_dirty: false,
    git_remote_repo: REPO,
    worktree_refs: WT,
  });
const END = (ts: string) => ent({ event: "SessionEnd", received_at: ts, end_reason: "exit" });
const TOOL = (ts: string) =>
  ent({ event: "PreToolUse", received_at: ts, tool_name: "exec", tool_call_id: "c1" });

class FakeGh implements AutoReportGitHub {
  comments: IssueComment[] = [];
  creates = 0;
  async listIssueComments(_r: string, _i: number, page: number, perPage: number) {
    const s = (page - 1) * perPage;
    return {
      comments: this.comments.slice(s, s + perPage),
      hasNext: s + perPage < this.comments.length,
    };
  }
  async createIssueComment(repo: string, issue: number, body: string) {
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
  async linkedIssuesOfPr() {
    return [];
  }
}

interface Env {
  root: string;
  config: string;
  spoolFile: string;
  outbox: string;
}

async function setup(spool: string, cfg: Record<string, unknown> = {}): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), "tm-watch-"));
  temps.push(root);
  const env: Env = {
    root,
    config: join(root, "auto-report.json"),
    spoolFile: join(root, "codex-spool", `${SID}.jsonl`),
    outbox: join(root, "outbox"),
  };
  const day = join(root, "sessions", "2026", "10", "22");
  await mkdir(join(root, "codex-spool"), { recursive: true });
  await mkdir(day, { recursive: true });
  await writeFile(
    env.config,
    JSON.stringify({
      enabled: true,
      clearance_ref: "owner-authorization:2026-10-23:kaicreator-mm/*",
      store: join(root, "store"),
      outbox: env.outbox,
      zcode: { spool_dir: join(root, "zcode-spool"), rollout_dir: join(root, "zcode-rollout") },
      codex: { spool_dir: join(root, "codex-spool"), sessions_dir: join(root, "sessions") },
      gate_log_root: join(root, "gates"),
      publisher_source_sha: "d".repeat(40),
      settle_seconds: 10,
      watch_idle_exit_seconds: 600,
      watch_max_seconds: 3600,
      ...cfg,
    }),
  );
  await writeFile(env.spoolFile, spool);
  await writeFile(join(day, `rollout-2026-10-22T10-00-00-${SID}.jsonl`), basicSession().text);
  return env;
}

/** Injected clock; `onTick` runs after every sleep (it may append to the spool). */
function clock(onTick: (tick: number, now: number) => Promise<void> | void = () => {}) {
  const c = { t: T0, ticks: 0 };
  return {
    c,
    now: () => new Date(c.t),
    sleep: async (ms: number) => {
      c.t += ms;
      c.ticks++;
      await onTick(c.ticks, c.t);
    },
  };
}

const watch = (env: Env, gh: FakeGh, k: ReturnType<typeof clock>) =>
  watchSession(
    { agent: "codex", session: SID, configPath: env.config },
    { client: gh, now: k.now, sleep: k.sleep, settleMs: 0, env: {} },
  );

const states = async (env: Env): Promise<string[]> =>
  (await new Outbox(env.outbox).readAll()).map((e) => e.state);

const BASE = START + PROMPT("2026-10-22T10:00:05.000Z") + STOP("2026-10-22T10:02:00.000Z", H2);
const watchLock = (env: Env) => join(env.outbox, "locks", `${SID}.watch`);

test("watch: a SessionEnd entry publishes at once and ends the watcher", async () => {
  const env = await setup(BASE + END("2026-10-22T10:03:00.000Z"));
  const gh = new FakeGh();
  const k = clock();
  const r = await watch(env, gh, k);
  assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
  assert.equal(gh.creates, 1);
  assert.equal(k.c.ticks, 0, "no waiting before the session-end publish");
  assert.ok(!existsSync(watchLock(env)), "watch lock released");
});

test("watch: Stop + settle publishes, later activity gives revision 2, then idle exit", async () => {
  const env = await setup(BASE);
  const gh = new FakeGh();
  let phase = 0;
  const k = clock(async () => {
    if (phase === 0 && gh.creates === 1) {
      phase = 1; // a later turn in the same interactive session
      await appendFile(
        env.spoolFile,
        PROMPT("2026-10-22T10:10:00.000Z") + STOP("2026-10-22T10:12:00.000Z", H3),
      );
    }
  });
  const r = await watch(env, gh, k);
  assert.equal(gh.creates, 2, `final: ${r.state} ${r.reasons.join(";")}`);
  assert.equal(r.state, "WATCH_IDLE_EXIT");
  const published = (await new Outbox(env.outbox).readAll()).filter((e) => e.state === "PUBLISHED");
  assert.deepEqual(
    published.map((e) => e.revision),
    [1, 2],
  );
  assert.ok(k.c.t - T0 >= 10_000, "the first publish waited for settle_seconds");
});

test("watch: a Stop that keeps getting activity is not published until it settles", async () => {
  const env = await setup(BASE);
  const gh = new FakeGh();
  const k = clock(async (tick) => {
    if (tick <= 3) await appendFile(env.spoolFile, TOOL(`2026-10-22T10:0${tick}:30.000Z`));
    // the last activity was at tick 3 (6 s of settle windows are not enough yet)
    if (tick === 3) assert.equal(gh.creates, 0, "still inside the settle window");
    if (tick > 40) await appendFile(env.spoolFile, END("2026-10-22T11:00:00.000Z"));
  });
  const r = await watch(env, gh, k);
  assert.ok(gh.creates >= 1, r.reasons.join(";"));
});

test("watch: no activity for watch_idle_exit_seconds => WATCH_IDLE_EXIT, nothing published", async () => {
  const env = await setup(START, { watch_idle_exit_seconds: 60 });
  const gh = new FakeGh();
  const k = clock();
  const r = await watch(env, gh, k);
  assert.equal(r.state, "WATCH_IDLE_EXIT");
  assert.equal(gh.creates, 0);
  assert.ok(k.c.t - T0 >= 60_000);
  assert.ok((await states(env)).includes("WATCH_IDLE_EXIT"));
  assert.ok(!existsSync(watchLock(env)));
});

test("watch: max lifetime ends a watcher that still sees activity", async () => {
  const env = await setup(START, { watch_idle_exit_seconds: 100_000, watch_max_seconds: 30 });
  const gh = new FakeGh();
  const k = clock(async (tick) => {
    await appendFile(
      env.spoolFile,
      TOOL(`2026-10-22T10:00:${String(tick % 60).padStart(2, "0")}.000Z`),
    );
  });
  const r = await watch(env, gh, k);
  assert.equal(r.state, "WATCH_IDLE_EXIT");
  assert.match(r.reasons.join(";"), /watch_max_seconds/);
  assert.equal(gh.creates, 0);
});

test("watch: a second watcher for the same session is ALREADY_WATCHING", async () => {
  const env = await setup(START);
  const release = await new Outbox(env.outbox).lock(SID, "watch");
  assert.ok(release);
  const r = await watch(env, new FakeGh(), clock());
  assert.equal(r.state, "ALREADY_WATCHING");
  await release();
});

test("watch: kill switch via config at start, mid-run config flip and STOP file", async () => {
  const off = await setup(START, { enabled: false });
  assert.equal((await watch(off, new FakeGh(), clock())).state, "DISABLED");

  const flip = await setup(START);
  const k1 = clock(async (tick) => {
    if (tick === 2) {
      const cur = JSON.parse(await readFile(flip.config, "utf8")) as Record<string, unknown>;
      await writeFile(flip.config, JSON.stringify({ ...cur, enabled: false }));
    }
  });
  const r1 = await watch(flip, new FakeGh(), k1);
  assert.equal(r1.state, "DISABLED");
  assert.equal(k1.c.ticks, 2);

  const stop = await setup(START);
  const k2 = clock(async (tick) => {
    if (tick === 3) await writeFile(join(stop.outbox, "STOP"), "");
  });
  const r2 = await watch(stop, new FakeGh(), k2);
  assert.equal(r2.state, "DISABLED");
  assert.equal(k2.c.ticks, 3);
  assert.ok(!existsSync(watchLock(stop)));
});

test("watch: the CLI accepts --trigger watch and rejects it with --retry", async () => {
  const env = await setup(START, { enabled: false });
  let out = "";
  const code = await main(
    [
      "auto-report",
      "--agent",
      "codex",
      "--session",
      SID,
      "--trigger",
      "watch",
      "--config",
      env.config,
    ],
    {
      stdout: (s) => {
        out += s;
      },
    },
  );
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).state, "DISABLED");
  const bad = await main(["auto-report", "--retry", "--trigger", "watch", "--config", env.config], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(bad, 2);
});
