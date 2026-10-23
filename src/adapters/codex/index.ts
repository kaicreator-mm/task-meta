import { canonicalDigest } from "../../canonical.ts";
import { dedupeObservations, latestRevisions, unionIntervalMs } from "../../correlate.ts";
import type {
  ActorRef,
  AttemptSummary,
  Coverage,
  Epistemic,
  MetricIdentity,
  MetricValue,
  ObservationRecord,
  SourceCapabilityProfile,
  TokenUsage,
  VerifierOutcome,
} from "../../model.ts";
import type { RunRecord } from "../zcode/parse.ts";
import { CODEX_CAPABILITY, codexCapabilityWithHooks } from "./capability.ts";
import { analyzeCodexHooks, type CodexHookAnalysis, parseCodexHookSpool } from "./hooks.ts";
import {
  type CodexItem,
  type CodexParse,
  type CodexTokenCount,
  type CodexUsage,
  type CodexUsageRecord,
  parseCodexRollout,
} from "./parse.ts";

export { CODEX_CAPABILITY } from "./capability.ts";
export { parseCodexRollout } from "./parse.ts";

export interface CodexRunInput {
  repository: string;
  issue_number: number;
  actor: ActorRef;
  observed_at: string;
  /** Session rollout JSONL text; several texts = the files of one (continued) thread. */
  rollout: string | string[];
  /** Contents of the task-meta-capture Codex hook spool for this session (`<sessionId>.jsonl`). */
  hookSpool?: string;
}

export interface CodexCollection {
  profile: SourceCapabilityProfile;
  observations: ObservationRecord[];
  summary: AttemptSummary;
  rejected: { line: number; reason: string }[];
  limits: string[];
  sessionId: string;
  /** Synthetic single run segment for lineage (start/end of the session, git heads). */
  run: RunRecord;
}

const ADAPTER = "codex";

const NOT_RUN: VerifierOutcome = {
  status: "NOT_RUN",
  subject_sha: null,
  checked: [],
  failed: [],
  skipped: [],
  unchecked: [],
  coverage: "UNKNOWN",
  epistemic: "UNKNOWN",
  source_refs: [],
};

function skeleton(
  sourceEventId: string,
  kind: ObservationRecord["kind"],
  taskRef: string,
  runRef: string,
): ObservationRecord {
  return {
    observation_id: `${ADAPTER}:${sourceEventId}`,
    source_event_id: sourceEventId,
    source_revision: 1,
    adapter_id: ADAPTER,
    kind,
    task_ref: taskRef,
    run_ref: runRef,
    attempt_ref: runRef,
    step_ref: null,
    parent_ref: null,
    logical_call_ref: null,
    physical_attempt_ref: null,
    started_at: null,
    completed_at: null,
    duration_ms: null,
    model: null,
    tool: null,
    usage: null,
    status: null,
    fields_epistemic: {},
    privacy_class: "PROJECT_PRIVATE",
  };
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const isoMs = (s: string | null): number | null => {
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

// ---- token usage: per-response deltas (preferred) or deltas derived from cumulative totals ----

interface UsageRow {
  responseId: string;
  turnId: string | null;
  ts: string | null;
  usage: CodexUsage;
  threadTotal: CodexUsage | null;
  /** DELTA = counter delta reported by the source; DIFFERENCED = derived from cumulative totals. */
  derivation: "DELTA" | "DIFFERENCED";
}

const NULL_USAGE: CodexUsage = {
  input: null,
  cachedInput: null,
  cacheWrite: null,
  output: null,
  reasoning: null,
  total: null,
};

function diffUsage(cur: CodexUsage, prev: CodexUsage): CodexUsage {
  const d = (a: number | null, b: number | null): number | null =>
    a === null || b === null || a < b ? null : a - b;
  return {
    input: d(cur.input, prev.input),
    cachedInput: d(cur.cachedInput, prev.cachedInput),
    cacheWrite: d(cur.cacheWrite, prev.cacheWrite),
    output: d(cur.output, prev.output),
    reasoning: d(cur.reasoning, prev.reasoning),
    total: d(cur.total, prev.total),
  };
}

const sameUsage = (a: CodexUsage, b: CodexUsage): boolean =>
  canonicalDigest(a) === canonicalDigest(b);

/** token_count fallback: `last_token_usage` is a delta; otherwise difference the running totals. */
function rowsFromTokenCounts(
  counts: CodexTokenCount[],
  baselineKnownZero: boolean,
): { rows: UsageRow[]; repeats: number } {
  const rows: UsageRow[] = [];
  let prevTotal: CodexUsage | null = baselineKnownZero
    ? { ...NULL_USAGE, input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 }
    : null;
  let repeats = 0;
  let lastSeen: CodexUsage | null = null;
  for (const c of counts) {
    if (c.total !== null && lastSeen !== null && sameUsage(c.total, lastSeen)) {
      repeats += 1; // a repeated cumulative reading: no new tokens
      continue;
    }
    if (c.total !== null) lastSeen = c.total;
    let usage: CodexUsage;
    let derivation: UsageRow["derivation"];
    if (c.last !== null) {
      usage = c.last;
      derivation = "DELTA";
    } else if (c.total !== null && prevTotal !== null) {
      usage = diffUsage(c.total, prevTotal);
      derivation = "DIFFERENCED";
    } else {
      usage = { ...NULL_USAGE };
      derivation = "DIFFERENCED";
    }
    if (c.total !== null) prevTotal = c.total;
    const key = canonicalDigest({ t: c.total, l: c.last }).slice(0, 16);
    rows.push({
      responseId: `tc-${key}`,
      turnId: c.turnId,
      ts: c.ts,
      usage,
      threadTotal: c.total,
      derivation,
    });
  }
  return { rows, repeats };
}

function modelRequestObservation(
  r: UsageRow,
  model: { provider: string | null; id: string | null },
  taskRef: string,
  runRef: string,
): ObservationRecord {
  const o = skeleton(r.responseId, "MODEL_REQUEST", taskRef, runRef);
  o.step_ref = r.turnId;
  o.logical_call_ref = r.responseId;
  o.physical_attempt_ref = r.responseId;
  // The rollout has no request start; the usage line is written when the response completes.
  o.completed_at = r.ts;
  o.model = { provider_id: model.provider, model_id: model.id };
  const usage: TokenUsage = {
    input_tokens: r.usage.input,
    output_tokens: r.usage.output,
    cache_read_tokens: r.usage.cachedInput,
    cache_write_tokens: r.usage.cacheWrite,
    reasoning_tokens: r.usage.reasoning,
    total_tokens: r.usage.total,
  };
  o.usage = usage;
  const fe: Record<string, Epistemic> = {};
  if (o.step_ref) fe.step_ref = "OBSERVED";
  if (o.completed_at) fe.completed_at = "INFERRED";
  if (model.id || model.provider) fe.model = model.id ? "OBSERVED" : "INFERRED";
  for (const [k, v] of Object.entries(usage)) {
    if (v !== null) fe[`usage.${k}`] = "OBSERVED";
  }
  o.fields_epistemic = fe;
  return o;
}

function sumField(
  recs: ObservationRecord[],
  pick: (u: TokenUsage) => number | null,
): { value: number | null; partial: boolean } {
  let sum = 0;
  let any = false;
  let missing = false;
  for (const r of recs) {
    const v = r.usage ? pick(r.usage) : null;
    if (v === null) missing = true;
    else {
      sum += v;
      any = true;
    }
  }
  return { value: any ? sum : null, partial: any && missing };
}

function metric(
  name: string,
  value: number | null,
  unit: string,
  epistemic: Epistemic,
  coverage: Coverage,
  source_refs: string[],
): MetricValue {
  if (value === null) {
    return { name, value: null, unit, epistemic: "UNKNOWN", coverage: "UNKNOWN", source_refs: [] };
  }
  return { name, value, unit, epistemic, coverage, source_refs };
}

interface Ctx {
  observation_id: string;
  window_id: string;
  kind: MetricIdentity["measurement_kind"];
}

function windowId(sid: string, starts: Array<number | null>, ends: Array<number | null>): string {
  const s = starts.filter((x): x is number => x !== null);
  const e = ends.filter((x): x is number => x !== null);
  if (s.length === 0 || e.length === 0) return `codex:window:${sid}:unknown`;
  return `codex:window:${sid}:${new Date(Math.min(...s)).toISOString()}/${new Date(Math.max(...e)).toISOString()}`;
}

function identityFor(
  sid: string,
  m: MetricValue,
  ctx: Ctx | undefined,
  revision: number,
): MetricIdentity {
  const known = m.value !== null && ctx !== undefined;
  return {
    metric_id: `task-meta:${sid}:${m.name}`,
    observation_id: known ? ctx.observation_id : `codex:unobserved:${sid}`,
    logical_call_ref: `codex:attempt:${sid}`,
    physical_attempt_ref: `codex:attempt:${sid}`,
    adapter_id: ADAPTER,
    provider_run_ref: null,
    measurement_kind: known ? ctx.kind : "UNKNOWN",
    window_id: known ? ctx.window_id : `codex:window:${sid}:unknown`,
    source_revision: known ? revision : 1,
  };
}

function failed(i: CodexItem): boolean {
  if (i.exitCode !== null) return i.exitCode !== 0;
  if (i.isError !== null) return i.isError;
  return i.status === "failed";
}

export function collectCodexRun(input: CodexRunInput): CodexCollection {
  const texts = Array.isArray(input.rollout) ? input.rollout : [input.rollout];
  const parsedAll: CodexParse[] = texts.map((t) => parseCodexRollout(t));
  const first = parsedAll.find((p) => p.session !== null);
  const meta = first?.session ?? null;
  if (!meta) throw new Error("codex adapter: no session_meta with an id in the rollout");
  const sid = meta.id;
  const taskRef = `${input.repository}#${input.issue_number}`;
  const limits: string[] = [];

  const parsed = parsedAll.filter((p) => p.session === null || p.session.id === sid);
  const ignoredFiles = parsedAll.length - parsed.length;
  if (ignoredFiles > 0) limits.push(`${ignoredFiles} rollout file(s) of other threads ignored`);
  const rejected = parsed.flatMap((p) => p.rejected);
  const foreignMeta = parsed.reduce((n, p) => n + p.foreignSessionMeta, 0);
  if (foreignMeta > 0) limits.push(`${foreignMeta} session_meta line(s) of other threads ignored`);

  const continuation = parsed.find((p) => p.session?.historyBase != null);
  const baseSupplied = parsed.some((p) => p.session !== null && p.session.historyBase === null);
  const missingBase = continuation !== undefined && !baseSupplied;

  const models = new Map<string, { model: string | null; effort: string | null }>();
  for (const p of parsed) for (const [k, v] of p.models) models.set(k, v);
  const modelFor = (turnId: string | null) => ({
    provider: meta.modelProvider,
    id: (turnId !== null ? models.get(turnId)?.model : null) ?? null,
  });

  // ---- token rows ----
  const tur: CodexUsageRecord[] = parsed.flatMap((p) => p.usageRecords);
  const tokenCounts: CodexTokenCount[] = parsed.flatMap((p) => p.tokenCounts);
  const tcNoInfo = parsed.reduce((n, p) => n + p.tokenCountsWithoutInfo, 0);
  const byTs = <T extends { ts: string | null }>(xs: T[]): T[] =>
    xs
      .map((x, i) => ({ x, i }))
      .sort((a, b) => (isoMs(a.x.ts) ?? 0) - (isoMs(b.x.ts) ?? 0) || a.i - b.i)
      .map((e) => e.x);

  let rows: UsageRow[] = [];
  let counterMismatch = 0;
  let baselineUnexplained = false;
  if (tur.length > 0) {
    rows = byTs(tur).map((r) => ({
      responseId: r.responseId,
      turnId: r.turnId,
      ts: r.ts,
      usage: r.usage,
      threadTotal: r.threadTotal,
      derivation: "DELTA" as const,
    }));
    // Cross-check the reported deltas against the running thread totals (never summed).
    const seen = new Set<string>();
    const uniq = rows.filter((r) => {
      if (seen.has(r.responseId)) return false;
      seen.add(r.responseId);
      return true;
    });
    let prev: UsageRow | null = null;
    for (const r of uniq) {
      if (r.threadTotal?.total != null && r.usage.total !== null) {
        if (prev === null) {
          baselineUnexplained = r.threadTotal.total - r.usage.total > 0;
        } else if (
          prev.threadTotal?.total != null &&
          r.threadTotal.total - prev.threadTotal.total !== r.usage.total
        ) {
          counterMismatch += 1;
        }
        prev = r;
      }
    }
  } else if (tokenCounts.length > 0) {
    const conv = rowsFromTokenCounts(byTs(tokenCounts), continuation === undefined);
    rows = conv.rows;
    if (conv.repeats > 0)
      limits.push(`${conv.repeats} repeated cumulative token_count line(s) dropped`);
    limits.push("no token_usage_record lines; token metrics come from token_count lines");
  }
  if (tcNoInfo > 0) limits.push(`${tcNoInfo} token_count line(s) without usage info`);

  const raw: ObservationRecord[] = rows.map((r) =>
    modelRequestObservation(r, modelFor(r.turnId), taskRef, sid),
  );

  // ---- turns -> RUN_BOUNDARY ----
  const turnMap = new Map<string, CodexParse["turns"][number]>();
  for (const p of parsed) {
    for (const t of p.turns) {
      const prev = turnMap.get(t.turnId);
      // A later file may carry the completion of a turn opened in an earlier one.
      if (!prev || (prev.status === "OPEN" && t.status !== "OPEN")) turnMap.set(t.turnId, t);
    }
  }
  const turns = [...turnMap.values()];
  for (const t of turns) {
    const o = skeleton(`turn:${sid}:${t.turnId}`, "RUN_BOUNDARY", taskRef, sid);
    o.step_ref = t.turnId;
    o.started_at = iso(t.startedAtMs);
    const end =
      t.startedAtMs !== null && t.durationMs !== null
        ? t.startedAtMs + t.durationMs
        : t.completedAtMs;
    o.completed_at = t.status === "OPEN" ? null : iso(end);
    o.duration_ms = t.status === "OPEN" ? null : t.durationMs;
    o.status =
      t.status === "OPEN"
        ? "OPEN"
        : t.status === "COMPLETED"
          ? "COMPLETED"
          : `ABORTED_${(t.abortReason ?? "unknown").toUpperCase()}`;
    if (o.started_at) o.fields_epistemic.started_at = "OBSERVED";
    if (o.completed_at) o.fields_epistemic.completed_at = "OBSERVED";
    if (o.duration_ms !== null) o.fields_epistemic.duration_ms = "OBSERVED";
    o.fields_epistemic.status = "OBSERVED";
    raw.push(o);
  }
  const openTurns = turns.filter((t) => t.status === "OPEN").length;

  // ---- tool calls (response_item) paired with their outputs ----
  const outputTs = new Map<string, string | null>();
  for (const p of parsed)
    for (const o of p.outputs) if (!outputTs.has(o.callId)) outputTs.set(o.callId, o.ts);
  const toolObs: ObservationRecord[] = [];
  for (const p of parsed) {
    for (const c of p.calls) {
      const o = skeleton(`tool:${c.callId}`, "TOOL_CALL", taskRef, sid);
      o.step_ref = c.turnId;
      o.tool = { call_id: c.callId, name: c.name };
      o.started_at = c.ts;
      const paired = outputTs.has(c.callId);
      o.completed_at = paired ? (outputTs.get(c.callId) ?? null) : null;
      const s = isoMs(o.started_at);
      const e = isoMs(o.completed_at);
      if (s !== null && e !== null && e >= s) o.duration_ms = e - s;
      o.status = paired ? "completed" : "NO_OUTPUT";
      o.fields_epistemic.tool = "OBSERVED";
      if (o.started_at) o.fields_epistemic.started_at = "OBSERVED";
      if (o.completed_at) o.fields_epistemic.completed_at = "OBSERVED";
      if (o.duration_ms !== null) o.fields_epistemic.duration_ms = "OBSERVED";
      o.fields_epistemic.status = "OBSERVED";
      toolObs.push(o);
    }
  }
  raw.push(...toolObs);

  const deduped = dedupeObservations(raw);
  const observations = deduped.unique;
  const effectiveReqs = latestRevisions(observations.filter((o) => o.kind === "MODEL_REQUEST"));
  const effectiveTools = latestRevisions(observations.filter((o) => o.kind === "TOOL_CALL"));
  const unpairedDistinct = effectiveTools.filter((o) => o.status === "NO_OUTPUT").length;

  // ---- item-level executions (commands, MCP calls, file changes) ----
  const itemMap = new Map<string, CodexItem>();
  for (const p of parsed) for (const i of p.items) if (!itemMap.has(i.id)) itemMap.set(i.id, i);
  const items = [...itemMap.values()];

  // ---- hook spool ----
  let hooks: CodexHookAnalysis | null = null;
  if (input.hookSpool !== undefined) {
    const sp = parseCodexHookSpool(input.hookSpool);
    const mine = sp.entries.filter((e) => e.session_id === sid);
    const foreignHooks = sp.entries.length - mine.length;
    if (foreignHooks > 0) limits.push(`${foreignHooks} hook entr(ies) from other sessions ignored`);
    if (sp.skipped.length > 0)
      limits.push(`${sp.skipped.length} hook spool line(s) skipped (truncated or invalid)`);
    if (sp.duplicates > 0) limits.push(`${sp.duplicates} duplicate hook spool line(s) dropped`);
    if (mine.length === 0) limits.push("hook spool has no usable entries for this session");
    else hooks = analyzeCodexHooks(mine);
  }

  // ---- degradations ----
  const hasRejected = rejected.length > 0;
  if (rejected.length > 0) {
    limits.push(
      `${rejected.length} rollout line(s) rejected (truncated, malformed or unsupported)`,
    );
  }
  if (deduped.duplicates > 0)
    limits.push(`${deduped.duplicates} duplicate delivery record(s) dropped`);
  if (deduped.revisions.length > 0) {
    limits.push(
      `${deduped.revisions.length} observation(s) had conflicting revisions; latest revision counted`,
    );
  }
  if (counterMismatch > 0) {
    limits.push(
      `${counterMismatch} usage record(s) disagree with the running thread total; deltas kept`,
    );
  }
  if (missingBase) {
    limits.push(
      "continuation rollout without its base file; earlier usage of this thread is not included",
    );
  } else if (baselineUnexplained && continuation === undefined) {
    limits.push("thread totals exceed the supplied usage records; earlier history is not included");
  } else if (baselineUnexplained && continuation !== undefined && baseSupplied) {
    limits.push("thread totals exceed the supplied usage records; part of the history is missing");
  }
  if (openTurns > 0)
    limits.push(`${openTurns} turn(s) without completion (session may still be running)`);
  if (unpairedDistinct > 0) limits.push(`${unpairedDistinct} tool call(s) without an output line`);
  const derived = rows.some((r) => r.derivation === "DIFFERENCED");
  if (derived) limits.push("token deltas derived by differencing cumulative totals");
  if (rows.some((r) => r.usage.total === null && tur.length === 0)) {
    limits.push("some token_count lines could not be converted to a delta (no baseline)");
  }
  const degraded =
    hasRejected ||
    deduped.revisions.length > 0 ||
    counterMismatch > 0 ||
    missingBase ||
    baselineUnexplained;
  const modelCov: Coverage = degraded ? "PARTIAL" : "COMPLETE";

  // ---- metrics ----
  const rolloutRef = `codex:rollout:${sid}`;
  const hookRef = `codex:hook-spool:${sid}`;
  const refs = [rolloutRef];
  const ctxs = new Map<string, Ctx>();
  const metrics: MetricValue[] = [];
  const turnStarts = turns.map((t) => t.startedAtMs);
  const turnEnds = turns.map((t) =>
    t.startedAtMs !== null && t.durationMs !== null
      ? t.startedAtMs + t.durationMs
      : t.completedAtMs,
  );
  const reqTimes = effectiveReqs.map((r) => isoMs(r.completed_at));
  const modelWindow = windowId(sid, [...turnStarts, ...reqTimes], [...turnEnds, ...reqTimes]);
  const revisionOf = (recs: ObservationRecord[]): number =>
    Math.max(1, ...recs.map((r) => r.source_revision));

  const tokenKind: MetricIdentity["measurement_kind"] = derived
    ? "CUMULATIVE_SNAPSHOT"
    : "COUNTER_DELTA";
  const haveUsage = effectiveReqs.length > 0;
  if (haveUsage) {
    const cov = (partial: boolean): Coverage => (partial ? "PARTIAL" : modelCov);
    const inTok = sumField(effectiveReqs, (u) => u.input_tokens);
    const outTok = sumField(effectiveReqs, (u) => u.output_tokens);
    const cr = sumField(effectiveReqs, (u) => u.cache_read_tokens);
    const cw = sumField(effectiveReqs, (u) => u.cache_write_tokens);
    const rs = sumField(effectiveReqs, (u) => u.reasoning_tokens);
    for (const n of [
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "reasoning_tokens",
    ]) {
      ctxs.set(n, { observation_id: rolloutRef, window_id: modelWindow, kind: tokenKind });
    }
    ctxs.set("model_requests", {
      observation_id: rolloutRef,
      window_id: modelWindow,
      kind: "COUNTER_DELTA",
    });
    metrics.push(
      metric("model_requests", effectiveReqs.length, "count", "OBSERVED", modelCov, refs),
      metric("input_tokens", inTok.value, "tokens", "OBSERVED", cov(inTok.partial), refs),
      metric("output_tokens", outTok.value, "tokens", "OBSERVED", cov(outTok.partial), refs),
      metric("cache_read_tokens", cr.value, "tokens", "OBSERVED", cov(cr.partial), refs),
      metric("cache_write_tokens", cw.value, "tokens", "OBSERVED", cov(cw.partial), refs),
      metric("reasoning_tokens", rs.value, "tokens", "OBSERVED", cov(rs.partial), refs),
    );
  } else {
    for (const [n, u] of [
      ["model_requests", "count"],
      ["input_tokens", "tokens"],
      ["output_tokens", "tokens"],
      ["cache_read_tokens", "tokens"],
      ["cache_write_tokens", "tokens"],
      ["reasoning_tokens", "tokens"],
    ] as const) {
      metrics.push(metric(n, null, u, "UNKNOWN", "UNKNOWN", []));
    }
  }
  const toolCount = new Set(effectiveTools.map((o) => o.observation_id)).size;
  if (haveUsage || toolCount > 0) {
    ctxs.set("tool_calls", {
      observation_id: rolloutRef,
      window_id: modelWindow,
      kind: "COUNTER_DELTA",
    });
    metrics.push(
      metric(
        "tool_calls",
        toolCount,
        "count",
        "OBSERVED",
        unpairedDistinct > 0 && modelCov === "COMPLETE" ? "PARTIAL" : modelCov,
        refs,
      ),
    );
  } else {
    metrics.push(metric("tool_calls", null, "count", "UNKNOWN", "UNKNOWN", []));
  }
  // No per-request start/end exists in the rollout.
  metrics.push(metric("model_wall_ms", null, "ms", "UNKNOWN", "UNKNOWN", []));

  const turnWindows: Array<[number, number]> = [];
  let turnsWithoutTime = 0;
  for (const t of turns) {
    if (t.status === "OPEN") continue;
    if (t.startedAtMs === null || t.durationMs === null) turnsWithoutTime += 1;
    else turnWindows.push([t.startedAtMs, t.startedAtMs + t.durationMs]);
  }
  ctxs.set("run_wall_ms", {
    observation_id: rolloutRef,
    window_id: windowId(
      sid,
      turnWindows.map((w) => w[0]),
      turnWindows.map((w) => w[1]),
    ),
    kind: "COUNTER_DELTA",
  });
  metrics.push(
    metric(
      "run_wall_ms",
      turnWindows.length > 0 ? unionIntervalMs(turnWindows) : null,
      "ms",
      "OBSERVED",
      openTurns === 0 && turnsWithoutTime === 0 && !missingBase && !hasRejected
        ? "COMPLETE"
        : "PARTIAL",
      refs,
    ),
  );

  if (items.length > 0) {
    const spans: Array<[number, number]> = [];
    let untimed = 0;
    for (const i of items) {
      if (i.startedAtMs === null || i.completedAtMs === null || i.completedAtMs < i.startedAtMs)
        untimed += 1;
      else spans.push([i.startedAtMs, i.completedAtMs]);
    }
    const itemCov: Coverage = untimed > 0 || hasRejected || missingBase ? "PARTIAL" : "COMPLETE";
    const itemWindow = windowId(
      sid,
      spans.map((s) => s[0]),
      spans.map((s) => s[1]),
    );
    for (const n of ["tool_wall_ms", "tool_failures", "tool_executions"]) {
      ctxs.set(n, { observation_id: rolloutRef, window_id: itemWindow, kind: "COUNTER_DELTA" });
    }
    metrics.push(
      metric(
        "tool_wall_ms",
        spans.length > 0 ? unionIntervalMs(spans) : null,
        "ms",
        "OBSERVED",
        itemCov,
        refs,
      ),
      metric("tool_failures", items.filter(failed).length, "count", "OBSERVED", itemCov, refs),
      metric("tool_executions", items.length, "count", "OBSERVED", itemCov, refs),
    );
    if (untimed > 0) limits.push(`${untimed} executed item(s) without start/end times`);
  }
  if (hooks) {
    ctxs.set("hook_events", {
      observation_id: hookRef,
      window_id: modelWindow,
      kind: "COUNTER_DELTA",
    });
    metrics.push(metric("hook_events", hooks.events, "count", "OBSERVED", "COMPLETE", [hookRef]));
  }
  const revision = revisionOf([...effectiveReqs, ...effectiveTools]);
  const withIdentity = metrics.map((m) => ({
    ...m,
    identity: identityFor(sid, m, ctxs.get(m.name), revision),
  }));

  limits.push(
    "model_wall_ms unknown: the rollout has no per-request timing",
    "cost unknown (no billed cost exposed)",
    "tool_calls count exec wrapper calls; tool_executions counts the commands/MCP calls/file changes run inside them",
  );

  // ---- run segment and source sha ----
  const startedMs = turnStarts.filter((x): x is number => x !== null);
  const allFinished = turns.length > 0 && openTurns === 0 && turnEnds.every((e) => e !== null);
  const run: RunRecord = {
    started_at: startedMs.length > 0 ? iso(Math.min(...startedMs)) : meta.startedAt,
    finished_at: allFinished
      ? iso(Math.max(...turnEnds.filter((x): x is number => x !== null)))
      : null,
    exit_code: null,
    head_before: hooks?.headBefore ?? meta.gitCommit,
    head_after: hooks?.headAfter ?? null,
  };
  const sourceSha = hooks?.headAfter ?? null;
  if (sourceSha === null) {
    limits.push(
      "source SHA at the end of the session not witnessed (session_meta git commit is HEAD at thread start)",
    );
  } else if (hooks?.dirtyAfter === true) {
    limits.push(
      "working tree was dirty at the last Stop hook; source_sha may not contain all work",
    );
  }
  if (hooks && hooks.stops === 0) limits.push("hook spool has no Stop entry");

  let capture: Coverage;
  if (!haveUsage && turns.length === 0) capture = "UNKNOWN";
  else if (haveUsage && !degraded && openTurns === 0 && turnsWithoutTime === 0)
    capture = "COMPLETE";
  else capture = "PARTIAL";

  const observationRefs = [rolloutRef];
  if (hooks) observationRefs.push(hookRef);

  const summary: AttemptSummary = {
    repository: input.repository,
    issue_number: input.issue_number,
    task_ref: taskRef,
    attempt_ref: sid,
    attempt_binding: "COLLECTOR_ONLY",
    source_sha: sourceSha,
    actor: input.actor,
    observed_at: input.observed_at,
    observation_refs: observationRefs,
    capture_coverage: capture,
    limits,
    metrics: withIdentity,
    cost: {
      value: null,
      currency: null,
      basis: "UNKNOWN",
      pricing_basis: null,
      epistemic: "UNKNOWN",
      source_refs: [],
    },
    attempt_refs: [sid],
    excluded_attempt_refs: [],
    verifier: { ...NOT_RUN },
    learning: { state: "NONE_MATERIAL", source_refs: [] },
  };

  return {
    profile: hooks ? codexCapabilityWithHooks(hooks.plugin) : CODEX_CAPABILITY,
    observations,
    summary,
    rejected,
    limits: summary.limits,
    sessionId: sid,
    run,
  };
}
