import {
  buildAttemptSummary,
  dedupeObservations,
  latestRevisions,
  sortRunSegments,
  witnessedHead,
} from "../../correlate.ts";
import type {
  ActorRef,
  AttemptSummary,
  Epistemic,
  ObservationRecord,
  SourceCapabilityProfile,
  TokenUsage,
} from "../../model.ts";
import { ZCODE_CAPABILITY } from "./capability.ts";
import {
  type ModelIoRecord,
  parseGateLog,
  parseHeadlessResult,
  parseModelIo,
  parseRunRecord,
} from "./parse.ts";

export { ZCODE_CAPABILITY } from "./capability.ts";

export interface ZcodeRunInput {
  repository: string;
  issue_number: number;
  actor: ActorRef;
  observed_at: string;
  headless?: string;
  modelIo?: string;
  /** Single run.txt (same as runRecords with one element). */
  runRecord?: string;
  /** All run.txt segments of a (possibly resumed) session. */
  runRecords?: string[];
  gateLog?: string;
  /** Explicit commit the gate log is bound to; when absent the run record's head_after is used. */
  gateSha?: string;
}

export interface ZcodeCollection {
  profile: SourceCapabilityProfile;
  observations: ObservationRecord[];
  summary: AttemptSummary;
  rejected: { line: number; reason: string }[];
  limits: string[];
}

const ADAPTER = "zcode";

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

function modelRequestObservation(
  m: ModelIoRecord,
  taskRef: string,
  runRef: string,
): ObservationRecord {
  const o = skeleton(`${m.requestId}#${m.attempt}`, "MODEL_REQUEST", taskRef, runRef);
  o.step_ref = m.turnId;
  o.logical_call_ref = m.requestId;
  o.physical_attempt_ref = `${m.requestId}#${m.attempt}`;
  o.started_at = m.startedAt;
  o.completed_at = m.completedAt;
  o.duration_ms = m.durationMs;
  o.model = { provider_id: m.providerId, model_id: m.modelId };
  const usage: TokenUsage = {
    input_tokens: m.usage.inputTokens,
    output_tokens: m.usage.outputTokens,
    cache_read_tokens: m.usage.cacheReadTokens,
    cache_write_tokens: m.usage.cacheWriteTokens,
    reasoning_tokens: null,
    total_tokens: m.usage.totalTokens,
  };
  o.usage = usage;
  o.status = m.finishReason;
  const fe: Record<string, Epistemic> = {};
  if (o.step_ref) fe.step_ref = "OBSERVED";
  if (m.startedAt) fe.started_at = "OBSERVED";
  if (m.completedAt) fe.completed_at = "OBSERVED";
  if (m.durationMs !== null) fe.duration_ms = "OBSERVED";
  if (m.modelId || m.providerId) fe.model = "OBSERVED";
  for (const [k, v] of Object.entries(usage)) {
    if (v !== null) fe[`usage.${k}`] = "OBSERVED";
  }
  if (m.finishReason) fe.status = "OBSERVED";
  o.fields_epistemic = fe;
  return o;
}

export function collectZcodeRun(input: ZcodeRunInput): ZcodeCollection {
  const headless = input.headless !== undefined ? parseHeadlessResult(input.headless) : null;
  const parsedIo = input.modelIo !== undefined ? parseModelIo(input.modelIo) : null;
  const limits: string[] = [];

  const sessionId = headless?.sessionId ?? parsedIo?.records[0]?.sessionId ?? null;
  if (!sessionId) {
    throw new Error("zcode adapter: no session id (neither headless result nor model-io provided)");
  }

  const taskRef = `${input.repository}#${input.issue_number}`;
  const ioRecords = (parsedIo?.records ?? []).filter((r) => r.sessionId === sessionId);
  const foreign = (parsedIo?.records.length ?? 0) - ioRecords.length;
  if (foreign > 0) limits.push(`${foreign} model_io line(s) from other sessions ignored`);
  const rejected = parsedIo?.rejected ?? [];

  const runTexts = [
    ...(input.runRecord !== undefined ? [input.runRecord] : []),
    ...(input.runRecords ?? []),
  ];
  const runs = sortRunSegments(runTexts.map((t) => parseRunRecord(t)));
  const gateSubject = input.gateSha ?? witnessedHead(runs) ?? null;
  const gate = parseGateLog(input.gateLog ?? "", gateSubject);
  if (input.gateLog !== undefined && gate.exitCode === 0 && !gate.greenMarker) {
    limits.push("gate log has EXIT=0 but no task-check green marker");
  }

  const raw: ObservationRecord[] = [];
  raw.push(...ioRecords.map((m) => modelRequestObservation(m, taskRef, sessionId)));

  if (headless) {
    const o = skeleton(
      `session:${sessionId}:${headless.turnId ?? "none"}`,
      "SESSION_SUMMARY",
      taskRef,
      sessionId,
    );
    o.step_ref = headless.turnId;
    const u = headless.usage;
    o.usage = {
      input_tokens: u.inputTokens,
      output_tokens: u.outputTokens,
      cache_read_tokens: u.cacheReadTokens,
      cache_write_tokens: u.cacheWriteTokens,
      reasoning_tokens: null,
      total_tokens: u.totalTokens,
    };
    for (const [k, v] of Object.entries(o.usage)) {
      if (v !== null) o.fields_epistemic[`usage.${k}`] = "SELF_REPORTED";
    }
    raw.push(o);
  }

  for (const [idx, run] of runs.entries()) {
    if (!(run.started_at || run.finished_at || run.exit_code !== null)) continue;
    const o = skeleton(
      runs.length === 1 ? `run:${sessionId}` : `run:${sessionId}:${idx + 1}`,
      "RUN_BOUNDARY",
      taskRef,
      sessionId,
    );
    o.started_at = run.started_at;
    o.completed_at = run.finished_at;
    if (run.started_at && run.finished_at) {
      const d = Date.parse(run.finished_at) - Date.parse(run.started_at);
      if (d >= 0) o.duration_ms = d;
    }
    if (run.exit_code !== null) o.status = `EXIT_${run.exit_code}`;
    if (o.started_at) o.fields_epistemic.started_at = "OBSERVED";
    if (o.completed_at) o.fields_epistemic.completed_at = "OBSERVED";
    if (o.duration_ms !== null) o.fields_epistemic.duration_ms = "OBSERVED";
    if (o.status) o.fields_epistemic.status = "OBSERVED";
    raw.push(o);
  }

  if (gate.exitCode !== null) {
    const o = skeleton(
      `verifier:${sessionId}:${gateSubject ?? "unbound"}`,
      "VERIFIER_RESULT",
      taskRef,
      sessionId,
    );
    o.status = gate.outcome.status;
    o.fields_epistemic.status = gate.outcome.epistemic;
    raw.push(o);
  }

  // Dedupe model requests first so tool calls derive only from the effective revision.
  const first = dedupeObservations(raw);
  const effective = latestRevisions(first.unique.filter((o) => o.kind === "MODEL_REQUEST"));
  const byId = new Map(ioRecords.map((m) => [`${ADAPTER}:${m.requestId}#${m.attempt}`, m]));
  const seenTools = new Set<string>();
  const tools: ObservationRecord[] = [];
  for (const req of effective) {
    const m = byId.get(req.observation_id);
    if (!m) continue;
    for (const tc of m.toolCalls) {
      if (seenTools.has(tc.id)) continue;
      seenTools.add(tc.id);
      const o = skeleton(`tool:${tc.id}`, "TOOL_CALL", taskRef, sessionId);
      o.step_ref = m.turnId;
      o.parent_ref = req.observation_id;
      o.tool = { call_id: tc.id, name: tc.name };
      o.fields_epistemic.tool = "OBSERVED";
      if (tc.inputClass !== undefined) {
        o.tool.input_class = tc.inputClass;
        o.fields_epistemic["tool.input_class"] = "INFERRED";
      }
      tools.push(o);
    }
  }
  const observations = [...first.unique, ...tools];

  const summary = buildAttemptSummary({
    repository: input.repository,
    issue_number: input.issue_number,
    actor: input.actor,
    observed_at: input.observed_at,
    sessionId,
    observations,
    headless,
    modelIoSupplied: parsedIo !== null,
    runs,
    gate: gate.outcome,
    rejectedCount: rejected.length,
    duplicates: first.duplicates,
    revisions: first.revisions,
    limits: [...limits, "reasoning tokens unknown", "cost unknown (no billed cost exposed)"],
  });

  return {
    profile: ZCODE_CAPABILITY,
    observations,
    summary,
    rejected,
    limits: summary.limits,
  };
}
