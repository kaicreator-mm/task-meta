// Ingestion of the task-meta-capture ZCode plugin spool (plugins/zcode/task-meta-capture).
// The spool holds metadata-only lifecycle entries; see DEFINITION §9.
import type { BindingRef, BindingSources } from "../../binding/types.ts";
import { canonicalDigest } from "../../canonical.ts";
import type { Epistemic, ObservationRecord } from "../../model.ts";

export const HOOK_SCHEMA = "task-meta/zcode-hook/v1";
export const CAPTURE_PLUGIN_NAME = "task-meta-capture";

export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop";

export interface HookEntry {
  schema: string;
  plugin_version: string;
  event: HookEvent;
  session_id: string;
  turn_id: string | null;
  trace_id: string | null;
  agent_name: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  hook_ts: string | null;
  received_at: string | null;
  mode: string | null;
  input_class: string | null;
  outcome: string | null;
  error_type: string | null;
  result_bytes: number | null;
  tool_call_count: number | null;
  session_source: string | null;
  model: string | null;
  prompt_bytes: number | null;
  cwd_digest: string | null;
  /** v0.2 fields (plugin >= 0.2.0); null/absent in 0.1.x lines. Refs only, never prompt text. */
  binding_refs?: BindingRef[] | null | undefined;
  git_head?: string | null | undefined;
  git_dirty?: boolean | null | undefined;
  git_remote_repo?: string | null | undefined;
  worktree_refs?: Array<BindingRef & { source: "WORKTREE" | "BRANCH" }> | null | undefined;
}

export interface HookSpoolParse {
  entries: HookEntry[];
  skipped: { line: number; reason: string }[];
  /** Identical lines delivered more than once (same digest); only the first is kept. */
  duplicates: number;
}

const EVENTS = new Set<string>([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
]);

const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const HEAD_RE = /^[0-9a-f]{40}$/;
const REMOTE_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_REFS = 64;

function toRefs(v: unknown, withSource: boolean): BindingRef[] | null {
  if (!Array.isArray(v)) return null;
  const out: BindingRef[] = [];
  for (const x of v.slice(0, MAX_REFS)) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    if (o.kind !== "ISSUE" && o.kind !== "PR" && o.kind !== "REPO") continue;
    const repo = typeof o.repo === "string" && o.repo.length <= 100 ? o.repo : null;
    const number =
      typeof o.number === "number" && Number.isSafeInteger(o.number) && o.number > 0
        ? o.number
        : null;
    const ref: BindingRef & { source?: string } = { kind: o.kind, repo, number };
    if (withSource) {
      if (o.source !== "WORKTREE" && o.source !== "BRANCH") continue;
      ref.source = o.source;
    }
    out.push(ref);
  }
  return out;
}

/** Allowlist projection: unknown fields in a spool line are never carried further. */
function toEntry(e: unknown): HookEntry | null {
  if (typeof e !== "object" || e === null) return null;
  const o = e as Record<string, unknown>;
  if (o.schema !== HOOK_SCHEMA) return null;
  if (typeof o.event !== "string" || !EVENTS.has(o.event)) return null;
  if (typeof o.session_id !== "string" || o.session_id === "") return null;
  return {
    schema: o.schema,
    plugin_version: strOrNull(o.plugin_version) ?? "",
    event: o.event as HookEvent,
    session_id: o.session_id,
    turn_id: strOrNull(o.turn_id),
    trace_id: strOrNull(o.trace_id),
    agent_name: strOrNull(o.agent_name),
    tool_call_id: strOrNull(o.tool_call_id),
    tool_name: strOrNull(o.tool_name),
    hook_ts: strOrNull(o.hook_ts),
    received_at: strOrNull(o.received_at),
    mode: strOrNull(o.mode),
    input_class: strOrNull(o.input_class),
    outcome: strOrNull(o.outcome),
    error_type: strOrNull(o.error_type),
    result_bytes: numOrNull(o.result_bytes),
    tool_call_count: numOrNull(o.tool_call_count),
    session_source: strOrNull(o.session_source),
    model: strOrNull(o.model),
    prompt_bytes: numOrNull(o.prompt_bytes),
    cwd_digest: strOrNull(o.cwd_digest),
    binding_refs: toRefs(o.binding_refs, false),
    git_head: typeof o.git_head === "string" && HEAD_RE.test(o.git_head) ? o.git_head : null,
    git_dirty: typeof o.git_dirty === "boolean" ? o.git_dirty : null,
    git_remote_repo:
      typeof o.git_remote_repo === "string" && REMOTE_RE.test(o.git_remote_repo)
        ? o.git_remote_repo
        : null,
    worktree_refs: toRefs(o.worktree_refs, true) as HookEntry["worktree_refs"],
  };
}

/**
 * Parse a hook spool file. Each line is `{"d":sha256(JCS(e)),"e":e}`; truncated last lines,
 * invalid JSON and digest mismatches are skipped (reported), identical re-deliveries dropped.
 */
export function parseHookSpool(text: string): HookSpoolParse {
  const entries: HookEntry[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const lines = text.split("\n");
  const last = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] as string).replace(/\r$/, "");
    if (raw === "") continue;
    const n = i + 1;
    if (i === last) {
      skipped.push({ line: n, reason: "truncated trailing line" });
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      skipped.push({ line: n, reason: "invalid JSON" });
      continue;
    }
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof (obj as { d?: unknown }).d !== "string" ||
      !("e" in obj)
    ) {
      skipped.push({ line: n, reason: "malformed line" });
      continue;
    }
    const { d, e } = obj as { d: string; e: unknown };
    let actual: string;
    try {
      actual = canonicalDigest(e);
    } catch {
      skipped.push({ line: n, reason: "entry not canonicalizable" });
      continue;
    }
    if (actual !== d) {
      skipped.push({ line: n, reason: "digest mismatch" });
      continue;
    }
    const entry = toEntry(e);
    if (!entry) {
      skipped.push({ line: n, reason: "unsupported entry" });
      continue;
    }
    if (seen.has(d)) {
      duplicates += 1;
      continue;
    }
    seen.add(d);
    entries.push(entry);
  }
  return { entries, skipped, duplicates };
}

export interface HookTool {
  callId: string;
  name: string | null;
  turnId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  status: "success" | "failure" | "interrupt" | "UNKNOWN";
  inputClass: string | null;
}

export interface HookSegment {
  index: number;
  source: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** SessionStart git HEAD (plugin >= 0.2.0), else null. */
  headBefore: string | null;
  /** HEAD of the latest Stop in the segment, else null. */
  headAfter: string | null;
  /** git_dirty of the latest Stop (null = unknown). */
  dirtyAfter: boolean | null;
}

export interface HookAnalysis {
  tools: HookTool[];
  segments: HookSegment[];
  /** Tool calls seen with more than one distinct Pre or Post entry (first one wins). */
  conflicting: number;
  /** `task-meta-capture@<versions seen in the spool>`; "unknown" when entries carry none. */
  plugin: string;
}

function ms(ts: string | null): number | null {
  if (ts === null) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

function iso(ts: string | null): string | null {
  const t = ms(ts);
  return t === null ? null : new Date(t).toISOString();
}

/** Pair Pre/Post hook entries per toolCallId and split the session into segments. */
export function analyzeHooks(entries: HookEntry[]): HookAnalysis {
  const byId = new Map<string, { pre?: HookEntry; post?: HookEntry; conflict: boolean }>();
  const segments: HookSegment[] = [];
  let cur: HookSegment | null = null;
  const open = (source: string | null, startedAt: string | null): HookSegment => {
    const s: HookSegment = {
      index: segments.length + 1,
      source,
      startedAt,
      completedAt: null,
      headBefore: null,
      headAfter: null,
      dirtyAfter: null,
    };
    segments.push(s);
    return s;
  };
  for (const e of entries) {
    if (e.event === "SessionStart") {
      cur = open(e.session_source, iso(e.hook_ts));
      cur.headBefore = e.git_head ?? null;
    } else if (e.event === "Stop") {
      cur ??= open(null, null);
      const t = iso(e.hook_ts);
      if (
        t !== null &&
        (cur.completedAt === null || Date.parse(t) >= Date.parse(cur.completedAt))
      ) {
        cur.completedAt = t;
        cur.headAfter = e.git_head ?? null;
        cur.dirtyAfter = e.git_dirty ?? null;
      } else if (t === null && cur.completedAt === null && cur.headAfter === null) {
        cur.headAfter = e.git_head ?? null;
        cur.dirtyAfter = e.git_dirty ?? null;
      }
    }
    if (e.tool_call_id === null) continue;
    if (e.event !== "PreToolUse" && e.event !== "PostToolUse" && e.event !== "PostToolUseFailure") {
      continue;
    }
    const rec = byId.get(e.tool_call_id) ?? { conflict: false };
    const slot = e.event === "PreToolUse" ? "pre" : "post";
    if (rec[slot]) rec.conflict = true;
    else rec[slot] = e;
    byId.set(e.tool_call_id, rec);
  }
  const tools: HookTool[] = [];
  let conflicting = 0;
  for (const [callId, r] of byId) {
    if (r.conflict) conflicting += 1;
    const startedAt = iso(r.pre?.hook_ts ?? null);
    const completedAt = iso(r.post?.hook_ts ?? null);
    const s = ms(startedAt);
    const c = ms(completedAt);
    let status: HookTool["status"] = "UNKNOWN";
    if (r.post) {
      status =
        r.post.event === "PostToolUse"
          ? "success"
          : r.post.outcome === "interrupt"
            ? "interrupt"
            : "failure";
    }
    tools.push({
      callId,
      name: r.pre?.tool_name ?? r.post?.tool_name ?? null,
      turnId: r.pre?.turn_id ?? r.post?.turn_id ?? null,
      startedAt,
      completedAt,
      durationMs: s !== null && c !== null && c >= s ? c - s : null,
      status,
      inputClass: r.pre?.input_class ?? r.post?.input_class ?? null,
    });
  }
  const versions = [
    ...new Set(entries.map((e) => e.plugin_version).filter((v) => v !== "")),
  ].sort();
  const plugin = `${CAPTURE_PLUGIN_NAME}@${versions.length > 0 ? versions.join("+") : "unknown"}`;
  return { tools, segments, conflicting, plugin };
}

/**
 * Merge hook-derived timing/status into a rollout-derived TOOL_CALL (same call id).
 * Precedence: the rollout record owns identity (tool name, step_ref, parent_ref) and its
 * input_class; hooks own started_at / completed_at / duration_ms / status. The input_class
 * from hooks fills in only when the rollout has none.
 */
export function mergeHookTool(base: ObservationRecord, h: HookTool): ObservationRecord {
  const o = { ...base, fields_epistemic: { ...base.fields_epistemic } };
  applyTiming(o, h);
  if (o.tool && o.tool.input_class === undefined && h.inputClass !== null) {
    o.tool = { ...o.tool, input_class: h.inputClass };
    o.fields_epistemic["tool.input_class"] = "INFERRED";
  }
  return o;
}

function applyTiming(o: ObservationRecord, h: HookTool): void {
  const fe: Record<string, Epistemic> = o.fields_epistemic;
  o.started_at = h.startedAt;
  o.completed_at = h.completedAt;
  o.duration_ms = h.durationMs;
  o.status = h.status;
  if (h.startedAt) fe.started_at = "OBSERVED";
  if (h.completedAt) fe.completed_at = "OBSERVED";
  if (h.durationMs !== null) fe.duration_ms = "OBSERVED";
  // An unpaired Pre has no known outcome: the status string is "UNKNOWN" and carries no provenance.
  if (h.status !== "UNKNOWN") fe.status = "OBSERVED";
}

/** A TOOL_CALL known only from hooks (no rollout record for that call id). */
export function hookOnlyTool(h: HookTool, skeleton: ObservationRecord): ObservationRecord {
  const o = { ...skeleton, fields_epistemic: { ...skeleton.fields_epistemic } };
  o.step_ref = h.turnId;
  o.tool = { call_id: h.callId, name: h.name ?? "unknown" };
  if (h.name !== null) o.fields_epistemic.tool = "OBSERVED";
  if (h.inputClass !== null) {
    o.tool.input_class = h.inputClass;
    o.fields_epistemic["tool.input_class"] = "INFERRED";
  }
  applyTiming(o, h);
  return o;
}

/**
 * Binding inputs from a parsed spool: prompt refs (UserPromptSubmit), worktree/branch refs and
 * the git remote (SessionStart/Stop). Normalized refs only. The caller supplies the inventory
 * to `resolveBinding`.
 */
export function bindingInputFromSpool(entries: HookEntry[]): BindingSources {
  const promptRefs: BindingRef[] = [];
  const worktreeRefs: BindingRef[] = [];
  const branchRefs: BindingRef[] = [];
  let gitRemoteRepo: string | null = null;
  const plain = (r: BindingRef): BindingRef => ({ kind: r.kind, repo: r.repo, number: r.number });
  for (const e of entries) {
    if (e.event === "UserPromptSubmit") {
      for (const r of e.binding_refs ?? []) promptRefs.push(plain(r));
    } else if (e.event === "SessionStart" || e.event === "Stop") {
      for (const r of e.worktree_refs ?? []) {
        (r.source === "BRANCH" ? branchRefs : worktreeRefs).push(plain(r));
      }
      if (e.git_remote_repo != null) gitRemoteRepo = e.git_remote_repo;
    }
  }
  const dedupe = (rs: BindingRef[]): BindingRef[] => {
    const seen = new Set<string>();
    return rs.filter((r) => {
      const k = `${r.kind}|${r.repo}|${r.number}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    promptRefs: dedupe(promptRefs),
    worktreeRefs: dedupe(worktreeRefs),
    branchRefs: dedupe(branchRefs),
    gitRemoteRepo,
  };
}
