import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "plugins", "codex", "task-meta-capture");
const RUN = join(PLUGIN, "scripts", "run.cjs");
const capture = createRequire(import.meta.url)(join(PLUGIN, "scripts", "capture.cjs")) as {
  spawnMode: () => string;
  wmiCreateArgs: (exe: string, args: string[], cwd: string) => string[];
};

const temps: string[] = [];
after(async () => {
  // The WMI-created stub may still hold its directory briefly; retry and never fail on cleanup.
  for (const t of temps) {
    await rm(t, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-codex-wmi-"));
  temps.push(d);
  return d;
}

test("spawn mode: wmi on Windows by default, overridable; direct elsewhere", () => {
  const saved = process.env.TASK_META_SPAWN_MODE;
  try {
    delete process.env.TASK_META_SPAWN_MODE;
    assert.equal(capture.spawnMode(), process.platform === "win32" ? "wmi" : "direct");
    process.env.TASK_META_SPAWN_MODE = "direct";
    assert.equal(capture.spawnMode(), "direct");
    process.env.TASK_META_SPAWN_MODE = "bogus";
    assert.equal(capture.spawnMode(), process.platform === "win32" ? "wmi" : "direct");
  } finally {
    if (saved === undefined) delete process.env.TASK_META_SPAWN_MODE;
    else process.env.TASK_META_SPAWN_MODE = saved;
  }
});

test("wmiCreateArgs quotes the command line and escapes PowerShell single quotes", () => {
  const argv = capture.wmiCreateArgs(
    "C:\\Program Files\\nodejs\\node.exe",
    ["C:\\it's\\cli.ts", "auto-report", "--session", "sess-1"],
    "C:\\it's",
  );
  assert.deepEqual(argv.slice(0, 5), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
  ]);
  const script = argv[5] ?? "";
  assert.match(script, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.ok(
    script.includes(
      `CommandLine = '"C:\\Program Files\\nodejs\\node.exe" "C:\\it''s\\cli.ts" "auto-report" "--session" "sess-1"'`,
    ),
    script,
  );
  assert.ok(script.includes(`CurrentDirectory = 'C:\\it''s'`), script);
});

test("real WMI spawn: the auto-report process starts outside the hook process (Windows)", {
  skip: process.platform !== "win32",
}, async () => {
  // The stub CLI writes its marker next to itself (no env: a WMI-created process does not
  // inherit the hook's environment).
  const home = await tmp();
  mkdirSync(join(home, "src"));
  const marker = join(home, "marker.txt");
  writeFileSync(
    join(home, "src", "cli.ts"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));\n`,
  );
  const spool = await tmp();
  const stdin = JSON.stringify({
    hook_event_name: "SessionEnd",
    session_id: "wmi-sess-1",
    cwd: spool,
    reason: "exit",
  });
  const r = spawnSync(process.execPath, [RUN], {
    input: stdin,
    encoding: "utf8",
    env: {
      ...process.env,
      TASK_META_CODEX_SPOOL: spool,
      TASK_META_HOME: home,
      TASK_META_SPAWN_MODE: "wmi",
    },
    timeout: 15000,
  });
  assert.equal(r.status, 0, r.stderr);
  const end = Date.now() + 20000;
  while (Date.now() < end && !existsSync(marker)) await sleep(200);
  assert.ok(existsSync(marker), "WMI-created auto-report did not run");
  assert.match(readFileSync(marker, "utf8"), /auto-report --agent codex --session wmi-sess-1/);
});
