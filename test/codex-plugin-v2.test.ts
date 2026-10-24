import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { parseCodexHookSpool } from "../src/adapters/codex/hooks.ts";

const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "plugins", "codex", "task-meta-capture");
const RUN = join(PLUGIN, "scripts", "run.cjs");
const SID = "01a1aaaa-1111-7222-8333-444455556666";
const PROMPT_SENTINEL = "SENTINEL_PROMPT_codex_v2_5e1f";

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-codex-plugin2-"));
  temps.push(d);
  return d;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A real git repo in a directory named like a workspace worktree, on a task branch. */
async function makeRepo(): Promise<string> {
  const parent = await tmp();
  const dir = join(parent, "dh-i1296-codex");
  mkdirSync(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "checkout", "-q", "-b", "task/dh-i1296-codex");
  git(dir, "remote", "add", "origin", "https://github.com/kaicreator-mm/domain-harness.git");
  return dir;
}

function hook(event: string, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SID,
    transcript_path: "C:\\Users\\someone\\SENTINEL_TRANSCRIPT_55aa\\rollout.jsonl",
    cwd,
    hook_event_name: event,
    model: "gpt-test-1",
    permission_mode: "default",
    ...extra,
  });
}

function run(stdin: string, spool: string, env: Record<string, string | undefined> = {}) {
  const t0 = Date.now();
  const merged: Record<string, string | undefined> = {
    ...process.env,
    TASK_META_CODEX_SPOOL: spool,
    TASK_META_HOME: undefined,
    TASK_META_AUTO_REPORT: undefined,
    TASK_META_SPAWN_MODE: "direct",
    ...env,
  };
  const r = spawnSync(process.execPath, [RUN], {
    input: stdin,
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as Record<
      string,
      string
    >,
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout, ms: Date.now() - t0 };
}

const lines = (spool: string) =>
  readFileSync(join(spool, `${SID}.jsonl`), "utf8")
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

test("0.2.0 lifecycle: worktree/binding refs, git facts, prompt never stored, Stop spawns auto-report", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const env = { TASK_META_HOME: home, MARKER: marker };
  const head = git(repo, "rev-parse", "HEAD");

  const startMarker = join(await tmp(), "start-marker.txt");
  assert.equal(
    run(hook("SessionStart", repo, { source: "startup" }), spool, {
      ...env,
      MARKER: startMarker,
    }).code,
    0,
  );
  assert.ok(await waitFor(startMarker), "SessionStart did not spawn the watcher");
  assert.equal(
    readFileSync(startMarker, "utf8"),
    `auto-report --agent codex --session ${SID} --trigger watch`,
  );
  assert.equal(
    run(
      hook("UserPromptSubmit", repo, {
        turn_id: "t1",
        prompt: `${PROMPT_SENTINEL} 执行 domain-harness v0.10.1 #1296：针对 PR #1298 ${PROMPT_SENTINEL}`,
      }),
      spool,
      env,
    ).code,
    0,
  );
  writeFileSync(join(repo, "b.txt"), "b\n");
  const stop = run(hook("Stop", repo, { turn_id: "t1" }), spool, env);
  assert.equal(stop.code, 0);
  assert.equal(stop.stdout, "");
  assert.ok(stop.ms < 5000, `Stop took ${stop.ms} ms`);

  const raw = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
  assert.ok(!raw.includes(PROMPT_SENTINEL), "prompt text leaked into the spool");
  assert.ok(!raw.includes("dh-i1296-codex"), "cwd name leaked");
  assert.ok(!raw.includes("tm-codex-plugin2-"), "cwd path leaked");
  const [start, prompt, stopE] = lines(spool) as [
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  assert.equal(start.plugin_version, "0.3.0");
  assert.equal(start.git_head, head);
  assert.equal(start.git_remote_repo, "kaicreator-mm/domain-harness");
  const wt = [
    { source: "WORKTREE", kind: "ISSUE", repo: "domain-harness", number: 1296 },
    { source: "BRANCH", kind: "ISSUE", repo: "domain-harness", number: 1296 },
  ];
  assert.deepEqual(start.worktree_refs, wt);
  assert.deepEqual(prompt.binding_refs, [
    { kind: "ISSUE", repo: "domain-harness", number: 1296 },
    { kind: "PR", repo: "domain-harness", number: 1298 },
  ]);
  assert.equal(prompt.git_head, null);
  assert.equal(stopE.git_dirty, true);
  assert.deepEqual(stopE.worktree_refs, wt);

  // the host-side parser keeps the refs and verifies the digests
  const parsed = parseCodexHookSpool(raw);
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[1]?.binding_refs?.length, 2);

  assert.ok(await waitFor(marker), "auto-report was not spawned");
  assert.equal(
    readFileSync(marker, "utf8"),
    `auto-report --agent codex --session ${SID} --trigger stop`,
  );
});

test("TASK_META_AUTO_REPORT=0 disables the Stop and SessionEnd triggers", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  for (const ev of ["Stop", "SessionEnd"]) {
    const r = run(hook(ev, repo), spool, {
      TASK_META_HOME: home,
      MARKER: marker,
      TASK_META_AUTO_REPORT: "0",
    });
    assert.equal(r.code, 0);
  }
  assert.equal(lines(spool).length, 2);
  await sleep(1500);
  assert.ok(!existsSync(marker));
});

test("SessionEnd also triggers; other events do not", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const env = { TASK_META_HOME: home, MARKER: marker };
  run(hook("SessionStart", repo), spool, {
    ...env,
    MARKER: join(await tmp(), "start-marker.txt"),
  });
  run(
    hook("PreToolUse", repo, { tool_name: "exec", tool_use_id: "c1", tool_input: {} }),
    spool,
    env,
  );
  await sleep(1500);
  assert.ok(!existsSync(marker));
  run(hook("SessionEnd", repo, { reason: "exit" }), spool, env);
  assert.ok(await waitFor(marker), "SessionEnd did not spawn auto-report");
  assert.equal(
    readFileSync(marker, "utf8"),
    `auto-report --agent codex --session ${SID} --trigger session-end`,
  );
});

test("missing task-meta CLI logs a class name and skips; non-git cwd still captures", async () => {
  const spool = await tmp();
  const emptyHome = await tmp();
  const plain = await tmp();
  const r = run(hook("Stop", plain), spool, { TASK_META_HOME: emptyHome });
  assert.equal(r.code, 0);
  const [e] = lines(spool);
  assert.equal(e?.git_head, null);
  assert.equal(e?.git_remote_repo, null);
  const log = readFileSync(join(spool, "_errors.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  assert.match(log[0] as string, /^\S+ AutoReportCliMissing$/);
});

test("shipped config.json, manifest and CJS lib build are in place at 0.3.0", () => {
  const c = JSON.parse(readFileSync(join(PLUGIN, "config.json"), "utf8"));
  assert.equal(c.taskMetaHome, "~/.task-meta/app");
  const m = JSON.parse(readFileSync(join(PLUGIN, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(m.version, "0.3.0");
  for (const f of ["binding-extract.cjs", "git-meta.cjs", "repo-aliases.json"]) {
    assert.ok(existsSync(join(PLUGIN, "scripts", "lib", f)), f);
  }
});
