// task-meta capture hook for Claude Code: metadata-only, append-only, never blocks the agent.
// Node built-ins only. Reads the Claude Code hook input as JSON on stdin, appends ONE line
// `{"d":"<sha256 hex of RFC8785 JCS(e)>","e":e}` to <spool>/<sessionId>.jsonl, prints nothing,
// and ALWAYS exits 0. On failure only an error class name is logged to <spool>/_errors.log.
//
// Never stored: prompt text, tool input/response, error text, last_assistant_message,
// transcript_path, cwd (digest only), session_title, notification text.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRefs, parseWorktreeName } from "./lib/binding-extract.mjs";
import { gitInfo } from "./lib/git-meta.mjs";

export const PLUGIN_VERSION = "0.2.2";
const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BINDING_REFS = 32;
export const SCHEMA = "task-meta/claude-hook/v1";
const EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStop",
  "SessionEnd",
  "PreCompact",
  "Notification",
]);
const SESSION_SOURCES = new Set(["startup", "resume", "clear", "compact", "fork"]);
const END_REASONS = new Set(["clear", "resume", "logout", "prompt_input_exit", "other"]);
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

// ---- RFC 8785 JCS (keys by UTF-16 code units; JSON.stringify for strings/numbers) ----
export function jcs(v) {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError("non-finite");
      return JSON.stringify(v);
    case "string":
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
      return `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`)
        .join(",")}}`;
    }
    default:
      throw new TypeError("unsupported");
  }
}

export function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ---- Bash command class (copy of classifyCommand in src/adapters/zcode/parse.ts) ----
const READ_CMDS = new Set(["cat", "head", "tail", "less", "ls", "find", "grep", "rg", "wc", "awk"]);
const WRITE_CMDS = new Set(["mkdir", "cp", "mv", "rm", "tee", "touch"]);
const LINT_CMDS = new Set(["tsc", "biome", "eslint"]);

function classifyNpmRun(script) {
  if (!script) return "OTHER";
  if (script === "test" || script.startsWith("test:")) return "TEST";
  if (script === "typecheck" || script === "lint") return "TYPECHECK_LINT";
  if (script === "build" || script.startsWith("build:")) return "BUILD";
  return "OTHER";
}

function hasFileRedirect(seg) {
  return /(?:^|[^0-9&>-])>{1,2}\s*(?!&|\/dev\/null\b)\S/.test(seg);
}

export function classifyCommand(cmd) {
  const segments = cmd.split(/&&|;|\r?\n/).map((x) => x.trim());
  let seg = "";
  for (const s of segments) {
    if (s === "") continue;
    if (/^(cd|pushd|export|set)(\s|$)/.test(s)) continue;
    seg = s;
    break;
  }
  if (seg === "") return "OTHER";
  const head = seg.split(/\|\|?/)[0]?.trim() ?? "";
  const tokens = head.split(/\s+/).filter((t) => t !== "");
  for (;;) {
    const t = tokens[0];
    if (t === undefined) return "OTHER";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || t === "rtk" || t === "env") tokens.shift();
    else if (t === "timeout" && /^\d+[smh]?$/.test(tokens[1] ?? "")) tokens.splice(0, 2);
    else break;
  }
  const first = (tokens[0] ?? "").replace(/^.*[/]/, "").replace(/\.exe$/i, "");
  const rest = tokens.slice(1);
  const r0 = rest[0];
  const redirect = hasFileRedirect(head);
  let cls = "OTHER";
  if (first === "bash" || first === "sh") {
    const script = rest.find((a) => !a.startsWith("-"));
    if (r0 === "-c" || r0 === "-lc") cls = "OTHER";
    else if (script && /(^|[/])task-check\.sh$/.test(script)) cls = "TEST";
  } else if (first === "git" || first === "gh") {
    cls = "VCS";
  } else if (first === "npm" || first === "pnpm") {
    if (r0 === "test" || r0 === "t") cls = "TEST";
    else if (r0 === "run" || r0 === "run-script") cls = classifyNpmRun(rest[1]);
    else if (r0 === "ci" || r0 === "install" || r0 === "i" || r0 === "add") cls = "DEPENDENCY";
    else if (first === "pnpm") cls = classifyNpmRun(r0);
  } else if (first === "npx") {
    if (r0 === "vitest" || r0 === "jest") cls = "TEST";
    else if (r0 !== undefined && LINT_CMDS.has(r0)) cls = "TYPECHECK_LINT";
  } else if (first === "node") {
    if (rest.includes("--test")) cls = "TEST";
  } else if (first === "vitest" || first === "jest" || first === "pytest") {
    cls = "TEST";
  } else if (first === "python" || first === "python3") {
    if (r0 === "-m" && rest[1] === "pytest") cls = "TEST";
  } else if (first === "go") {
    if (r0 === "test") cls = "TEST";
    else if (r0 === "build") cls = "BUILD";
  } else if (first === "cargo") {
    if (r0 === "test") cls = "TEST";
    else if (r0 === "build") cls = "BUILD";
  } else if (first === "make") {
    cls = "BUILD";
  } else if (LINT_CMDS.has(first)) {
    cls = "TYPECHECK_LINT";
  } else if (first === "pip" || first === "pip3") {
    if (r0 === "install") cls = "DEPENDENCY";
  } else if (first === "fnm") {
    cls = "DEPENDENCY";
  } else if (first === "sed") {
    cls = rest.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))
      ? "FILE_WRITE"
      : "READ_SEARCH";
  } else if (READ_CMDS.has(first)) {
    cls = redirect ? "FILE_WRITE" : "READ_SEARCH";
  } else if (WRITE_CMDS.has(first)) {
    cls = "FILE_WRITE";
  } else if (redirect) {
    cls = "FILE_WRITE";
  }
  return cls;
}

// ---- task binding inputs (refs only; the prompt text is examined in memory and dropped) ----
let inventoryCache;
function inventory() {
  if (inventoryCache === undefined) {
    try {
      const j = JSON.parse(readFileSync(join(HERE, "lib", "repo-aliases.json"), "utf8"));
      inventoryCache = { aliases: j.aliases ?? {}, knownRepos: j.repos ?? [] };
    } catch {
      inventoryCache = { aliases: {}, knownRepos: [] };
    }
  }
  return inventoryCache;
}

/** Git facts and name-derived refs for the session cwd; all-null on any failure. */
export function gitFields(cwd) {
  const out = {
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    worktree_refs: null,
  };
  if (typeof cwd !== "string" || cwd === "") return out;
  try {
    const g = gitInfo(cwd);
    out.git_head = g.git_head;
    out.git_dirty = g.git_dirty;
    out.git_remote_repo = g.git_remote_repo;
    const inv = inventory();
    const refs = [];
    for (const r of parseWorktreeName(basename(cwd), inv).refs)
      refs.push({ source: "WORKTREE", ...r });
    if (g.branch !== null) {
      for (const r of parseWorktreeName(g.branch, inv).refs) refs.push({ source: "BRANCH", ...r });
    }
    out.worktree_refs = refs.slice(0, MAX_BINDING_REFS);
  } catch {
    // keep nulls
  }
  return out;
}

// ---- entry construction (allowlist only) ----
function wellFormed(s) {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** A bounded, well-formed string, else null. */
function bounded(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max && wellFormed(v) ? v : null;
}

function duration(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e10 ? Math.round(v) : null;
}

/** Byte size of a tool response (a string or JSON value); the content itself is dropped. */
function responseBytes(v) {
  try {
    if (typeof v === "string") return Buffer.byteLength(v, "utf8");
    if (v === undefined) return null;
    const s = JSON.stringify(v);
    return typeof s === "string" ? Buffer.byteLength(s, "utf8") : null;
  } catch {
    return null;
  }
}

export function sanitizeSessionId(id) {
  if (typeof id !== "string" || id === "") return null;
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
}

/**
 * HEAD and dirty flag with a hard ~0.9 s ceiling: SessionEnd hooks are cut off at 1.5 s by
 * Claude Code, and losing the entry (and the report trigger) would cost more than the heads,
 * which the last Stop entry already carries.
 */
export function quickGit(cwd) {
  const out = { git_head: null, git_dirty: null };
  if (typeof cwd !== "string" || cwd === "") return out;
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      timeout: 450,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
  try {
    const head = run(["rev-parse", "HEAD"]).trim();
    if (/^[0-9a-f]{40}$/.test(head)) out.git_head = head;
  } catch {
    return out;
  }
  try {
    out.git_dirty = run(["status", "--porcelain"]).trim() !== "";
  } catch {
    out.git_dirty = null;
  }
  return out;
}

/** Returns the metadata-only entry, or throws a named error. Never copies content fields. */
export function buildEntry(input, now = new Date(), probe = gitFields, quick = quickGit) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("input not an object");
  }
  const event = input.hook_event_name;
  if (!EVENTS.has(event)) throw new RangeError("unsupported event");
  const sessionId = bounded(input.session_id, 200);
  if (sanitizeSessionId(sessionId) === null) throw new RangeError("missing session id");
  const toolName = bounded(input.tool_name, 128);
  const toolInput = input.tool_input;
  const e = {
    schema: SCHEMA,
    plugin_version: PLUGIN_VERSION,
    agent: "claude",
    event,
    session_id: sessionId,
    agent_id: bounded(input.agent_id, 200),
    tool_call_id: bounded(input.tool_use_id, 200),
    tool_name: toolName,
    received_at: now.toISOString(),
    mode: bounded(input.permission_mode, 32),
    model: null,
    session_source: null,
    input_class: null,
    outcome: null,
    error_type: null,
    duration_ms: null,
    result_bytes: null,
    prompt_bytes: null,
    end_reason: null,
    binding_refs: null,
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    worktree_refs: null,
    cwd_digest: typeof input.cwd === "string" && input.cwd !== "" ? sha256Hex(input.cwd) : null,
  };
  if (
    TOOL_EVENTS.has(event) &&
    toolName !== null &&
    toolName.toLowerCase() === "bash" &&
    typeof toolInput === "object" &&
    toolInput !== null &&
    typeof toolInput.command === "string"
  ) {
    e.input_class = classifyCommand(toolInput.command);
  }
  if (event === "PostToolUse") {
    e.outcome = "success";
    e.duration_ms = duration(input.duration_ms);
    e.result_bytes = responseBytes(input.tool_response);
  } else if (event === "PostToolUseFailure") {
    e.outcome = input.is_interrupt === true ? "interrupt" : "failure";
    e.duration_ms = duration(input.duration_ms);
  } else if (event === "SessionStart") {
    const src = input.source;
    e.session_source = typeof src === "string" ? (SESSION_SOURCES.has(src) ? src : "OTHER") : null;
    e.model = bounded(input.model, 128);
  } else if (event === "SessionEnd") {
    const r = input.reason;
    e.end_reason = typeof r === "string" ? (END_REASONS.has(r) ? r : "OTHER") : null;
  } else if (event === "UserPromptSubmit") {
    if (typeof input.prompt === "string") {
      e.prompt_bytes = Buffer.byteLength(input.prompt, "utf8");
      e.binding_refs = extractRefs(input.prompt, inventory()).refs.slice(0, MAX_BINDING_REFS);
    }
  }
  if (event === "SessionStart" || event === "Stop") Object.assign(e, probe(input.cwd));
  else if (event === "SessionEnd") Object.assign(e, quick(input.cwd));
  return e;
}

export function spoolDir() {
  return process.env.TASK_META_CLAUDE_SPOOL || join(homedir(), ".task-meta", "claude-spool");
}

function logError(dir, err) {
  try {
    const name =
      typeof err?.name === "string" && /^[A-Za-z0-9_]{1,64}$/.test(err.name) ? err.name : "Error";
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "_errors.log"), `${new Date().toISOString()} ${name}\n`);
  } catch {
    // Nothing more can be done; never fail the agent.
  }
}

function namedError(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}

/** Path of the task-meta CLI from env TASK_META_HOME or plugin-local config.json, else null. */
export function taskMetaCli() {
  let home = process.env.TASK_META_HOME;
  if (!home) {
    try {
      const c = JSON.parse(readFileSync(join(HERE, "..", "config.json"), "utf8"));
      // "~" = the user home, so the shipped default is host-independent.
      if (typeof c.taskMetaHome === "string") {
        home = c.taskMetaHome.replace(/^~(?=$|[\\/])/, homedir());
      }
    } catch {
      // no config
    }
  }
  return home ? { home, cli: join(home, "src", "cli.ts") } : null;
}

/** Start `task-meta auto-report --agent claude` detached; returns immediately. Never throws. */
function triggerAutoReport(sessionId, dir, trigger) {
  try {
    if (process.env.TASK_META_AUTO_REPORT === "0") return;
    if (sessionId.startsWith("-")) return;
    const t = taskMetaCli();
    if (t === null || !existsSync(t.cli)) {
      logError(dir, namedError("AutoReportCliMissing"));
      return;
    }
    const child = spawn(
      process.execPath,
      [t.cli, "auto-report", "--agent", "claude", "--session", sessionId, "--trigger", trigger],
      { cwd: t.home, detached: true, stdio: "ignore", windowsHide: true },
    );
    child.on("error", () => {});
    child.unref();
  } catch (err) {
    logError(dir, err);
  }
}

export function capture(raw) {
  const dir = spoolDir();
  try {
    const e = buildEntry(JSON.parse(raw));
    const line = `{"d":"${sha256Hex(jcs(e))}","e":${jcs(e)}}\n`;
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${sanitizeSessionId(e.session_id)}.jsonl`), line);
    if (e.event === "Stop") triggerAutoReport(e.session_id, dir, "stop");
    else if (e.event === "SessionEnd") triggerAutoReport(e.session_id, dir, "session-end");
  } catch (err) {
    logError(dir, err);
  }
}

function main() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    // no stdin
  }
  capture(raw);
}

try {
  if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    main();
  }
} catch {
  // never throw
}
process.exitCode = 0;
