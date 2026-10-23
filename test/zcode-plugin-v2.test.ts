import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "plugins", "zcode", "task-meta-capture");
const SCRIPT = join(PLUGIN, "scripts", "capture.mjs");
const FX = join(import.meta.dirname, "fixtures", "zcode-hooks");
const PROMPT_SENTINEL = "SENTINEL_PROMPT_v2_5e1f";

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-plugin2-"));
  temps.push(d);
  return d;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A real git repo in a directory named like a workspace worktree, on a task branch. */
async function makeRepo(): Promise<string> {
  const parent = await tmp();
  const dir = join(parent, "dh-i1296-zcode");
  mkdirSync(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "checkout", "-q", "-b", "task/dh-i1296-zcode");
  git(dir, "remote", "add", "origin", "https://github.com/kaicreator-mm/domain-harness.git");
  return dir;
}

function hookInput(name: string, over: Record<string, unknown>): string {
  const f = JSON.parse(readFileSync(join(FX, name), "utf8")) as Record<string, unknown>;
  return JSON.stringify({ ...f, ...over });
}

function run(stdin: string, spool: string, env: Record<string, string> = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, TASK_META_ZCODE_SPOOL: spool, ...env },
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout, ms: Date.now() - t0 };
}

const lines = (spool: string, sid = "sess-synth-0001") =>
  readFileSync(join(spool, `${sid}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).e as Record<string, unknown>);

/** A task-meta home whose CLI stub records its argv in $MARKER. */
async function stubHome(): Promise<string> {
  const home = await tmp();
  mkdirSync(join(home, "src"));
  writeFileSync(
    join(home, "src", "cli.ts"),
    'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.MARKER as string, process.argv.slice(2).join(" "));\n',
  );
  return home;
}

async function waitFor(path: string, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(path)) return true;
    await sleep(100);
  }
  return false;
}

test("0.2.0 session lifecycle: git heads, remote, worktree refs, binding refs, auto-report", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const env = { TASK_META_HOME: home, MARKER: marker };
  const head = git(repo, "rev-parse", "HEAD");

  assert.equal(run(hookInput("session-start.json", { cwd: repo }), spool, env).code, 0);
  assert.equal(
    run(
      hookInput("user-prompt-submit.json", {
        cwd: repo,
        prompt: `${PROMPT_SENTINEL} 执行 domain-harness v0.10.1 #1296：针对 PR #1298 当前精确 HEAD ${PROMPT_SENTINEL}`,
      }),
      spool,
      env,
    ).code,
    0,
  );
  // Dirty the tree before Stop (untracked file is enough).
  writeFileSync(join(repo, "b.txt"), "b\n");
  const stop = run(hookInput("stop.json", { cwd: repo }), spool, env);
  assert.equal(stop.code, 0);
  assert.equal(stop.stdout, "");
  assert.ok(stop.ms < 5000, `Stop took ${stop.ms} ms`);

  const raw = readFileSync(join(spool, "sess-synth-0001.jsonl"), "utf8");
  assert.ok(!raw.includes(PROMPT_SENTINEL), "prompt text leaked into the spool");
  assert.ok(!raw.includes("dh-i1296-zcode"), "cwd name leaked");
  assert.ok(!raw.includes("tm-plugin2-"), "cwd path leaked");
  const [start, prompt, stopE] = lines(spool) as [
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  assert.equal(start.plugin_version, "0.2.2");
  assert.equal(start.git_head, head);
  assert.equal(start.git_dirty, false);
  assert.equal(start.git_remote_repo, "kaicreator-mm/domain-harness");
  const wt = [
    { source: "WORKTREE", kind: "ISSUE", repo: "domain-harness", number: 1296 },
    { source: "BRANCH", kind: "ISSUE", repo: "domain-harness", number: 1296 },
  ];
  assert.deepEqual(start.worktree_refs, wt);
  assert.match(String(start.cwd_digest), /^[0-9a-f]{64}$/);
  assert.equal(
    prompt.prompt_bytes,
    Buffer.byteLength(
      `${PROMPT_SENTINEL} 执行 domain-harness v0.10.1 #1296：针对 PR #1298 当前精确 HEAD ${PROMPT_SENTINEL}`,
    ),
  );
  assert.deepEqual(prompt.binding_refs, [
    { kind: "ISSUE", repo: "domain-harness", number: 1296 },
    { kind: "PR", repo: "domain-harness", number: 1298 },
  ]);
  assert.equal(prompt.git_head, null);
  assert.equal(stopE.git_head, head);
  assert.equal(stopE.git_dirty, true);
  assert.equal(stopE.git_remote_repo, "kaicreator-mm/domain-harness");
  assert.deepEqual(stopE.worktree_refs, wt);

  assert.ok(await waitFor(marker), "auto-report was not spawned");
  assert.equal(
    readFileSync(marker, "utf8"),
    "auto-report --agent zcode --session sess-synth-0001 --trigger stop",
  );
});

test("TASK_META_AUTO_REPORT=0 disables the Stop trigger", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const r = run(hookInput("stop.json", { cwd: repo }), spool, {
    TASK_META_HOME: home,
    MARKER: marker,
    TASK_META_AUTO_REPORT: "0",
  });
  assert.equal(r.code, 0);
  assert.equal(lines(spool).length, 1);
  await sleep(1500);
  assert.ok(!existsSync(marker));
});

test("only Stop triggers auto-report", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const env = { TASK_META_HOME: home, MARKER: marker };
  run(hookInput("session-start.json", { cwd: repo }), spool, env);
  run(hookInput("pre-tool-use.json", { cwd: repo }), spool, env);
  await sleep(1500);
  assert.ok(!existsSync(marker));
});

test("missing task-meta CLI logs a class name and skips", async () => {
  const spool = await tmp();
  const emptyHome = await tmp();
  const r = run(hookInput("stop.json", {}), spool, { TASK_META_HOME: emptyHome });
  assert.equal(r.code, 0);
  assert.equal(lines(spool).length, 1);
  const log = readFileSync(join(spool, "_errors.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  assert.match(log[0] as string, /^\S+ AutoReportCliMissing$/);
});

test("non-git or missing cwd yields null git fields and still captures", async () => {
  const spool = await tmp();
  const plain = await tmp();
  for (const cwd of [plain, join(plain, "does-not-exist")]) {
    const r = run(hookInput("session-start.json", { cwd }), spool, {
      TASK_META_AUTO_REPORT: "0",
    });
    assert.equal(r.code, 0);
  }
  for (const e of lines(spool)) {
    assert.equal(e.git_head, null);
    assert.equal(e.git_dirty, null);
    assert.equal(e.git_remote_repo, null);
  }
  assert.equal(lines(spool).length, 2);
});

test("shipped config.json points at the default task-meta home", () => {
  const c = JSON.parse(readFileSync(join(PLUGIN, "config.json"), "utf8"));
  assert.equal(c.taskMetaHome, "~/.task-meta/app");
});

test("manifest and marketplace are at 0.2.2", () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".zcode-plugin", "plugin.json"), "utf8"));
  const market = JSON.parse(
    readFileSync(join(ROOT, "plugins", "zcode", "marketplace.json"), "utf8"),
  );
  assert.equal(manifest.version, "0.2.2");
  assert.equal(market.plugins[0].version, "0.2.2");
});
