// task-meta capture hook for Codex (ChatGPT desktop): metadata-only, append-only, never blocks.
// Node built-ins only (CommonJS so a `node -e require(...)` launcher is shell-independent).
// Reads the Codex hook input as JSON on stdin, appends ONE line
// `{"d":"<sha256 hex of RFC8785 JCS(e)>","e":e}` to <spool>/<sessionId>.jsonl, prints nothing,
// and ALWAYS exits 0. On failure only an error class name is logged to <spool>/_errors.log.
"use strict";
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { appendFileSync, mkdirSync, readFileSync, statSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

const PLUGIN_VERSION = "0.1.0";
const SCHEMA = "task-meta/codex-hook/v1";
const EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
  "Interrupt",
  "SubagentStart",
  "SubagentStop",
]);
const SESSION_SOURCES = new Set(["startup", "resume", "clear", "compact", "fork"]);
const GIT_EVENTS = new Set(["SessionStart", "Stop", "SessionEnd"]);

// ---- RFC 8785 JCS (keys by UTF-16 code units; JSON.stringify for strings/numbers) ----
function jcs(v) {
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

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ---- shell command class (fixed enum; the command text is dropped) ----
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

function classifyCommand(cmd) {
  const segments = cmd.split(/&&|;|\r?\n/).map((x) => x.trim());
  let seg = "";
  for (const s of segments) {
    if (s === "") continue;
    if (/^(cd|pushd|export|set)(\s|$)/.test(s)) continue;
    seg = s;
    break;
  }
  if (seg === "") return "OTHER";
  const head = (seg.split(/\|\|?/)[0] || "").trim();
  const tokens = head.split(/\s+/).filter((t) => t !== "");
  for (;;) {
    const t = tokens[0];
    if (t === undefined) return "OTHER";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || t === "rtk" || t === "env") tokens.shift();
    else if (t === "timeout" && /^\d+[smh]?$/.test(tokens[1] || "")) tokens.splice(0, 2);
    else break;
  }
  const first = (tokens[0] || "").replace(/^.*[/]/, "").replace(/\.exe$/i, "");
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

// ---- helpers ----
function wellFormed(s) {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** A bounded, well-formed string, else null. */
function bounded(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max && wellFormed(v) ? v : null;
}

/** A short identifier-like token (enum-ish); any other non-empty string becomes "OTHER". */
function token(v, max) {
  if (typeof v !== "string" || v === "") return null;
  return v.length <= max && /^[A-Za-z0-9_.:-]+$/.test(v) ? v : "OTHER";
}

function sanitizeSessionId(id) {
  if (typeof id !== "string" || id === "") return null;
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
}

function byteLength(v) {
  if (typeof v === "string") return Buffer.byteLength(v, "utf8");
  if (v === undefined || v === null) return null;
  try {
    return Buffer.byteLength(JSON.stringify(v), "utf8");
  } catch {
    return null;
  }
}

/** Integer exit code of a tool response when it exposes one; the response itself is dropped. */
function exitCodeOf(resp) {
  if (typeof resp !== "object" || resp === null) return null;
  for (const k of ["exit_code", "exitCode"]) {
    const n = resp[k];
    if (Number.isSafeInteger(n)) return n;
  }
  const meta = resp.metadata;
  if (typeof meta === "object" && meta !== null && Number.isSafeInteger(meta.exit_code)) {
    return meta.exit_code;
  }
  return null;
}

function commandOf(toolInput) {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const c = toolInput.command;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.every((x) => typeof x === "string")) {
    const i = c.findIndex((x) => x === "-c" || x === "-lc");
    return i >= 0 && c[i + 1] !== undefined ? c[i + 1] : c.join(" ");
  }
  return null;
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 2000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** git HEAD / dirty / `owner/name` of the session cwd; any failure yields nulls. */
function gitFacts(cwd) {
  const out = { git_head: null, git_dirty: null, git_remote_repo: null };
  if (typeof cwd !== "string" || cwd === "") return out;
  try {
    if (!statSync(cwd).isDirectory()) return out;
  } catch {
    return out;
  }
  try {
    const head = git(cwd, ["rev-parse", "HEAD"]).trim();
    if (/^[0-9a-f]{40}$/.test(head)) out.git_head = head;
  } catch {
    return out;
  }
  try {
    out.git_dirty = git(cwd, ["status", "--porcelain"]).trim() !== "";
  } catch {
    // dirty state unknown
  }
  try {
    const url = git(cwd, ["config", "--get", "remote.origin.url"]).trim();
    const m = /[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
    if (m) out.git_remote_repo = `${m[1]}/${m[2]}`;
  } catch {
    // no remote
  }
  return out;
}

/** Returns the metadata-only entry, or throws a named error. Never copies content fields. */
function buildEntry(input, now = new Date(), gitProbe = gitFacts) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("input not an object");
  }
  const event = input.hook_event_name;
  if (!EVENTS.has(event)) throw new RangeError("unsupported event");
  const sessionId = bounded(input.session_id, 200);
  if (sanitizeSessionId(sessionId) === null) throw new RangeError("missing session id");
  const e = {
    schema: SCHEMA,
    plugin_version: PLUGIN_VERSION,
    agent: "codex",
    event,
    session_id: sessionId,
    turn_id: bounded(input.turn_id, 200),
    tool_call_id: bounded(input.tool_use_id, 200),
    tool_name: bounded(input.tool_name, 128),
    received_at: now.toISOString(),
    mode: bounded(input.permission_mode, 32),
    model: bounded(input.model, 128),
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
    cwd_digest: typeof input.cwd === "string" && input.cwd !== "" ? sha256Hex(input.cwd) : null,
    has_transcript: typeof input.transcript_path === "string" && input.transcript_path !== "",
  };
  if (event === "PreToolUse" || event === "PostToolUse") {
    const cmd = commandOf(input.tool_input);
    if (cmd !== null) e.input_class = classifyCommand(cmd);
  }
  if (event === "PostToolUse") {
    e.exit_code = exitCodeOf(input.tool_response);
    const isError =
      typeof input.tool_response === "object" &&
      input.tool_response !== null &&
      input.tool_response.isError === true;
    e.outcome = isError || (e.exit_code !== null && e.exit_code !== 0) ? "failure" : "success";
    e.result_bytes = byteLength(input.tool_response);
  } else if (event === "Interrupt") {
    e.outcome = "interrupt";
  } else if (event === "SessionStart") {
    const src = input.source;
    e.session_source = typeof src === "string" ? (SESSION_SOURCES.has(src) ? src : "OTHER") : null;
  } else if (event === "UserPromptSubmit") {
    e.prompt_bytes = byteLength(input.prompt);
  } else if (event === "Stop") {
    e.message_bytes = byteLength(input.last_assistant_message);
  } else if (event === "SessionEnd") {
    e.end_reason = token(input.reason, 32);
  }
  if (GIT_EVENTS.has(event)) Object.assign(e, gitProbe(input.cwd));
  return e;
}

function spoolDir() {
  return process.env.TASK_META_CODEX_SPOOL || join(homedir(), ".task-meta", "codex-spool");
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

function capture(raw) {
  const dir = spoolDir();
  try {
    const e = buildEntry(JSON.parse(raw));
    const line = `{"d":"${sha256Hex(jcs(e))}","e":${jcs(e)}}\n`;
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${sanitizeSessionId(e.session_id)}.jsonl`), line);
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

module.exports = {
  PLUGIN_VERSION,
  SCHEMA,
  jcs,
  sha256Hex,
  classifyCommand,
  buildEntry,
  sanitizeSessionId,
  spoolDir,
  capture,
  main,
};
