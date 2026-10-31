// C2 #71 pre-change baseline bench: paired synthetic Hook ON/OFF runs on the local
// Windows Node24 host. Hook ON  = real Stop-hook chain: plugins/zcode capture.mjs ->
// spool append -> detached `task-meta auto-report --trigger stop` -> outbox entry.
// Hook OFF = identical invocation shape (same node binary, same stdin bytes) into a
// null sink: no spool write, no auto-report, no outbox.
//
// Isolation: the measured source is pinned to --source-sha via `git archive` into an
// install copy whose config/auto-report.json is repointed at bench-local spool/outbox/
// store dirs with settle_seconds=0; publication is fail-closed (clearance_ref stays ""
// => HELD, no POST, no network). Each run gets a unique session id so runs never share
// spool files, locks, or outbox revisions.
//
// Truthfulness: every counter is either actually witnessed or recorded null with the
// reason; CPU/RSS of (detached) children is not exposed by win32 Node and is recorded
// N/A, never estimated. Raw per-run records are appended to <root>/runs.ndjson as each
// run completes, so a crashed session still leaves its earlier evidence.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, hostname, platform, release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSourceSha, summarize } from "./bench-task-meta-summary.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

const ROOT = resolve(arg("root", join(REPO, "..", "..", "_tmp", "tm-v040-c2-bench", "runs")));
const PAIRS = Number(arg("pairs", "6"));
const SOURCE_SHA = resolveSourceSha(arg("source-sha"), () =>
  execFileSync_(["git", "rev-parse", "origin/version/v0.4"], { cwd: REPO }).trim(),
);
const INSTALL = resolve(arg("install", join(ROOT, "install")));
const SMOKE = process.argv.includes("--smoke");
const OUTBOX_POLL_MS = 100;
const OUTBOX_WAIT_MS = 60_000;
const SPAWN_TIMEOUT_MS = 15_000;

function execFileSync_(cmd, opts) {
  const r = spawnSyncRaw(cmd[0], cmd.slice(1), opts);
  if (r.status !== 0) throw new Error(`${cmd.join(" ")} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

function spawnSyncRaw(file, args, opts = {}) {
  const r = spawnSync(file, args, { encoding: "utf8", ...opts });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function git(rev, args) {
  return execFileSync_(["git", ...args], { cwd: REPO }).trim();
}

// ---------- install copy (pinned pre-change source) ----------
function prepareInstall() {
  if (existsSync(join(INSTALL, "src", "cli.ts")) && existsSync(join(INSTALL, ".bench-source"))) {
    const pinned = readFileSync(join(INSTALL, ".bench-source"), "utf8").trim();
    if (pinned === SOURCE_SHA) return { reused: true };
    rmSync(INSTALL, { recursive: true, force: true });
  }
  rmSync(INSTALL, { recursive: true, force: true });
  mkdirSync(INSTALL, { recursive: true });
  const tar = join(ROOT, `source-${SOURCE_SHA.slice(0, 10)}.tar`);
  execFileSync_(["git", "archive", "--format=tar", "-o", tar, SOURCE_SHA], { cwd: REPO });
  // GNU tar misreads "C:\..." as a remote host; the Windows bsdtar handles drive letters.
  const sysTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const untar = existsSync(sysTar) ? sysTar : "tar";
  execFileSync_([untar, "-xf", tar, "-C", INSTALL], { cwd: ROOT });
  // git archive carries no node_modules; the runner imports ajv/yaml, so mirror the
  // worktree's lockfile-exact install into the copy (ESM ignores NODE_PATH).
  cpSync(join(REPO, "node_modules"), join(INSTALL, "node_modules"), { recursive: true });
  rmSync(tar, { force: true });
  writeFileSync(join(INSTALL, ".bench-source"), `${SOURCE_SHA}\n`);
  const cfgPath = join(INSTALL, "config", "auto-report.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.settle_seconds = 0;
  cfg.store = join(ROOT, "store");
  cfg.outbox = join(ROOT, "outbox");
  cfg.zcode.spool_dir = join(ROOT, "spool");
  cfg.zcode.rollout_dir = join(ROOT, "rollout");
  cfg.gate_log_root = null;
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  return { reused: false };
}

// ---------- fixture ----------
function buildPayload(sessionId) {
  const tpl = JSON.parse(
    readFileSync(join(REPO, "test", "fixtures", "zcode-hooks", "stop.json"), "utf8"),
  );
  tpl.sessionId = sessionId;
  tpl.session_id = sessionId;
  tpl.cwd = REPO; // real git worktree: gitFields() runs its true git commands
  return JSON.stringify(tpl);
}

const NOOP_MJS = `import { readFileSync } from "node:fs";\nreadFileSync(0);\n`;

// ---------- outbox/spool witnesses ----------
function outboxEntries() {
  const dir = join(ROOT, "outbox");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const o = JSON.parse(line);
        // Outbox lines are Spool envelopes {"d":<sha>,"e":<entry>}.
        out.push({ file: f, ...(o.e ?? o) });
      } catch {
        /* ignore torn tail */
      }
    }
  }
  return out;
}

function countSpoolLines() {
  const dir = join(ROOT, "spool");
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".jsonl"))
      n += readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "").length;
  }
  return n;
}

function spoolFileFor(sessionId) {
  const p = join(ROOT, "spool", `${sessionId}.jsonl`);
  if (!existsSync(p)) return null;
  const buf = readFileSync(p);
  return {
    path: p,
    bytes: buf.length,
    lines: buf
      .toString("utf8")
      .split("\n")
      .filter((l) => l.trim() !== "").length,
  };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runChild(label, file, args, env, input) {
  const t0 = performance.now();
  const child = spawn(process.execPath, [file, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdin.end(input);
  const exit = await new Promise((res, rej) => {
    const killer = setTimeout(() => {
      child.kill();
      rej(new Error(`${label}: spawn timeout after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(killer);
      rej(e);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      res({ code, signal });
    });
  });
  return { exit, wall_ms: Math.round((performance.now() - t0) * 10) / 10, t0, stderr };
}

async function waitForOutboxEntry(sessionId, t0) {
  const deadline = t0 + OUTBOX_WAIT_MS;
  for (;;) {
    const hit = outboxEntries().find((e) => e.session === sessionId);
    if (hit) return { entry: hit, at: performance.now() };
    if (performance.now() > deadline) return null;
    await wait(OUTBOX_POLL_MS);
  }
}

// ---------- one run ----------
async function runOne(kind, seq, sessionBase) {
  const sessionId = `sess-bench-${sessionBase}-${String(seq).padStart(2, "0")}-${kind}`;
  const payload = buildPayload(sessionId);
  const spoolBefore = countSpoolLines();
  const outboxBefore = outboxEntries().length;

  const rec = {
    ts: new Date().toISOString(),
    run: seq,
    kind,
    session_id: sessionId,
    stdin_sha256: createHash("sha256").update(payload).digest("hex"),
    stdin_bytes: Buffer.byteLength(payload),
  };

  if (kind === "ON") {
    const capture = join(
      INSTALL,
      "plugins",
      "zcode",
      "task-meta-capture",
      "scripts",
      "capture.mjs",
    );
    const r = await runChild(
      "capture",
      capture,
      [],
      { TASK_META_HOME: INSTALL, TASK_META_ZCODE_SPOOL: join(ROOT, "spool") },
      payload,
    );
    rec.command = `node ${capture} < payload.json (env TASK_META_HOME=${INSTALL} TASK_META_ZCODE_SPOOL=${join(ROOT, "spool")})`;
    rec.exit_code = r.exit.code;
    rec.exit_signal = r.exit.signal;
    rec.hook_wall_ms = r.wall_ms;
    rec.capture_stderr = r.stderr === "" ? null : r.stderr.slice(0, 500);
    rec.stop_to_outbox_ms = null;
    rec.outbox = null;
    const sf = spoolFileFor(sessionId);
    rec.spool_bytes = sf?.bytes ?? null;
    rec.spool_lines = sf?.lines ?? null;
    if (sf) rec.spool_sha256 = sha256(sf.path);
    const hit = await waitForOutboxEntry(sessionId, r.t0);
    if (hit) {
      rec.stop_to_outbox_ms = Math.round((hit.at - r.t0) * 10) / 10;
      rec.outbox = {
        state: hit.entry.state ?? null,
        reasons: hit.entry.reasons ?? null,
        revision: hit.entry.revision ?? null,
        at: hit.entry.at ?? null,
        file: hit.entry.file,
      };
    }
    rec.outbox_seen = hit !== null;
  } else {
    const noop = join(ROOT, "noop.mjs");
    const r = await runChild("noop", noop, [], {}, payload);
    rec.command = `node ${noop} < payload.json (hook absent null sink, identical invocation shape)`;
    rec.exit_code = r.exit.code;
    rec.exit_signal = r.exit.signal;
    rec.hook_wall_ms = r.wall_ms;
    const spoolAfter = countSpoolLines();
    const outboxAfter = outboxEntries().length;
    rec.spool_delta = spoolAfter - spoolBefore;
    rec.outbox_delta = outboxAfter - outboxBefore;
    rec.spool_bytes = null;
    rec.spool_lines = null;
    rec.stop_to_outbox_ms = null;
    rec.outbox = null;
    rec.absence_witnessed = rec.spool_delta === 0 && rec.outbox_delta === 0;
  }
  rec.cpu_rss =
    "N/A: win32 Node exposes no child rusage and the auto-report child is detached; not witnessed, not estimated";
  return rec;
}

// ---------- main ----------
mkdirSync(ROOT, { recursive: true });
writeFileSync(join(ROOT, "noop.mjs"), NOOP_MJS);
const inst = prepareInstall();
const envReceipt = {
  bench_started_at: new Date().toISOString(),
  node: process.version,
  node_exec_path: process.execPath,
  platform: platform(),
  os_release: release(),
  arch: process.arch,
  hostname: hostname(),
  cpu_count: cpus().length,
  cpu_model: cpus()[0]?.model ?? null,
  source_sha: SOURCE_SHA,
  worktree_head: git("", ["rev-parse", "HEAD"]),
  install_dir: INSTALL,
  capture_mjs_sha256: sha256(
    join(INSTALL, "plugins", "zcode", "task-meta-capture", "scripts", "capture.mjs"),
  ),
  worktree_capture_mjs_sha256: sha256(
    join(REPO, "plugins", "zcode", "task-meta-capture", "scripts", "capture.mjs"),
  ),
  fixture_template_sha256: sha256(join(REPO, "test", "fixtures", "zcode-hooks", "stop.json")),
  pairs_requested: SMOKE ? 1 : PAIRS,
};
{
  const src = readFileSync(
    join(INSTALL, "plugins", "zcode", "task-meta-capture", "scripts", "capture.mjs"),
    "utf8",
  );
  const pv = /PLUGIN_VERSION = "([^"]+)"/.exec(src);
  envReceipt.plugin_version = pv ? pv[1] : null;
}

envReceipt.install_reused = inst.reused;
envReceipt.install_config = JSON.parse(
  readFileSync(join(INSTALL, "config", "auto-report.json"), "utf8"),
);
console.log(`[env] ${JSON.stringify(envReceipt)}`);
appendNdjson(join(ROOT, "runs.ndjson"), { type: "env", ...envReceipt });

const sessionBase = new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14);
const pairs = SMOKE ? 1 : PAIRS;
const records = [];
let seq = 0;
for (let p = 1; p <= pairs; p++) {
  const order = p % 2 === 1 ? ["ON", "OFF"] : ["OFF", "ON"];
  for (const kind of order) {
    seq += 1;
    const rec = await runOne(kind, seq, sessionBase);
    rec.pair = p;
    records.push(rec);
    console.log(
      `[run ${seq}/pair ${p} ${kind}] exit=${rec.exit_code} hook_wall_ms=${rec.hook_wall_ms} stop_to_outbox_ms=${rec.stop_to_outbox_ms} outbox=${rec.outbox?.state ?? (kind === "OFF" ? (rec.absence_witnessed ? "ABSENT_WITNESSED" : "UNEXPECTED!") : "MISSING!")}`,
    );
    appendNdjson(join(ROOT, "runs.ndjson"), { type: "run", ...rec });
  }
}

const summary = {
  env: envReceipt,
  pairs,
  order_plan: Array.from({ length: pairs }, (_, i) =>
    i % 2 === 0 ? ["ON", "OFF"] : ["OFF", "ON"],
  ),
  ON: summarize(records, "ON"),
  OFF: summarize(records, "OFF"),
  finished_at: new Date().toISOString(),
};
writeFileSync(join(ROOT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[summary] ${JSON.stringify({ ON: summary.ON, OFF: summary.OFF }, null, 2)}`);

function appendNdjson(file, obj) {
  appendFileSync(file, `${JSON.stringify(obj)}\n`);
}
