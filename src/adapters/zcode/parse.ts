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
  toolCalls: { id: string; name: string }[];
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
    const toolCalls: { id: string; name: string }[] = [];
    if (Array.isArray(resp.toolCalls)) {
      for (const tc of resp.toolCalls) {
        if (!isObj(tc)) continue;
        const id = str(tc.id);
        const name = str(tc.name);
        if (id && name) toolCalls.push({ id, name });
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
