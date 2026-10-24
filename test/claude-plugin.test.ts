import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { parseClaudeHookSpool } from "../src/adapters/claude/hooks.ts";
import { classifyCommand } from "../src/adapters/zcode/parse.ts";
import { canonicalDigest } from "../src/canonical.ts";

const ROOT = join(import.meta.dirname, "..");
const MARKET = join(ROOT, "plugins", "claude");
const PLUGIN = join(MARKET, "task-meta-capture");
const SCRIPT = join(PLUGIN, "scripts", "capture.mjs");
const SID = "7c1d0000-aaaa-4bbb-8ccc-123456789abc";
const S = {
  prompt: "SENTINEL_PROMPT_cp01",
  cmd: "SENTINEL_CMD_cp02",
  resp: "SENTINEL_RESP_cp03",
  err: "SENTINEL_ERR_cp04",
  last: "SENTINEL_LAST_cp05",
  transcript: "SENTINEL_TRANSCRIPT_cp06",
  title: "SENTINEL_TITLE_cp07",
  note: "SENTINEL_NOTE_cp08",
  file: "SENTINEL_FILE_cp09",
};

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-claude-plugin-"));
  temps.push(d);
  return d;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A real git repo in a directory named like a workspace worktree, on a task branch. */
async function makeRepo(): Promise<string> {
  const parent = await tmp();
  const dir = join(parent, "dh-i1296-claude");
  mkdirSync(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "checkout", "-q", "-b", "task/dh-i1296-claude");
  git(dir, "remote", "add", "origin", "https://github.com/kaicreator-mm/domain-harness.git");
  return dir;
}

/** Hook stdin shaped like Claude Code's (base fields + per-event fields). */
function hook(event: string, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SID,
    transcript_path: `C:\\Users\\someone\\${S.transcript}\\${SID}.jsonl`,
    cwd,
    permission_mode: "default",
    hook_event_name: event,
    ...extra,
  });
}

function run(stdin: string, spool: string, env: Record<string, string | undefined> = {}) {
  const t0 = Date.now();
  const merged: Record<string, string | undefined> = {
    ...process.env,
    TASK_META_CLAUDE_SPOOL: spool,
    TASK_META_HOME: undefined,
    TASK_META_AUTO_REPORT: undefined,
    ...env,
  };
  const r = spawnSync(process.execPath, [SCRIPT], {
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

test("full lifecycle: sentinels never reach the spool; binding refs and git heads are captured", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const env = { TASK_META_HOME: home, MARKER: marker };
  const head = git(repo, "rev-parse", "HEAD");
  const promptText = `${S.prompt} 执行 domain-harness #1296：针对 PR #1298 ${S.prompt}`;

  const steps: Array<[string, Record<string, unknown>]> = [
    ["SessionStart", { source: "startup", model: "claude-opus-5-5", session_title: S.title }],
    ["UserPromptSubmit", { prompt: promptText, prompt_id: "p1" }],
    [
      "PreToolUse",
      {
        tool_name: "Bash",
        tool_use_id: "toolu_1",
        tool_input: { command: `npm test # ${S.cmd}`, description: S.file },
      },
    ],
    [
      "PostToolUse",
      {
        tool_name: "Bash",
        tool_use_id: "toolu_1",
        tool_input: { command: `npm test # ${S.cmd}` },
        tool_response: { stdout: S.resp, stderr: "", interrupted: false },
        duration_ms: 1234,
      },
    ],
    [
      "PostToolUseFailure",
      {
        tool_name: "Read",
        tool_use_id: "toolu_2",
        tool_input: { file_path: S.file },
        error: `${S.err}: no such file`,
        is_interrupt: true,
        duration_ms: 12,
      },
    ],
    [
      "SubagentStop",
      { agent_id: "agent1", agent_type: "general-purpose", last_assistant_message: S.last },
    ],
    ["PreCompact", { trigger: "auto", custom_instructions: S.note }],
    ["Notification", { message: S.note, title: S.title, notification_type: "idle_prompt" }],
  ];
  for (const [ev, extra] of steps) {
    const r = run(hook(ev, repo, extra), spool, env);
    assert.equal(r.code, 0, ev);
    assert.equal(r.stdout, "", ev);
  }
  // Dirty the tree before Stop (untracked file is enough).
  writeFileSync(join(repo, "b.txt"), "b\n");
  const stop = run(
    hook("Stop", repo, { stop_hook_active: false, last_assistant_message: S.last }),
    spool,
    env,
  );
  assert.equal(stop.code, 0);
  assert.equal(stop.stdout, "");
  assert.ok(stop.ms < 5000, `Stop took ${stop.ms} ms`);

  const raw = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
  for (const s of Object.values(S)) assert.ok(!raw.includes(s), `spool leaks ${s}`);
  assert.ok(!raw.includes("dh-i1296-claude"), "cwd name leaked");
  assert.ok(!raw.includes("tm-claude-plugin-"), "cwd path leaked");
  assert.ok(!raw.includes("someone"), "transcript path leaked");
  assert.ok(!raw.includes("transcript"), "transcript key leaked");
  assert.equal(existsSync(join(spool, "_errors.log")), false);

  // every line verifies against its digest and parses as a claude-hook entry
  const parsed = parseClaudeHookSpool(raw);
  assert.equal(parsed.skipped.length, 0);
  assert.equal(parsed.entries.length, steps.length + 1);
  for (const l of raw.split("\n").filter(Boolean)) {
    const o = JSON.parse(l) as { d: string; e: unknown };
    assert.equal(o.d, canonicalDigest(o.e));
  }

  const [start, prompt, pre, post, fail, subStop, compact, note, stopE] = lines(spool) as Array<
    Record<string, unknown>
  >;
  assert.equal(start?.plugin_version, "0.3.0");
  assert.equal(start?.agent, "claude");
  assert.equal(start?.session_source, "startup");
  assert.equal(start?.model, "claude-opus-5-5");
  assert.equal(start?.git_head, head);
  assert.equal(start?.git_dirty, false);
  assert.equal(start?.git_remote_repo, "kaicreator-mm/domain-harness");
  const wt = [
    { source: "WORKTREE", kind: "ISSUE", repo: "domain-harness", number: 1296 },
    { source: "BRANCH", kind: "ISSUE", repo: "domain-harness", number: 1296 },
  ];
  assert.deepEqual(start?.worktree_refs, wt);
  assert.match(String(start?.cwd_digest), /^[0-9a-f]{64}$/);
  assert.equal(prompt?.prompt_bytes, Buffer.byteLength(promptText));
  assert.deepEqual(prompt?.binding_refs, [
    { kind: "ISSUE", repo: "domain-harness", number: 1296 },
    { kind: "PR", repo: "domain-harness", number: 1298 },
  ]);
  assert.equal(prompt?.git_head, null);
  assert.equal(pre?.tool_call_id, "toolu_1");
  assert.equal(pre?.input_class, "TEST");
  assert.equal(post?.outcome, "success");
  assert.equal(post?.duration_ms, 1234);
  assert.equal(
    post?.result_bytes,
    Buffer.byteLength(JSON.stringify({ stdout: S.resp, stderr: "", interrupted: false })),
  );
  assert.equal(fail?.outcome, "interrupt");
  assert.equal(fail?.error_type, null);
  assert.equal(fail?.input_class, null);
  assert.equal(subStop?.event, "SubagentStop");
  assert.equal(subStop?.agent_id, "agent1");
  assert.equal(compact?.event, "PreCompact");
  assert.equal(note?.event, "Notification");
  assert.equal(stopE?.git_head, head);
  assert.equal(stopE?.git_dirty, true);
  assert.equal(stopE?.git_remote_repo, "kaicreator-mm/domain-harness");
  assert.deepEqual(stopE?.worktree_refs, wt);

  assert.ok(await waitFor(marker), "auto-report was not spawned");
  assert.equal(
    readFileSync(marker, "utf8"),
    `auto-report --agent claude --session ${SID} --trigger stop`,
  );
});

test("SessionEnd records heads quickly (no remote/refs) and spawns auto-report --trigger session-end", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const env = { TASK_META_HOME: home, MARKER: marker };
  const head = git(repo, "rev-parse", "HEAD");
  run(hook("SessionStart", repo, { source: "startup" }), spool, env);
  await sleep(1200);
  assert.ok(!existsSync(marker), "SessionStart must not trigger");
  const end = run(hook("SessionEnd", repo, { reason: "prompt_input_exit" }), spool, env);
  assert.equal(end.code, 0);
  assert.ok(end.ms < 1500, `SessionEnd took ${end.ms} ms (Claude Code cuts it off at 1.5 s)`);
  const [, e] = lines(spool) as Array<Record<string, unknown>>;
  assert.equal(e?.event, "SessionEnd");
  assert.equal(e?.end_reason, "prompt_input_exit");
  assert.equal(e?.git_head, head);
  assert.equal(e?.git_dirty, false);
  assert.equal(e?.git_remote_repo, null);
  assert.equal(e?.worktree_refs, null);
  assert.ok(await waitFor(marker), "SessionEnd did not spawn auto-report");
  assert.equal(
    readFileSync(marker, "utf8"),
    `auto-report --agent claude --session ${SID} --trigger session-end`,
  );
});

test("odd reasons and sources collapse to fixed tokens; no other event triggers", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  const env = { TASK_META_HOME: home, MARKER: marker, TASK_META_AUTO_REPORT: undefined };
  run(hook("SessionStart", repo, { source: `x ${S.note}` }), spool, env);
  run(
    hook("PreToolUse", repo, { tool_name: "Read", tool_use_id: "t1", tool_input: {} }),
    spool,
    env,
  );
  run(hook("SubagentStop", repo, { agent_id: "a1" }), spool, env);
  run(hook("PreCompact", repo, {}), spool, env);
  run(hook("Notification", repo, { message: S.note }), spool, env);
  await sleep(1500);
  assert.ok(!existsSync(marker), "only Stop/SessionEnd may trigger");
  const spoolBefore = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
  assert.ok(!spoolBefore.includes(S.note));
  assert.equal(lines(spool)[0]?.session_source, "OTHER");
});

test("TASK_META_AUTO_REPORT=0 disables both triggers but the spool is still written", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const home = await stubHome();
  const marker = join(await tmp(), "marker.txt");
  for (const ev of ["Stop", "SessionEnd"]) {
    const r = run(hook(ev, repo, { reason: "other" }), spool, {
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

test("missing task-meta CLI logs a class name; garbage stdin and unknown events exit 0 silently", async () => {
  const repo = await makeRepo();
  const spool = await tmp();
  const emptyHome = await tmp();
  const r = run(hook("Stop", repo), spool, { TASK_META_HOME: emptyHome });
  assert.equal(r.code, 0);
  assert.equal(lines(spool).length, 1);
  const log = readFileSync(join(spool, "_errors.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  assert.match(log[0] as string, /^\S+ AutoReportCliMissing$/);

  for (const bad of [
    "",
    "not json",
    "[]",
    JSON.stringify({ hook_event_name: "Bogus", session_id: SID }),
  ]) {
    const x = run(bad, spool, { TASK_META_AUTO_REPORT: "0" });
    assert.equal(x.code, 0);
    assert.equal(x.stdout, "");
  }
  assert.equal(lines(spool).length, 1, "no entry for garbage");
  const unwritable = join(spool, `${SID}.jsonl`); // a file where a directory is needed
  const y = run(hook("Stop", repo), join(unwritable, "sub"), { TASK_META_AUTO_REPORT: "0" });
  assert.equal(y.code, 0);
});

test("non-git or missing cwd yields null git fields and still captures", async () => {
  const spool = await tmp();
  const plain = await tmp();
  for (const cwd of [plain, join(plain, "does-not-exist")]) {
    const r = run(hook("SessionStart", cwd, { source: "resume" }), spool, {
      TASK_META_AUTO_REPORT: "0",
    });
    assert.equal(r.code, 0);
  }
  run(hook("SessionEnd", plain, { reason: "other" }), spool, { TASK_META_AUTO_REPORT: "0" });
  for (const e of lines(spool)) {
    assert.equal(e.git_head, null);
    assert.equal(e.git_dirty, null);
    assert.equal(e.git_remote_repo, null);
  }
  assert.equal(lines(spool).length, 3);
});

test("session id is sanitized for the file name only", async () => {
  const spool = await tmp();
  const r = run(
    JSON.stringify({ hook_event_name: "Notification", session_id: "a/b..c d", cwd: "." }),
    spool,
    { TASK_META_AUTO_REPORT: "0" },
  );
  assert.equal(r.code, 0);
  const l = JSON.parse(readFileSync(join(spool, "a_b__c_d.jsonl"), "utf8").trim());
  assert.equal(l.e.session_id, "a/b..c d");
});

test("plugin Bash classifier equals src/adapters/zcode/parse.ts classifyCommand", async () => {
  const mod = (await import(new URL(`file://${SCRIPT.replace(/\\/g, "/")}`).href)) as {
    classifyCommand: (c: string) => string;
    jcs: (v: unknown) => string;
  };
  for (const c of [
    "npm test",
    "rtk npx tsc --noEmit",
    "git status && ls",
    "cat a | grep b",
    "echo hi > out.txt",
    "bash tools/task-check.sh x",
    "node --test test/a.test.ts",
    "pnpm install",
    "unknown-binary --flag",
  ]) {
    assert.equal(mod.classifyCommand(c), classifyCommand(c), c);
  }
  assert.equal(mod.jcs({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
});

test("manifest, marketplace and hooks.json follow the Claude Code contract", () => {
  const manifest = JSON.parse(
    readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(manifest.name, "task-meta-capture");
  assert.equal(manifest.version, "0.3.0");
  const market = JSON.parse(
    readFileSync(join(MARKET, ".claude-plugin", "marketplace.json"), "utf8"),
  ) as { name: string; plugins: Array<Record<string, unknown>> };
  assert.equal(market.name, "dev-task-meta");
  assert.equal(market.plugins[0]?.name, "task-meta-capture");
  assert.equal(market.plugins[0]?.version, "0.3.0");
  assert.equal(market.plugins[0]?.source, "./task-meta-capture");

  const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8"))
    .hooks as Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;
  assert.deepEqual(Object.keys(hooks).sort(), [
    "Notification",
    "PostToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "PreToolUse",
    "SessionEnd",
    "SessionStart",
    "Stop",
    "SubagentStop",
    "UserPromptSubmit",
  ]);
  for (const [ev, groups] of Object.entries(hooks)) {
    const h = groups[0]?.hooks[0] as Record<string, unknown>;
    assert.equal(h.type, "command");
    assert.equal(h.command, "node", "exec form: no shell quoting on Windows");
    assert.deepEqual(h.args, [`${"$"}{CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs`]);
    // Stop and SessionEnd run synchronously so the spool line and trigger survive process exit.
    assert.equal(h.async === true, ev !== "Stop" && ev !== "SessionEnd", ev);
    assert.ok(Number(h.timeout) > 0 && Number(h.timeout) <= 5, ev);
  }
  const c = JSON.parse(readFileSync(join(PLUGIN, "config.json"), "utf8"));
  assert.equal(c.taskMetaHome, "~/.task-meta/app");
});

test("claude plugin validate passes for the plugin and the marketplace (when the CLI is installed)", (t) => {
  const probe = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    shell: true,
    timeout: 20000,
  });
  if (probe.status !== 0) {
    t.skip("claude CLI not installed");
    return;
  }
  for (const dir of [PLUGIN, MARKET]) {
    const r = spawnSync("claude", ["plugin", "validate", dir], {
      encoding: "utf8",
      shell: true,
      timeout: 60000,
    });
    if (r.status !== 0 && /unknown command|too old/i.test(`${r.stdout}${r.stderr}`)) {
      t.skip("claude CLI has no plugin validate");
      return;
    }
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /Validation passed/);
  }
});
