// task-meta capture hook: metadata-only, append-only, never blocks the agent.
// Node built-ins only. Reads the ZCode hook input as JSON on stdin, appends ONE line
// `{"d":"<sha256 hex of RFC8785 JCS(e)>","e":e}` to <spool>/<sessionId>.jsonl, prints nothing,
// and ALWAYS exits 0. On failure only an error class name is logged to <spool>/_errors.log.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_VERSION = "0.1.1";
export const SCHEMA = "task-meta/zcode-hook/v1";
const EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
]);
const SESSION_SOURCES = new Set(["startup", "resume", "clear", "compact"]);

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

// ---- entry construction (allowlist only) ----
function wellFormed(s) {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** A bounded, well-formed string, else null. */
function bounded(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max && wellFormed(v) ? v : null;
}

function pick(input, camel, snake) {
  return input[camel] !== undefined ? input[camel] : input[snake];
}

function errorType(v) {
  if (typeof v !== "string" || v === "") return null;
  return v.length <= 64 && /^[A-Za-z0-9_.:-]+$/.test(v) ? v : "OTHER";
}

export function sanitizeSessionId(id) {
  if (typeof id !== "string" || id === "") return null;
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
}

/** Returns the metadata-only entry, or throws a named error. Never copies content fields. */
export function buildEntry(input, now = new Date()) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("input not an object");
  }
  const event = pick(input, "hookEventName", "hook_event_name");
  if (!EVENTS.has(event)) throw new RangeError("unsupported event");
  const sessionId = bounded(pick(input, "sessionId", "session_id"), 200);
  if (sanitizeSessionId(sessionId) === null) throw new RangeError("missing session id");
  const toolName = bounded(pick(input, "toolName", "tool_name"), 128);
  const toolInput = pick(input, "toolInput", "tool_input");
  const e = {
    schema: SCHEMA,
    plugin_version: PLUGIN_VERSION,
    event,
    session_id: sessionId,
    turn_id: bounded(pick(input, "turnId", "turn_id"), 200),
    trace_id: bounded(pick(input, "traceId", "trace_id"), 200),
    agent_name: bounded(pick(input, "agentName", "agent_type"), 64),
    tool_call_id: bounded(pick(input, "toolCallId", "tool_use_id"), 200),
    tool_name: toolName,
    hook_ts: bounded(input.timestamp, 64),
    received_at: now.toISOString(),
    mode: bounded(pick(input, "mode", "permission_mode"), 32),
    input_class: null,
    outcome: null,
    error_type: null,
    result_bytes: null,
    tool_call_count: null,
    session_source: null,
    model: null,
    prompt_bytes: null,
    cwd_digest: typeof input.cwd === "string" && input.cwd !== "" ? sha256Hex(input.cwd) : null,
  };
  if (
    (event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure") &&
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
    const prev = pick(input, "toolResultPreview", "tool_result_preview");
    if (typeof prev === "string") e.result_bytes = Buffer.byteLength(prev, "utf8");
  } else if (event === "PostToolUseFailure") {
    const interrupt = pick(input, "isInterrupt", "is_interrupt") === true;
    e.outcome = interrupt ? "interrupt" : "failure";
    const err = input.error;
    e.error_type = errorType(
      typeof err === "object" && err !== null ? err.type : input.error_details?.type,
    );
  } else if (event === "Stop") {
    const n = pick(input, "toolCallCount", "tool_call_count");
    e.tool_call_count = Number.isSafeInteger(n) && n >= 0 ? n : null;
  } else if (event === "SessionStart") {
    const src = input.source;
    e.session_source = typeof src === "string" ? (SESSION_SOURCES.has(src) ? src : "OTHER") : null;
    e.model = bounded(input.model, 128);
  } else if (event === "UserPromptSubmit") {
    if (typeof input.prompt === "string") e.prompt_bytes = Buffer.byteLength(input.prompt, "utf8");
  }
  return e;
}

export function spoolDir() {
  return process.env.TASK_META_ZCODE_SPOOL || join(homedir(), ".task-meta", "zcode-spool");
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

export function capture(raw) {
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

try {
  if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    main();
  }
} catch {
  // never throw
}
process.exitCode = 0;
