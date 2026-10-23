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
import { claudeCapability } from "./capability.ts";
import { analyzeClaudeHooks, type ClaudeHookAnalysis, parseClaudeHookSpool } from "./hooks.ts";
import {
  type ClaudeMessage,
  type ClaudeParse,
  type ClaudeToolResult,
  type ClaudeToolUse,
  type ClaudeUsage,
  mergeClaudeMessages,
  parseClaudeTranscript,
} from "./parse.ts";

export { CLAUDE_CAPABILITY } from "./capability.ts";
export { findClaudeTranscripts } from "./find.ts";
export { parseClaudeTranscript } from "./parse.ts";

export interface ClaudeRunInput {
  repository: string;
  issue_number: number;
  actor: ActorRef;
  observed_at: string;
  /**
   * Session transcript JSONL text; several texts = the main transcript plus its subagent
   * transcripts (`<sessionId>/subagents/agent-*.jsonl`). Duplicates are folded by message id.
   */
  transcript: string | string[];
  /** Contents of the task-meta-capture Claude Code hook spool for this session. */
  hookSpool?: string;
}

export interface ClaudeCollection {
  profile: SourceCapabilityProfile;
  observations: ObservationRecord[];
  summary: AttemptSummary;
  rejected: { line: number; reason: string }[];
  limits: string[];
  sessionId: string;
  /** Synthetic single run segment for lineage (start/end of the session, git heads). */
  run: RunRecord;
}

const ADAPTER = "claude";
const PROVIDER = "anthropic";
const END_REASONS = new Set(["end_turn", "stop_sequence", "max_tokens", "refusal"]);
const AGENT_TOOLS = new Set(["Agent", "Task"]);

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

const isoMs = (s: string | null): number | null => {
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * Anthropic `input_tokens` excludes cache reads/writes; task-meta's convention is inclusive.
 * Needs all three counters, otherwise the inclusive input (and the total) is UNKNOWN.
 */
export function normalizeClaudeUsage(u: ClaudeUsage): TokenUsage {
  const input =
    u.input !== null && u.cacheRead !== null && u.cacheWrite !== null
      ? u.input + u.cacheRead + u.cacheWrite
      : null;
  return {
    input_tokens: input,
    output_tokens: u.output,
    cache_read_tokens: u.cacheRead,
    cache_write_tokens: u.cacheWrite,
    reasoning_tokens: u.thinking,
    total_tokens: input !== null && u.output !== null ? input + u.output : null,
  };
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
    return {
      name,
      value: null,
      unit,
      epistemic: "UNKNOWN",
      coverage: "UNKNOWN",
      source_refs: [],
    };
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
  if (s.length === 0 || e.length === 0) return `claude:window:${sid}:unknown`;
  return `claude:window:${sid}:${new Date(Math.min(...s)).toISOString()}/${new Date(Math.max(...e)).toISOString()}`;
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
    observation_id: known ? ctx.observation_id : `claude:unobserved:${sid}`,
    logical_call_ref: `claude:attempt:${sid}`,
    physical_attempt_ref: `claude:attempt:${sid}`,
    adapter_id: ADAPTER,
    provider_run_ref: null,
    measurement_kind: known ? ctx.kind : "UNKNOWN",
    window_id: known ? ctx.window_id : `claude:window:${sid}:unknown`,
    source_revision: known ? revision : 1,
  };
}

interface Turn {
  index: number;
  startMs: number;
  endMs: number | null;
  status: "COMPLETED" | "INTERRUPTED" | "OPEN";
}

function buildTurns(
  prompts: ClaudeParse["prompts"],
  mainMessages: ClaudeMessage[],
  mainResults: ClaudeToolResult[],
): Turn[] {
  const starts = [
    ...new Map(
      prompts
        .map((p) => isoMs(p.ts))
        .filter((t): t is number => t !== null)
        .map((t) => [t, t] as const),
    ).values(),
  ].sort((a, b) => a - b);
  const turns: Turn[] = [];
  for (let i = 0; i < starts.length; i++) {
    const startMs = starts[i] as number;
    const bound = starts[i + 1] ?? Number.POSITIVE_INFINITY;
    let end: number | null = null;
    let lastMsg: ClaudeMessage | null = null;
    let lastMsgEnd = Number.NEGATIVE_INFINITY;
    for (const m of mainMessages) {
      const f = isoMs(m.firstTs);
      const l = isoMs(m.lastTs);
      if (f === null || l === null || f < startMs || f >= bound) continue;
      if (end === null || l > end) end = l;
      if (l >= lastMsgEnd) {
        lastMsgEnd = l;
        lastMsg = m;
      }
    }
    let lastResult = Number.NEGATIVE_INFINITY;
    for (const r of mainResults) {
      const t = isoMs(r.ts);
      if (t === null || t < startMs || t >= bound) continue;
      if (end === null || t > end) end = t;
      if (t > lastResult) lastResult = t;
    }
    // A closing assistant message must come after the last tool result of the turn.
    const closed =
      lastMsg !== null &&
      lastMsg.stopReason !== null &&
      END_REASONS.has(lastMsg.stopReason) &&
      lastMsgEnd >= lastResult;
    const isLast = i === starts.length - 1;
    turns.push({
      index: i + 1,
      startMs,
      endMs: end,
      status: closed ? "COMPLETED" : isLast ? "OPEN" : "INTERRUPTED",
    });
  }
  return turns;
}

export function collectClaudeRun(input: ClaudeRunInput): ClaudeCollection {
  const texts = Array.isArray(input.transcript) ? input.transcript : [input.transcript];
  const parsedAll: ClaudeParse[] = texts.map((t) => parseClaudeTranscript(t));
  const first = parsedAll.find((p) => p.sessionId !== null);
  if (!first || first.sessionId === null)
    throw new Error("claude adapter: no session id found in the transcript");
  const sid = first.sessionId;
  const taskRef = `${input.repository}#${input.issue_number}`;
  const limits: string[] = [];

  const parsed = parsedAll.filter((p) => p.sessionId === null || p.sessionId === sid);
  const ignoredFiles = parsedAll.length - parsed.length;
  if (ignoredFiles > 0) limits.push(`${ignoredFiles} transcript file(s) of other sessions ignored`);
  const foreign = parsed.reduce((n, p) => n + p.foreignSession, 0);
  if (foreign > 0) limits.push(`${foreign} transcript line(s) of other sessions ignored`);
  const rejected = parsed.flatMap((p) => p.rejected);

  // ---- messages: one record per message id across all files ----
  const allMessages = mergeClaudeMessages(parsed.flatMap((p) => p.messages));
  const syntheticCount = allMessages.filter((m) => m.synthetic).length;
  const messages = allMessages.filter((m) => !m.synthetic);
  if (syntheticCount > 0)
    limits.push(`${syntheticCount} client-side placeholder message(s) (no model request) ignored`);
  const conflicts = messages.filter((m) => m.usageConflict).length;
  const providerVersion = (() => {
    const c = new Map<string, number>();
    for (const p of parsed) if (p.version !== null) c.set(p.version, (c.get(p.version) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  })();

  const raw: ObservationRecord[] = [];
  for (const m of messages) {
    const o = skeleton(`msg:${m.key}`, "MODEL_REQUEST", taskRef, sid);
    o.logical_call_ref = m.requestId ?? m.key;
    o.physical_attempt_ref = m.key;
    if (m.sidechain) o.parent_ref = `claude:agent:${m.agentId ?? "unknown"}`;
    // No request start is written; the last line of the response is when it completed.
    o.completed_at = m.lastTs;
    o.model = { provider_id: PROVIDER, model_id: m.model };
    const usage = normalizeClaudeUsage(m.usage);
    o.usage = usage;
    const fe: Record<string, Epistemic> = {};
    if (o.completed_at) fe.completed_at = "INFERRED";
    if (m.model) fe.model = "OBSERVED";
    if (o.parent_ref) fe.parent_ref = "OBSERVED";
    for (const [k, v] of Object.entries(usage)) if (v !== null) fe[`usage.${k}`] = "OBSERVED";
    o.fields_epistemic = fe;
    raw.push(o);
  }

  // ---- hook spool ----
  let hooks: ClaudeHookAnalysis | null = null;
  if (input.hookSpool !== undefined) {
    const sp = parseClaudeHookSpool(input.hookSpool);
    const mine = sp.entries.filter((e) => e.session_id === sid);
    const foreignHooks = sp.entries.length - mine.length;
    if (foreignHooks > 0) limits.push(`${foreignHooks} hook entr(ies) from other sessions ignored`);
    if (sp.skipped.length > 0)
      limits.push(`${sp.skipped.length} hook spool line(s) skipped (truncated or invalid)`);
    if (sp.duplicates > 0) limits.push(`${sp.duplicates} duplicate hook spool line(s) dropped`);
    if (mine.length === 0) limits.push("hook spool has no usable entries for this session");
    else hooks = analyzeClaudeHooks(mine);
  }
  const hookTools = new Map((hooks?.tools ?? []).map((t) => [t.callId, t]));

  // ---- tool calls: tool_use paired with tool_result (+ hook timing) ----
  const uses = new Map<string, ClaudeToolUse>();
  for (const p of parsed) for (const u of p.toolUses) if (!uses.has(u.id)) uses.set(u.id, u);
  const results = new Map<string, ClaudeToolResult>();
  for (const p of parsed)
    for (const r of p.toolResults) if (!results.has(r.toolUseId)) results.set(r.toolUseId, r);
  const toolObs: ObservationRecord[] = [];
  interface ToolTiming {
    start: number | null;
    end: number | null;
    fromHook: boolean;
  }
  const timings: ToolTiming[] = [];
  let noResult = 0;
  for (const u of uses.values()) {
    const res = results.get(u.id);
    const h = hookTools.get(u.id);
    const o = skeleton(`tool:${u.id}`, "TOOL_CALL", taskRef, sid);
    o.tool = { call_id: u.id, name: u.name };
    o.fields_epistemic.tool = "OBSERVED";
    if (u.sidechain) {
      o.parent_ref = `claude:agent:${u.agentId ?? "unknown"}`;
      o.fields_epistemic.parent_ref = "OBSERVED";
    }
    if (h?.inputClass != null) {
      o.tool.input_class = h.inputClass;
      o.fields_epistemic["tool.input_class"] = "INFERRED";
    }
    o.started_at = u.ts ?? h?.startedAt ?? null;
    o.completed_at = res?.ts ?? h?.completedAt ?? null;
    if (o.started_at) o.fields_epistemic.started_at = "INFERRED";
    if (o.completed_at) o.fields_epistemic.completed_at = "OBSERVED";
    const s = isoMs(o.started_at);
    const e = isoMs(o.completed_at);
    let fromHook = false;
    if (h?.durationMs != null) {
      o.duration_ms = h.durationMs;
      o.fields_epistemic.duration_ms = "OBSERVED";
      fromHook = true;
    } else if (s !== null && e !== null && e >= s) {
      o.duration_ms = e - s;
      o.fields_epistemic.duration_ms = "INFERRED";
    }
    if (h?.status === "interrupt") o.status = "interrupt";
    else if (res) o.status = res.denied ? "denied" : res.isError === true ? "failure" : "success";
    else if (h && h.status !== "UNKNOWN") o.status = h.status;
    else {
      o.status = "NO_RESULT";
      noResult += 1;
    }
    o.fields_epistemic.status = "OBSERVED";
    if (o.duration_ms !== null && e !== null) {
      timings.push({ start: e - o.duration_ms, end: e, fromHook });
    } else timings.push({ start: null, end: null, fromHook: false });
    toolObs.push(o);
  }
  raw.push(...toolObs);
  if (hooks) {
    const unmatched = hooks.tools.filter((t) => !uses.has(t.callId)).length;
    if (unmatched > 0)
      limits.push(`${unmatched} hook tool call(s) not found in the transcript (not flushed yet?)`);
  }

  // ---- turns -> RUN_BOUNDARY ----
  const mainMessages = messages.filter((m) => !m.sidechain);
  const mainResults = [...results.values()].filter(
    (r) => uses.get(r.toolUseId)?.sidechain !== true,
  );
  const seenPrompt = new Set<string>();
  const prompts = parsed
    .flatMap((p) => p.prompts)
    .filter((p) => {
      const k = `${p.ts}|${p.promptId}`;
      if (seenPrompt.has(k)) return false;
      seenPrompt.add(k);
      return true;
    });
  const turns = buildTurns(prompts, mainMessages, mainResults);
  for (const t of turns) {
    const o = skeleton(`turn:${sid}:${t.index}`, "RUN_BOUNDARY", taskRef, sid);
    o.step_ref = String(t.index);
    o.started_at = iso(t.startMs);
    o.completed_at = t.status === "OPEN" ? null : iso(t.endMs);
    o.duration_ms = o.completed_at !== null && t.endMs !== null ? t.endMs - t.startMs : null;
    o.status = t.status;
    o.fields_epistemic.started_at = "OBSERVED";
    if (o.completed_at) o.fields_epistemic.completed_at = "INFERRED";
    if (o.duration_ms !== null) o.fields_epistemic.duration_ms = "INFERRED";
    o.fields_epistemic.status = "INFERRED";
    raw.push(o);
  }
  const openTurns = turns.filter((t) => t.status === "OPEN").length;

  const deduped = dedupeObservations(raw);
  const observations = deduped.unique;
  const effectiveReqs = latestRevisions(observations.filter((o) => o.kind === "MODEL_REQUEST"));
  const effectiveTools = latestRevisions(observations.filter((o) => o.kind === "TOOL_CALL"));

  // ---- subagents ----
  const sideMessages = messages.filter((m) => m.sidechain);
  const agentIds = new Set<string>();
  let unknownAgent = false;
  for (const m of sideMessages) {
    if (m.agentId !== null) agentIds.add(m.agentId);
    else unknownAgent = true;
  }
  for (const u of uses.values()) if (u.sidechain && u.agentId !== null) agentIds.add(u.agentId);
  const invocations = [...uses.values()].filter(
    (u) => AGENT_TOOLS.has(u.name) && results.get(u.id)?.denied !== true,
  ).length;
  const missingAgents = Math.max(0, invocations - agentIds.size - (unknownAgent ? 1 : 0));
  if (missingAgents > 0) {
    limits.push(
      `${missingAgents} subagent invocation(s) without a transcript file; their requests are not included`,
    );
  }

  // ---- degradations ----
  const hasRejected = rejected.length > 0;
  if (hasRejected)
    limits.push(
      `${rejected.length} transcript line(s) rejected (truncated, malformed or unusable)`,
    );
  if (deduped.duplicates > 0)
    limits.push(`${deduped.duplicates} duplicate delivery record(s) dropped`);
  if (conflicts > 0)
    limits.push(
      `${conflicts} message(s) had repeated lines with differing usage; the largest output_tokens line was kept`,
    );
  if (openTurns > 0)
    limits.push(`${openTurns} turn(s) without completion (session may still be running)`);
  if (noResult > 0) limits.push(`${noResult} tool call(s) without a tool_result line`);
  const noUsage = messages.filter((m) => m.usage.output === null).length;
  if (noUsage > 0) limits.push(`${noUsage} message(s) without usage`);
  const degraded = hasRejected || conflicts > 0 || deduped.revisions.length > 0 || noUsage > 0;
  const modelCov: Coverage = degraded ? "PARTIAL" : "COMPLETE";

  // ---- metrics ----
  const transcriptRef = `claude:transcript:${sid}`;
  const hookRef = `claude:hook-spool:${sid}`;
  const refs = [transcriptRef];
  const ctxs = new Map<string, Ctx>();
  const metrics: MetricValue[] = [];
  const reqTimes = effectiveReqs.map((r) => isoMs(r.completed_at));
  const turnStarts = turns.map((t) => t.startMs);
  const turnEnds = turns.map((t) => t.endMs);
  const modelWindow = windowId(sid, [...turnStarts, ...reqTimes], [...turnEnds, ...reqTimes]);
  const revision = Math.max(
    1,
    ...[...effectiveReqs, ...effectiveTools].map((r) => r.source_revision),
  );

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
      "model_requests",
      "subagent_requests",
    ]) {
      ctxs.set(n, {
        observation_id: transcriptRef,
        window_id: modelWindow,
        kind: "COUNTER_DELTA",
      });
    }
    metrics.push(
      metric("model_requests", effectiveReqs.length, "count", "OBSERVED", modelCov, refs),
      metric(
        "subagent_requests",
        effectiveReqs.filter((r) => r.parent_ref !== null).length,
        "count",
        "OBSERVED",
        missingAgents > 0 ? "PARTIAL" : modelCov,
        refs,
      ),
      metric("input_tokens", inTok.value, "tokens", "OBSERVED", cov(inTok.partial), refs),
      metric("output_tokens", outTok.value, "tokens", "OBSERVED", cov(outTok.partial), refs),
      metric("cache_read_tokens", cr.value, "tokens", "OBSERVED", cov(cr.partial), refs),
      metric("cache_write_tokens", cw.value, "tokens", "OBSERVED", cov(cw.partial), refs),
      metric("reasoning_tokens", rs.value, "tokens", "OBSERVED", cov(rs.partial), refs),
    );
  } else {
    for (const [n, u] of [
      ["model_requests", "count"],
      ["subagent_requests", "count"],
      ["input_tokens", "tokens"],
      ["output_tokens", "tokens"],
      ["cache_read_tokens", "tokens"],
      ["cache_write_tokens", "tokens"],
      ["reasoning_tokens", "tokens"],
    ] as const) {
      metrics.push(metric(n, null, u, "UNKNOWN", "UNKNOWN", []));
    }
  }
  const toolCount = effectiveTools.length;
  if (haveUsage || toolCount > 0) {
    ctxs.set("tool_calls", {
      observation_id: transcriptRef,
      window_id: modelWindow,
      kind: "COUNTER_DELTA",
    });
    const failures = effectiveTools.filter((o) => o.status === "failure").length;
    const toolCov: Coverage = noResult > 0 || missingAgents > 0 ? "PARTIAL" : modelCov;
    ctxs.set("tool_failures", {
      observation_id: transcriptRef,
      window_id: modelWindow,
      kind: "COUNTER_DELTA",
    });
    metrics.push(
      metric("tool_calls", toolCount, "count", "OBSERVED", toolCov, refs),
      metric("tool_failures", failures, "count", "OBSERVED", toolCov, refs),
    );
  } else {
    metrics.push(
      metric("tool_calls", null, "count", "UNKNOWN", "UNKNOWN", []),
      metric("tool_failures", null, "count", "UNKNOWN", "UNKNOWN", []),
    );
  }
  metrics.push(metric("model_wall_ms", null, "ms", "UNKNOWN", "UNKNOWN", []));

  const spans = timings
    .filter(
      (t): t is { start: number; end: number; fromHook: boolean } =>
        t.start !== null && t.end !== null,
    )
    .map((t) => [t.start, t.end] as [number, number]);
  if (toolCount > 0) {
    const untimed = timings.length - spans.length;
    const allHook = timings.length > 0 && timings.every((t) => t.fromHook);
    ctxs.set("tool_wall_ms", {
      observation_id: transcriptRef,
      window_id: windowId(
        sid,
        spans.map((s) => s[0]),
        spans.map((s) => s[1]),
      ),
      kind: "COUNTER_DELTA",
    });
    metrics.push(
      metric(
        "tool_wall_ms",
        spans.length > 0 ? unionIntervalMs(spans) : null,
        "ms",
        allHook ? "OBSERVED" : "INFERRED",
        untimed > 0 || hasRejected ? "PARTIAL" : modelCov,
        refs,
      ),
    );
    if (untimed > 0) limits.push(`${untimed} tool call(s) without start/end times`);
  }

  const turnWindows: Array<[number, number]> = [];
  for (const t of turns)
    if (t.status !== "OPEN" && t.endMs !== null) turnWindows.push([t.startMs, t.endMs]);
  ctxs.set("run_wall_ms", {
    observation_id: transcriptRef,
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
      "INFERRED",
      openTurns === 0 && !hasRejected && turns.every((t) => t.endMs !== null)
        ? "COMPLETE"
        : "PARTIAL",
      refs,
    ),
  );
  if (hooks) {
    ctxs.set("hook_events", {
      observation_id: hookRef,
      window_id: modelWindow,
      kind: "COUNTER_DELTA",
    });
    metrics.push(metric("hook_events", hooks.events, "count", "OBSERVED", "COMPLETE", [hookRef]));
  }
  const withIdentity = metrics.map((m) => ({
    ...m,
    identity: identityFor(sid, m, ctxs.get(m.name), revision),
  }));

  limits.push(
    "model_wall_ms unknown: the transcript has no per-request timing",
    "cost unknown (no billed cost exposed)",
    "input_tokens normalized to the inclusive convention (input + cache read + cache write); Anthropic input_tokens alone excludes cache",
  );

  // ---- run segment and source sha ----
  const allFinished = turns.length > 0 && openTurns === 0 && turnEnds.every((e) => e !== null);
  const firstMsgMs = reqTimes.filter((x): x is number => x !== null);
  const run: RunRecord = {
    started_at:
      turnStarts.length > 0
        ? iso(Math.min(...turnStarts))
        : firstMsgMs.length > 0
          ? iso(Math.min(...firstMsgMs))
          : null,
    finished_at: allFinished
      ? iso(Math.max(...turnEnds.filter((x): x is number => x !== null)))
      : null,
    exit_code: null,
    head_before: hooks?.headBefore ?? null,
    head_after: hooks?.headAfter ?? null,
  };
  const sourceSha = hooks?.headAfter ?? null;
  if (sourceSha === null) {
    limits.push(
      "source SHA at the end of the session not witnessed (the transcript carries no commit)",
    );
  } else if (hooks?.dirtyAfter === true) {
    limits.push(
      "working tree was dirty at the last Stop hook; source_sha may not contain all work",
    );
  }
  if (hooks && hooks.stops === 0 && hooks.sessionEnds === 0)
    limits.push("hook spool has no Stop or SessionEnd entry");

  let capture: Coverage;
  if (!haveUsage && turns.length === 0) capture = "UNKNOWN";
  else if (haveUsage && !degraded && openTurns === 0 && missingAgents === 0) capture = "COMPLETE";
  else capture = "PARTIAL";

  const observationRefs = [transcriptRef];
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
    profile: claudeCapability(providerVersion, hooks ? hooks.plugin : null),
    observations,
    summary,
    rejected,
    limits: summary.limits,
    sessionId: sid,
    run,
  };
}
