// Correlation: delivery dedup, interval union and AttemptSummary assembly.
import type { HeadlessResult, RunRecord } from "./adapters/zcode/parse.ts";
import { canonicalDigest } from "./canonical.ts";
import type {
  ActorRef,
  AttemptSummary,
  Coverage,
  Epistemic,
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
  run: RunRecord | null;
  gate: VerifierOutcome;
  rejectedCount: number;
  duplicates: number;
  revisions: string[];
  limits: string[];
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
  const haveRun =
    input.run !== null &&
    (input.run.started_at !== null ||
      input.run.finished_at !== null ||
      input.run.exit_code !== null ||
      input.run.head_after !== null);

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
  const degraded = mismatch || input.revisions.length > 0 || input.rejectedCount > 0;
  const modelCov: Coverage = degraded ? "PARTIAL" : "COMPLETE";

  const metrics: MetricValue[] = [];
  const h = input.headless;
  if (haveModelIo) {
    const usage = (r: ObservationRecord) => r.usage;
    const inTok = sumField(effectiveReqs, (r) => usage(r)?.input_tokens);
    const outTok = sumField(effectiveReqs, (r) => usage(r)?.output_tokens);
    const cr = sumField(effectiveReqs, (r) => usage(r)?.cache_read_tokens);
    const cw = sumField(effectiveReqs, (r) => usage(r)?.cache_write_tokens);
    const cov = (partial: boolean): Coverage => (partial ? "PARTIAL" : modelCov);
    const refs = [modelIoRef];
    metrics.push(
      metric("model_requests", effectiveReqs.length, "count", "OBSERVED", modelCov, refs),
      metric("input_tokens", inTok.value, "tokens", "OBSERVED", cov(inTok.partial), refs),
      metric("output_tokens", outTok.value, "tokens", "OBSERVED", cov(outTok.partial), refs),
      metric("cache_read_tokens", cr.value, "tokens", "OBSERVED", cov(cr.partial), refs),
      metric("cache_write_tokens", cw.value, "tokens", "OBSERVED", cov(cw.partial), refs),
      metric("reasoning_tokens", null, "tokens", "UNKNOWN", "UNKNOWN", []),
      metric("tool_calls", toolCount, "count", "OBSERVED", modelCov, refs),
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

  let runWall: number | null = null;
  if (input.run?.started_at && input.run.finished_at) {
    const d = Date.parse(input.run.finished_at) - Date.parse(input.run.started_at);
    if (d >= 0) runWall = d;
  }
  metrics.push(metric("run_wall_ms", runWall, "ms", "OBSERVED", "COMPLETE", [runRef]));
  if (!haveRun) limits.push("run record missing; run boundary and source SHA unknown");

  let capture: Coverage;
  if (!h && !haveModelIo) capture = "UNKNOWN";
  else if (h && haveModelIo && haveRun && !degraded) capture = "COMPLETE";
  else capture = "PARTIAL";

  const sourceSha = input.run?.head_after ?? null;
  const observationRefs: string[] = [];
  if (h) observationRefs.push(headlessRef);
  if (haveModelIo) observationRefs.push(modelIoRef);
  if (haveRun) observationRefs.push(runRef);
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
    metrics,
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
