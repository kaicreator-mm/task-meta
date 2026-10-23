// Correlation: delivery dedup, interval union and AttemptSummary assembly.
import type { HeadlessResult, RunRecord } from "./adapters/zcode/parse.ts";
import { canonicalDigest } from "./canonical.ts";
import type {
  ActorRef,
  AttemptSummary,
  Coverage,
  Epistemic,
  MetricIdentity,
  MetricValue,
  ObservationRecord,
  VerifierOutcome,
} from "./model.ts";

export interface DedupeResult {
  unique: ObservationRecord[];
  duplicates: number;
  revisions: string[];
}

function digestOf(r: ObservationRecord): string {
  // Revision is assigned by the correlator, so it is not part of the content digest.
  const { source_revision: _ignored, ...rest } = r;
  return canonicalDigest(rest);
}

/**
 * Same observation_id + same digest = duplicate delivery (dropped, counted).
 * Same id + different digest = kept as a new revision (previous + 1) and flagged.
 */
export function dedupeObservations(records: ObservationRecord[]): DedupeResult {
  const seen = new Map<string, { digests: Set<string>; revision: number }>();
  const unique: ObservationRecord[] = [];
  const revisions: string[] = [];
  let duplicates = 0;
  for (const r of records) {
    const digest = digestOf(r);
    const prev = seen.get(r.observation_id);
    if (!prev) {
      seen.set(r.observation_id, { digests: new Set([digest]), revision: r.source_revision });
      unique.push(r);
      continue;
    }
    if (prev.digests.has(digest)) {
      duplicates += 1;
      continue;
    }
    prev.digests.add(digest);
    prev.revision += 1;
    unique.push({ ...r, source_revision: prev.revision });
    if (!revisions.includes(r.observation_id)) revisions.push(r.observation_id);
  }
  return { unique, duplicates, revisions };
}

/** Total covered time of possibly overlapping [start,end] ms intervals. */
export function unionIntervalMs(intervals: Array<[number, number]>): number {
  const sorted = intervals
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e >= s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = 0;
  let curEnd = 0;
  let open = false;
  for (const [s, e] of sorted) {
    if (!open) {
      curStart = s;
      curEnd = e;
      open = true;
    } else if (s <= curEnd) {
      if (e > curEnd) curEnd = e;
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  if (open) total += curEnd - curStart;
  return total;
}

/** Latest revision per observation_id (superseded revisions must not be double counted). */
export function latestRevisions(records: ObservationRecord[]): ObservationRecord[] {
  const latest = new Map<string, ObservationRecord>();
  for (const r of records) {
    const prev = latest.get(r.observation_id);
    if (!prev || r.source_revision >= prev.source_revision) latest.set(r.observation_id, r);
  }
  return [...latest.values()];
}

export interface SummaryInput {
  repository: string;
  issue_number: number;
  actor: ActorRef;
  observed_at: string;
  sessionId: string;
  /** Deduplicated observations (all revisions kept). */
  observations: ObservationRecord[];
  headless: HeadlessResult | null;
  /** True when a model-io rollout was supplied. */
  modelIoSupplied: boolean;
  /** Run segments (resumed sessions have several); order is irrelevant, they are sorted here. */
  runs: RunRecord[];
  gate: VerifierOutcome;
  rejectedCount: number;
  duplicates: number;
  revisions: string[];
  limits: string[];
  /** Present only when a (non-empty) task-meta-capture hook spool was ingested. */
  hooks?: {
    eventCount: number;
    /** Distinct tool call ids seen by hooks. */
    toolCalls: number;
    /** Distinct tool call ids in the rollout; null when no model-io was supplied. */
    rolloutToolCalls: number | null;
  };
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

function sumField(
  recs: ObservationRecord[],
  pick: (r: ObservationRecord) => number | null | undefined,
): { value: number | null; partial: boolean } {
  let sum = 0;
  let any = false;
  let missing = false;
  for (const r of recs) {
    const v = pick(r);
    if (v === null || v === undefined) missing = true;
    else {
      sum += v;
      any = true;
    }
  }
  return { value: any ? sum : null, partial: any && missing };
}

/** Slack for second-precision run.txt timestamps against millisecond rollout times. */
const WINDOW_SLACK_MS = 2000;

/** A finished segment has a finish time; an unfinished one (controller died) has none. */
export function isFinished(r: RunRecord): boolean {
  return r.finished_at !== null;
}

/** Non-empty run records sorted by start time (unknown start last, stable). */
export function sortRunSegments(runs: RunRecord[]): RunRecord[] {
  return runs
    .filter(
      (r) =>
        r.started_at !== null ||
        r.finished_at !== null ||
        r.exit_code !== null ||
        r.head_after !== null,
    )
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = a.r.started_at ? Date.parse(a.r.started_at) : Number.POSITIVE_INFINITY;
      const tb = b.r.started_at ? Date.parse(b.r.started_at) : Number.POSITIVE_INFINITY;
      return ta === tb ? a.i - b.i : ta < tb ? -1 : 1;
    })
    .map((x) => x.r);
}

/** Indexes i>=1 where head_before(i) is not exactly head_after(i-1) (unknown counts as broken). */
function brokenChainIndexes(segs: RunRecord[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1] as RunRecord;
    const cur = segs[i] as RunRecord;
    if (!prev.head_after || !cur.head_before || prev.head_after !== cur.head_before) out.push(i);
  }
  return out;
}

/** The commit the attempt is known to have reached (see buildAttemptSummary). */
export function witnessedHead(runs: RunRecord[]): string | null {
  const segs = sortRunSegments(runs);
  const last = segs[segs.length - 1];
  if (last && isFinished(last)) return last.head_after;
  return [...segs].reverse().find((sg) => isFinished(sg) && sg.head_after)?.head_after ?? null;
}

interface IdentityCtx {
  observation_id: string;
  window_id: string;
  source_revision: number;
}

function isoWindow(sid: string, starts: Array<string | null>, ends: Array<string | null>): string {
  const sv = starts.map((x) => (x ? Date.parse(x) : Number.NaN)).filter((x) => !Number.isNaN(x));
  const ev = ends.map((x) => (x ? Date.parse(x) : Number.NaN)).filter((x) => !Number.isNaN(x));
  if (sv.length === 0 || ev.length === 0) return `zcode:window:${sid}:unknown`;
  const a = new Date(Math.min(...sv)).toISOString();
  const b = new Date(Math.max(...ev)).toISOString();
  return `zcode:window:${sid}:${a}/${b}`;
}

function identityFor(sid: string, m: MetricValue, ctx: IdentityCtx | undefined): MetricIdentity {
  const known = m.value !== null && ctx !== undefined;
  return {
    metric_id: `task-meta:${sid}:${m.name}`,
    observation_id: known ? ctx.observation_id : `zcode:unobserved:${sid}`,
    logical_call_ref: `zcode:attempt:${sid}`,
    physical_attempt_ref: `zcode:attempt:${sid}`,
    adapter_id: "zcode",
    provider_run_ref: null,
    measurement_kind: known ? "COUNTER_DELTA" : "UNKNOWN",
    window_id: known ? ctx.window_id : `zcode:window:${sid}:unknown`,
    source_revision: known ? ctx.source_revision : 1,
  };
}

export function buildAttemptSummary(input: SummaryInput): AttemptSummary {
  const sid = input.sessionId;
  const headlessRef = `zcode:session:${sid}`;
  const modelIoRef = `zcode:model-io:${sid}`;
  const runRef = `zcode:run-record:${sid}`;
  const limits = [...input.limits];

  const effectiveReqs = latestRevisions(
    input.observations.filter((o) => o.kind === "MODEL_REQUEST"),
  );
  const toolCount = new Set(
    input.observations.filter((o) => o.kind === "TOOL_CALL").map((o) => o.observation_id),
  ).size;
  const haveModelIo = effectiveReqs.length > 0;
  const segs = sortRunSegments(input.runs);
  const haveRun = segs.length > 0;

  let mismatch = false;
  if (
    haveModelIo &&
    input.headless?.usage.modelRequestCount !== null &&
    input.headless?.usage.modelRequestCount !== undefined &&
    input.headless.usage.modelRequestCount !== effectiveReqs.length
  ) {
    mismatch = true;
    limits.push(
      `headless modelRequestCount=${input.headless.usage.modelRequestCount} differs from rollout unique physical requests=${effectiveReqs.length}; rollout numbers kept`,
    );
  }
  if (input.revisions.length > 0) {
    limits.push(
      `${input.revisions.length} model request(s) had conflicting revisions; latest revision counted`,
    );
  }
  if (input.rejectedCount > 0) {
    limits.push(`${input.rejectedCount} model_io line(s) rejected (malformed or wrong type)`);
  }
  if (input.duplicates > 0) {
    limits.push(`${input.duplicates} duplicate delivery record(s) dropped`);
  }
  const hookMismatch =
    input.hooks !== undefined &&
    input.hooks.rolloutToolCalls !== null &&
    input.hooks.rolloutToolCalls !== input.hooks.toolCalls;
  if (hookMismatch && input.hooks) {
    limits.push(
      `hook tool calls=${input.hooks.toolCalls} differ from rollout tool calls=${input.hooks.rolloutToolCalls}; hook timing coverage PARTIAL`,
    );
  }
  const degraded =
    mismatch || input.revisions.length > 0 || input.rejectedCount > 0 || hookMismatch;
  const modelCov: Coverage = degraded ? "PARTIAL" : "COMPLETE";

  const metrics: MetricValue[] = [];
  const ctxs = new Map<string, IdentityCtx>();
  const h = input.headless;
  if (haveModelIo) {
    const usage = (r: ObservationRecord) => r.usage;
    const inTok = sumField(effectiveReqs, (r) => usage(r)?.input_tokens);
    const outTok = sumField(effectiveReqs, (r) => usage(r)?.output_tokens);
    const cr = sumField(effectiveReqs, (r) => usage(r)?.cache_read_tokens);
    const cw = sumField(effectiveReqs, (r) => usage(r)?.cache_write_tokens);
    const cov = (partial: boolean): Coverage => (partial ? "PARTIAL" : modelCov);
    const refs = [modelIoRef];
    const toolRecs = input.observations.filter((o) => o.kind === "TOOL_CALL");
    const modelCtx: IdentityCtx = {
      observation_id: modelIoRef,
      window_id: isoWindow(
        sid,
        effectiveReqs.map((r) => r.started_at),
        effectiveReqs.map((r) => r.completed_at),
      ),
      source_revision: Math.max(1, ...effectiveReqs.concat(toolRecs).map((r) => r.source_revision)),
    };
    for (const n of [
      "model_requests",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "tool_calls",
      "model_wall_ms",
    ]) {
      ctxs.set(n, modelCtx);
    }
    metrics.push(
      metric("model_requests", effectiveReqs.length, "count", "OBSERVED", modelCov, refs),
      metric("input_tokens", inTok.value, "tokens", "OBSERVED", cov(inTok.partial), refs),
      metric("output_tokens", outTok.value, "tokens", "OBSERVED", cov(outTok.partial), refs),
      metric("cache_read_tokens", cr.value, "tokens", "OBSERVED", cov(cr.partial), refs),
      metric("cache_write_tokens", cw.value, "tokens", "OBSERVED", cov(cw.partial), refs),
      metric("reasoning_tokens", null, "tokens", "UNKNOWN", "UNKNOWN", []),
      metric(
        "tool_calls",
        toolCount,
        "count",
        "OBSERVED",
        hookMismatch && modelCov === "COMPLETE" ? "PARTIAL" : modelCov,
        refs,
      ),
    );
    const intervals: Array<[number, number]> = [];
    let missingTimes = false;
    for (const r of effectiveReqs) {
      const s = r.started_at ? Date.parse(r.started_at) : Number.NaN;
      const e = r.completed_at ? Date.parse(r.completed_at) : Number.NaN;
      if (Number.isNaN(s) || Number.isNaN(e)) missingTimes = true;
      else intervals.push([s, e]);
    }
    metrics.push(
      metric(
        "model_wall_ms",
        intervals.length > 0 ? unionIntervalMs(intervals) : null,
        "ms",
        "OBSERVED",
        missingTimes ? "PARTIAL" : modelCov,
        refs,
      ),
    );
  } else if (h) {
    const refs = [headlessRef];
    const hctx: IdentityCtx = {
      observation_id: headlessRef,
      window_id: `zcode:window:${sid}:unknown`,
      source_revision: 1,
    };
    for (const n of [
      "model_requests",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
    ]) {
      ctxs.set(n, hctx);
    }
    limits.push("no model-io rollout; token metrics are headless self-report");
    const u = h.usage;
    metrics.push(
      metric("model_requests", u.modelRequestCount, "count", "SELF_REPORTED", "PARTIAL", refs),
      metric("input_tokens", u.inputTokens, "tokens", "SELF_REPORTED", "PARTIAL", refs),
      metric("output_tokens", u.outputTokens, "tokens", "SELF_REPORTED", "PARTIAL", refs),
      metric("cache_read_tokens", u.cacheReadTokens, "tokens", "SELF_REPORTED", "PARTIAL", refs),
      metric("cache_write_tokens", u.cacheWriteTokens, "tokens", "SELF_REPORTED", "PARTIAL", refs),
      metric("reasoning_tokens", null, "tokens", "UNKNOWN", "UNKNOWN", []),
      metric("tool_calls", null, "count", "UNKNOWN", "UNKNOWN", []),
      metric("model_wall_ms", null, "ms", "UNKNOWN", "UNKNOWN", []),
    );
  } else {
    for (const [name, unit] of [
      ["model_requests", "count"],
      ["input_tokens", "tokens"],
      ["output_tokens", "tokens"],
      ["cache_read_tokens", "tokens"],
      ["cache_write_tokens", "tokens"],
      ["reasoning_tokens", "tokens"],
      ["tool_calls", "count"],
      ["model_wall_ms", "ms"],
    ] as const) {
      metrics.push(metric(name, null, unit, "UNKNOWN", "UNKNOWN", []));
    }
  }

  const finishedWindows: Array<[number, number]> = [];
  for (const sg of segs) {
    if (!isFinished(sg) || !sg.started_at || !sg.finished_at) continue;
    finishedWindows.push([Date.parse(sg.started_at), Date.parse(sg.finished_at)]);
  }
  const finishedSegs = segs.filter(isFinished);
  ctxs.set("run_wall_ms", {
    observation_id: runRef,
    window_id: isoWindow(
      sid,
      finishedSegs.map((sg) => sg.started_at),
      finishedSegs.map((sg) => sg.finished_at),
    ),
    source_revision: 1,
  });
  const runWall = finishedWindows.length > 0 ? unionIntervalMs(finishedWindows) : null;
  const unfinished = segs.filter((sg) => !isFinished(sg)).length;
  const brokenAt = brokenChainIndexes(segs);
  let outside = 0;
  if (haveModelIo && haveRun) {
    // Unfinished segments are open-ended: the controller died, the work still belongs to them.
    const windows: Array<[number, number]> = segs
      .filter((sg) => sg.started_at)
      .map((sg) => [
        Date.parse(sg.started_at as string),
        sg.finished_at ? Date.parse(sg.finished_at) : Number.POSITIVE_INFINITY,
      ]);
    for (const r of effectiveReqs) {
      const s = r.started_at ? Date.parse(r.started_at) : Number.NaN;
      const e = r.completed_at ? Date.parse(r.completed_at) : Number.NaN;
      if (Number.isNaN(s) || Number.isNaN(e)) continue;
      if (!windows.some(([ws, we]) => s >= ws - WINDOW_SLACK_MS && e <= we + WINDOW_SLACK_MS)) {
        outside += 1;
      }
    }
  }
  const runComplete = haveRun && unfinished === 0 && brokenAt.length === 0 && outside === 0;
  metrics.push(
    metric("run_wall_ms", runWall, "ms", "OBSERVED", runComplete ? "COMPLETE" : "PARTIAL", [
      runRef,
    ]),
  );
  if (input.hooks) {
    const hookRef = `zcode:hook-spool:${sid}`;
    const toolRecs = latestRevisions(input.observations.filter((o) => o.kind === "TOOL_CALL"));
    const spans: Array<[number, number]> = [];
    let untimed = 0;
    for (const t of toolRecs) {
      const s = t.started_at ? Date.parse(t.started_at) : Number.NaN;
      const e = t.completed_at ? Date.parse(t.completed_at) : Number.NaN;
      if (Number.isNaN(s) || Number.isNaN(e)) untimed += 1;
      else spans.push([s, e]);
    }
    const failures = toolRecs.filter((t) => t.status === "failure").length;
    const hookCtx: IdentityCtx = {
      observation_id: hookRef,
      window_id: isoWindow(
        sid,
        spans.map(([s]) => new Date(s).toISOString()),
        spans.map(([, e]) => new Date(e).toISOString()),
      ),
      source_revision: 1,
    };
    for (const n of ["tool_wall_ms", "tool_failures", "hook_events"]) ctxs.set(n, hookCtx);
    const toolCov: Coverage = hookMismatch || untimed > 0 ? "PARTIAL" : "COMPLETE";
    metrics.push(
      metric(
        "tool_wall_ms",
        spans.length > 0 ? unionIntervalMs(spans) : null,
        "ms",
        "OBSERVED",
        toolCov,
        [hookRef],
      ),
      metric("tool_failures", failures, "count", "OBSERVED", toolCov, [hookRef]),
      metric("hook_events", input.hooks.eventCount, "count", "OBSERVED", "COMPLETE", [hookRef]),
    );
    if (untimed > 0) limits.push(`${untimed} tool call(s) without a complete hook start/end pair`);
  }
  const withIdentity = metrics.map((m) => ({
    ...m,
    identity: identityFor(sid, m, ctxs.get(m.name)),
  }));
  if (!haveRun) limits.push("run record missing; run boundary and source SHA unknown");
  if (unfinished > 0) limits.push(`${unfinished} run segment(s) without finish record`);
  for (const i of brokenAt) limits.push(`run segment head chain broken at ${i}`);
  if (outside > 0) limits.push(`${outside} model request(s) outside recorded run segments`);

  let capture: Coverage;
  if (!h && !haveModelIo) capture = "UNKNOWN";
  else if (h && haveModelIo && haveRun && !degraded && runComplete) capture = "COMPLETE";
  else capture = "PARTIAL";

  const last = segs[segs.length - 1];
  let sourceSha: string | null = null;
  if (last && isFinished(last)) sourceSha = last.head_after;
  else {
    const witnessed = [...segs].reverse().find((sg) => isFinished(sg) && sg.head_after);
    sourceSha = witnessed?.head_after ?? null;
    if (last && witnessed) {
      limits.push("latest run segment unfinished; source_sha is the last witnessed head");
    }
  }
  const observationRefs: string[] = [];
  if (h) observationRefs.push(headlessRef);
  if (haveModelIo) observationRefs.push(modelIoRef);
  if (haveRun) observationRefs.push(runRef);
  if (input.hooks) observationRefs.push(`zcode:hook-spool:${sid}`);
  observationRefs.push(...input.gate.source_refs.slice(0, 1));

  return {
    repository: input.repository,
    issue_number: input.issue_number,
    task_ref: `${input.repository}#${input.issue_number}`,
    attempt_ref: sid,
    attempt_binding: "COLLECTOR_ONLY",
    source_sha: sourceSha,
    actor: input.actor,
    observed_at: input.observed_at,
    observation_refs: observationRefs.slice(0, 10),
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
    verifier: input.gate,
    learning: { state: "NONE_MATERIAL", source_refs: [] },
  };
}
