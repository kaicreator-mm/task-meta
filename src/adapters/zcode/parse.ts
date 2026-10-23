// Allowlist-copy parsers for ZCode run artifacts. Anything not explicitly copied
// (prompts, response text, headers, tool input, providerMetadata, paths) is dropped here.
import type { VerifierOutcome } from "../../model.ts";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export interface HeadlessUsage {
  modelRequestCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
}

export interface HeadlessResult {
  sessionId: string;
  traceId: string | null;
  turnId: string | null;
  usage: HeadlessUsage;
  eventCount: number | null;
}

/** Parse `zcode --json` stdout; leading non-JSON lines are skipped. Never keeps response/projection. */
export function parseHeadlessResult(text: string): HeadlessResult | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("{"));
  if (start < 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(lines.slice(start).join("\n"));
  } catch {
    return null;
  }
  if (!isObj(obj)) return null;
  const sessionId = str(obj.sessionId);
  if (!sessionId) return null;
  const u = isObj(obj.usage) ? obj.usage : {};
  return {
    sessionId,
    traceId: str(obj.traceId),
    turnId: str(obj.turnId),
    usage: {
      modelRequestCount: num(u.modelRequestCount),
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      totalTokens: num(u.totalTokens),
      cacheReadTokens: num(u.cacheReadTokens),
      cacheWriteTokens: num(u.cacheWriteTokens),
      reasoningTokens: num(u.reasoningTokens),
    },
    eventCount: num(obj.eventCount),
  };
}

export type CommandClass =
  | "TEST"
  | "TYPECHECK_LINT"
  | "BUILD"
  | "DEPENDENCY"
  | "VCS"
  | "READ_SEARCH"
  | "FILE_WRITE"
  | "OTHER";

const READ_CMDS = new Set(["cat", "head", "tail", "less", "ls", "find", "grep", "rg", "wc", "awk"]);
const WRITE_CMDS = new Set(["mkdir", "cp", "mv", "rm", "tee", "touch"]);
const LINT_CMDS = new Set(["tsc", "biome", "eslint"]);

function classifyNpmRun(script: string | undefined): CommandClass {
  if (!script) return "OTHER";
  if (script === "test" || script.startsWith("test:")) return "TEST";
  if (script === "typecheck" || script === "lint") return "TYPECHECK_LINT";
  if (script === "build" || script.startsWith("build:")) return "BUILD";
  return "OTHER";
}

function hasFileRedirect(seg: string): boolean {
  // `>` / `>>` to something other than an fd dup (`2>&1`) or /dev/null.
  return /(?:^|[^0-9&>-])>{1,2}\s*(?!&|\/dev\/null\b)\S/.test(seg);
}

/**
 * Privacy-safe class of a shell command, by the FIRST command of the line only.
 * Pure; returns a fixed enum value and never any part of the command text.
 * `bash -c "..."` is not parsed and yields OTHER.
 */
export function classifyCommand(cmd: string): CommandClass {
  const segments = cmd.split(/&&|;|\r?\n/).map((x) => x.trim());
  let seg = "";
  for (const s of segments) {
    if (s === "") continue;
    if (/^(cd|pushd|export|set)(\s|$)/.test(s)) continue;
    seg = s;
    break;
  }
  if (seg === "") return "OTHER";
  // Only the head of a pipeline decides the class (`||` already left-trimmed by the split).
  const head = seg.split(/\|\|?/)[0]?.trim() ?? "";
  const tokens = head.split(/\s+/).filter((t) => t !== "");
  // Leading env assignments, `rtk` proxy and `timeout <n>` wrappers.
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
  let cls: CommandClass = "OTHER";
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

export interface ModelIoUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export interface ModelIoRecord {
  sessionId: string;
  traceId: string | null;
  turnId: string | null;
  requestId: string;
  attempt: number;
  querySource: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  modelId: string | null;
  providerId: string | null;
  finishReason: string | null;
  usage: ModelIoUsage;
  toolCalls: { id: string; name: string; inputClass?: string }[];
}

export interface ModelIoParse {
  records: ModelIoRecord[];
  rejected: { line: number; reason: string }[];
}

export function parseModelIo(text: string): ModelIoParse {
  const records: ModelIoRecord[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    if (raw.trim() === "") return;
    const line = idx + 1;
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      rejected.push({ line, reason: "malformed JSON" });
      return;
    }
    if (!isObj(obj) || obj.type !== "model_io") {
      rejected.push({ line, reason: "not a model_io record" });
      return;
    }
    const sessionId = str(obj.sessionId);
    const requestId = str(obj.requestId);
    const attempt = obj.attempt;
    if (!sessionId || !requestId) {
      rejected.push({ line, reason: "missing sessionId or requestId" });
      return;
    }
    if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) {
      rejected.push({ line, reason: "invalid attempt" });
      return;
    }
    const model = isObj(obj.model) ? obj.model : {};
    const resp = isObj(obj.response) ? obj.response : {};
    const usage = isObj(resp.usage) ? resp.usage : {};
    const toolCalls: { id: string; name: string; inputClass?: string }[] = [];
    if (Array.isArray(resp.toolCalls)) {
      for (const tc of resp.toolCalls) {
        if (!isObj(tc)) continue;
        const id = str(tc.id);
        const name = str(tc.name);
        if (!id || !name) continue;
        // Only the fixed-enum class of a Bash command survives; the command text is dropped here.
        const cmd = isObj(tc.input) ? tc.input.command : undefined;
        if (name.toLowerCase() === "bash" && typeof cmd === "string") {
          toolCalls.push({ id, name, inputClass: classifyCommand(cmd) });
        } else {
          toolCalls.push({ id, name });
        }
      }
    }
    records.push({
      sessionId,
      traceId: str(obj.traceId),
      turnId: str(obj.turnId),
      requestId,
      attempt,
      querySource: str(obj.querySource),
      startedAt: str(obj.startedAt),
      completedAt: str(obj.completedAt),
      durationMs: num(obj.durationMs),
      modelId: str(model.modelId),
      providerId: str(model.providerId),
      finishReason: str(resp.finishReason),
      usage: {
        inputTokens: num(usage.inputTokens),
        outputTokens: num(usage.outputTokens),
        totalTokens: num(usage.totalTokens),
        cacheReadTokens: num(usage.cacheReadTokens),
        cacheWriteTokens: num(usage.cacheWriteTokens),
      },
      toolCalls,
    });
  });
  return { records, rejected };
}

export interface RunRecord {
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  head_before: string | null;
  head_after: string | null;
}

function toUtcIso(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Parse dispatch `run.txt`. Worktree/brief paths are never retained. */
export function parseRunRecord(text: string): RunRecord {
  const rec: RunRecord = {
    started_at: null,
    finished_at: null,
    exit_code: null,
    head_before: null,
    head_after: null,
  };
  for (const line of text.split(/\r?\n/)) {
    const started = /(?:^|\s)started=(\S+)/.exec(line);
    if (started) rec.started_at = toUtcIso(started[1]);
    const exit = /(?:^|\s)exit=(\d+)(?:\s|$)/.exec(line);
    if (exit) rec.exit_code = Number(exit[1]);
    const fin = /(?:^|\s)finished=(\S+)/.exec(line);
    if (fin) rec.finished_at = toUtcIso(fin[1]);
    const hb = /^head_before=([0-9a-f]{40})\s*$/.exec(line.trim());
    if (hb) rec.head_before = hb[1] ?? null;
    const ha = /^head_after=([0-9a-f]{40})\s*$/.exec(line.trim());
    if (ha) rec.head_after = ha[1] ?? null;
  }
  return rec;
}

export interface GateParse {
  outcome: VerifierOutcome;
  exitCode: number | null;
  greenMarker: boolean;
}

/** Verifier outcome from the LAST `EXIT=<n>` line of a task-check gate log. */
export function parseGateLog(text: string, subjectSha: string | null): GateParse {
  let exitCode: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^EXIT=(\d+)\s*$/.exec(line);
    if (m) exitCode = Number(m[1]);
  }
  const greenMarker = text.includes("task-check: 全绿");
  const base = {
    subject_sha: subjectSha,
    checked: [] as string[],
    failed: [] as string[],
    skipped: [] as string[],
    unchecked: ["task-acceptance"],
    source_refs: subjectSha ? [`task-check:${subjectSha}`] : [],
  };
  if (!subjectSha) {
    return {
      outcome: {
        ...base,
        status: "UNKNOWN",
        coverage: "UNKNOWN",
        epistemic: "UNKNOWN",
        source_refs: [],
      },
      exitCode,
      greenMarker,
    };
  }
  if (exitCode === null) {
    return {
      outcome: {
        ...base,
        status: "NOT_RUN",
        coverage: "UNKNOWN",
        epistemic: "UNKNOWN",
        source_refs: [],
      },
      exitCode,
      greenMarker,
    };
  }
  if (exitCode === 0) {
    return {
      outcome: {
        ...base,
        status: "PASS",
        checked: ["task-check:lint", "task-check:typecheck", "task-check:test"],
        coverage: "PARTIAL",
        epistemic: "OBSERVED",
      },
      exitCode,
      greenMarker,
    };
  }
  return {
    outcome: {
      ...base,
      status: "FAIL",
      failed: ["task-check"],
      coverage: "PARTIAL",
      epistemic: "OBSERVED",
    },
    exitCode,
    greenMarker,
  };
}
