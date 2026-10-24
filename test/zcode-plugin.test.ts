import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { classifyCommand } from "../src/adapters/zcode/parse.ts";
import { canonicalize } from "../src/canonical.ts";
import { findForbiddenContent } from "../src/privacy.ts";
import { Spool } from "../src/store/spool.ts";

const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "plugins", "zcode", "task-meta-capture");
const SCRIPT = join(PLUGIN, "scripts", "capture.mjs");
const FX = join(import.meta.dirname, "fixtures", "zcode-hooks");
const SENTINELS = [
  "SENTINEL_CWD_4c1d",
  "SENTINEL_PROMPT_7f3a",
  "SENTINEL_ATTACH_91bc",
  "SENTINEL_TOOLARG_3d2e",
  "SENTINEL_RESPONSE_c0de",
  "SENTINEL_PREVIEW_8812",
  "SENTINEL_PATH_55aa",
  "SENTINEL_ERRMSG",
  "SENTINEL_RESPONSE_PREVIEW_77ee",
  "SENTINEL_RESPONSE_TEXT_c0de",
  "ghp_SENTINELSENTINEL1234",
  "C:\\Users\\someone",
  "transcript",
];

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-plugin-"));
  temps.push(d);
  return d;
}

function run(stdin: string, spool: string) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, TASK_META_ZCODE_SPOOL: spool, TASK_META_AUTO_REPORT: "0" },
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const FIXTURES = [
  "session-start.json",
  "user-prompt-submit.json",
  "pre-tool-use.json",
  "post-tool-use.json",
  "post-tool-use-failure.json",
  "stop.json",
];
const SID = "sess-synth-0001";
const ROOT_VAR = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");

test("each hook event appends exactly one verifiable metadata-only line", async () => {
  const spool = await tmp();
  for (const [i, f] of FIXTURES.entries()) {
    const r = run(fx(f), spool);
    assert.equal(r.code, 0, f);
    assert.equal(r.stdout, "", `${f} must print nothing`);
    const raw = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
    assert.equal(raw.split("\n").filter(Boolean).length, i + 1, f);
  }
  const raw = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
  for (const s of SENTINELS) assert.ok(!raw.includes(s), `spool leaks ${s}`);
  for (const k of ["toolInput", "toolResponse", "prompt", "cwd", "responseText", "message"]) {
    assert.ok(!raw.includes(`"${k}"`), `spool has key ${k}`);
  }
  const { entries, skipped } = await new Spool(join(spool, `${SID}.jsonl`)).replay();
  assert.deepEqual(skipped, []);
  assert.equal(entries.length, FIXTURES.length);
  assert.deepEqual(findForbiddenContent(entries, SENTINELS), []);
  const e = entries as Array<Record<string, unknown>>;
  const by = (ev: string) => e.find((x) => x.event === ev) as Record<string, unknown>;
  assert.equal(by("PostToolUse").result_bytes, Buffer.byteLength("SENTINEL_PREVIEW_8812 \u00e9"));
  assert.equal(by("PostToolUse").outcome, "success");
  assert.equal(by("PreToolUse").input_class, "TEST");
  assert.equal(by("PostToolUseFailure").outcome, "failure");
  assert.equal(by("PostToolUseFailure").error_type, "ToolExecutionError");
  assert.equal(by("Stop").tool_call_count, 3);
  assert.equal(by("SessionStart").session_source, "startup");
  assert.equal(by("SessionStart").model, "glm-5.1");
  assert.equal(
    by("UserPromptSubmit").prompt_bytes,
    Buffer.byteLength("SENTINEL_PROMPT_7f3a hello"),
  );
  assert.match(String(by("Stop").cwd_digest), /^[0-9a-f]{64}$/);
  for (const x of e) {
    assert.ok(!("cwd" in x));
    assert.equal(x.schema, "task-meta/zcode-hook/v1");
    assert.equal(x.hook_ts !== null, true);
  }
});

test("interrupt and odd error types are classified without leaking text", async () => {
  const spool = await tmp();
  const f = JSON.parse(fx("post-tool-use-failure.json"));
  f.isInterrupt = true;
  f.error_details = { type: "has spaces SENTINEL_ERRMSG", message: "SENTINEL_ERRMSG" };
  assert.equal(run(JSON.stringify(f), spool).code, 0);
  const raw = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
  assert.ok(!raw.includes("SENTINEL_ERRMSG"));
  const e = JSON.parse(raw.trim()).e;
  assert.equal(e.outcome, "interrupt");
  assert.equal(e.error_type, "OTHER");
});

test("garbage stdin and unknown events exit 0, write no entry, log only a class name", async () => {
  const spool = await tmp();
  for (const input of [
    "",
    "not json {{{",
    "[]",
    "null",
    '{"hookEventName":"Nope","sessionId":"x"}',
  ]) {
    const r = run(input, spool);
    assert.equal(r.code, 0, input);
    assert.equal(r.stdout, "");
  }
  assert.ok(!readdirSync(spool).some((f) => f.endsWith(".jsonl")));
  const log = readFileSync(join(spool, "_errors.log"), "utf8");
  for (const l of log.split("\n").filter(Boolean)) {
    assert.match(l, /^\S+ (SyntaxError|TypeError|RangeError)$/);
  }
});

test("unwritable spool directory still exits 0 silently", async () => {
  const d = await tmp();
  const blocker = join(d, "file");
  writeFileSync(blocker, "x");
  const r = run(fx("pre-tool-use.json"), join(blocker, "sub"));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
});

test("session id is sanitized for the file name only", async () => {
  const spool = await tmp();
  const f = JSON.parse(fx("stop.json"));
  f.sessionId = "../evil/sess id";
  f.session_id = f.sessionId;
  assert.equal(run(JSON.stringify(f), spool).code, 0);
  assert.deepEqual(readdirSync(spool), ["___evil_sess_id.jsonl"]);
});

test("default spool dir is under the home directory (no env override)", async () => {
  const mod = (await import(pathToFileURL(SCRIPT).href)) as { spoolDir: () => string };
  const saved = process.env.TASK_META_ZCODE_SPOOL;
  delete process.env.TASK_META_ZCODE_SPOOL;
  try {
    assert.equal(mod.spoolDir(), join(homedir(), ".task-meta", "zcode-spool"));
  } finally {
    if (saved !== undefined) process.env.TASK_META_ZCODE_SPOOL = saved;
  }
});

test("plugin JCS equals the task-meta canonicalizer", async () => {
  const mod = (await import(pathToFileURL(SCRIPT).href)) as {
    jcs: (v: unknown) => string;
  };
  const samples: unknown[] = [
    { b: 1, a: [1, 2.5, -0, 'x\u00e9\u4e2d\n"\\'], "\u00e9": null, A: true, "10": 0, "9": 1 },
    { z: { y: { x: [] } }, "\ud83d\ude00": "\ud83d\ude00", "\uffff": 1 },
    [],
    "s",
    { n: 123456789012 },
  ];
  for (const s of samples) assert.equal(mod.jcs(s), canonicalize(s));
});

const COMMANDS = [
  "npm test",
  "npm run test:unit",
  "npm run typecheck",
  "npm run lint",
  "npm run build",
  "npm run dev",
  "npm ci",
  "pnpm install",
  "pnpm test",
  "pnpm lint",
  "npx vitest run",
  "npx tsc --noEmit",
  "npx biome check .",
  "node --test test/a.test.ts",
  "node script.js",
  "bash tools/task-check.sh /x",
  "bash -c 'echo hi'",
  "sh run.sh",
  "git status",
  "gh pr view 1",
  "cd /x && git diff",
  "export A=1; npm test",
  "A=1 B=2 npm test",
  "rtk git log",
  "timeout 60 npm test",
  "env FOO=1 cargo test",
  "cargo build --release",
  "go test ./...",
  "go build ./...",
  "make all",
  "pytest -q",
  "python -m pytest",
  "python script.py",
  "pip install x",
  "fnm use 22",
  "cat a.txt",
  "cat a.txt > b.txt",
  "grep -rn foo src",
  "ls -la | head",
  "sed -n 1,5p f",
  "sed -i s/a/b/ f",
  "mkdir -p x",
  "rm -rf x",
  "echo hi > out.txt",
  "echo hi",
  "tsc -p .",
  "eslint .",
  "",
  "   ",
  "\n\nnpm test\n",
  "C:\\tools\\git.exe status",
];

test("classifier parity with src/adapters/zcode/parse.ts classifyCommand", async () => {
  assert.ok(COMMANDS.length >= 40);
  const mod = (await import(pathToFileURL(SCRIPT).href)) as {
    classifyCommand: (c: string) => string;
  };
  for (const c of COMMANDS) {
    assert.equal(mod.classifyCommand(c), classifyCommand(c), JSON.stringify(c));
  }
});

test("manifest, marketplace and hooks.json follow the ZCode contract", () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".zcode-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "task-meta-capture");
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.hooks, "./hooks/hooks.json");
  const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), [
    "PostToolUse",
    "PostToolUseFailure",
    "PreToolUse",
    "SessionStart",
    "Stop",
    "UserPromptSubmit",
  ]);
  for (const [event, groups] of Object.entries(hooks) as Array<
    [string, Array<Record<string, unknown>>]
  >) {
    assert.equal(groups.length, 1);
    const list = groups[0]?.hooks as Array<Record<string, unknown>>;
    const hook = list[0] ?? {};
    assert.equal(hook.type, "command");
    assert.equal(hook.command, `node "${ROOT_VAR}/scripts/capture.mjs"`);
    // Stop runs in the foreground: a headless run exits right after Stop and would kill a
    // background hook (observed in the first real E2E run: no Stop entry captured).
    assert.equal(hook.async, event !== "Stop", event);
    assert.equal(hook.timeout, 5);
  }
  const market = JSON.parse(
    readFileSync(join(ROOT, "plugins", "zcode", "marketplace.json"), "utf8"),
  );
  assert.equal(market.name, "dev-task-meta");
  assert.equal(market.plugins[0].name, manifest.name);
  assert.equal(market.plugins[0].source, "./task-meta-capture");
  assert.equal(market.plugins[0].category, "developer-tools");
  assert.ok(existsSync(join(ROOT, "plugins", "zcode", market.plugins[0].source, ".zcode-plugin")));
});

test("official validate-plugin preflight passes (when the plugin-creator skill is installed)", async (t) => {
  const v = join(
    homedir(),
    ".zcode/cli/plugins/cache/zcode-plugins-official/plugin-creator/0.1.1/skills/plugin-creator/scripts/validate-plugin.mjs",
  );
  if (!existsSync(v)) return t.skip("plugin-creator not installed");
  const mod = (await import(pathToFileURL(v).href)) as {
    preflightPlugin: (p: string) => Promise<string[]>;
  };
  assert.deepEqual(await mod.preflightPlugin(PLUGIN), []);
});
