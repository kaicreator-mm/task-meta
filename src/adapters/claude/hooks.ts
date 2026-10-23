// Ingestion of the Claude Code task-meta-capture hook spool (plugins/claude/task-meta-capture).
// Lines are `{"d":sha256(JCS(e)),"e":e}`, metadata only, schema `task-meta/claude-hook/v1`.
import type { BindingRef } from "../../binding/types.ts";
import { canonicalDigest } from "../../canonical.ts";
import { toRefs } from "../zcode/hooks.ts";

export const CLAUDE_HOOK_SCHEMA = "task-meta/claude-hook/v1";

export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStop",
  "SessionEnd",
  "PreCompact",
  "Notification",
] as const;
export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

export interface ClaudeHookEntry {
  schema: string;
  plugin_version: string;
  event: ClaudeHookEvent;
  session_id: string;
  /** Subagent id when the hook fired inside a subagent. */
  agent_id: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  received_at: string | null;
  mode: string | null;
  model: string | null;
  session_source: string | null;
  input_class: string | null;
  outcome: string | null;
  error_type: string | null;
  /** `duration_ms` reported by Claude Code on PostToolUse/PostToolUseFailure. */
  duration_ms: number | null;
  result_bytes: number | null;
  prompt_bytes: number | null;
  end_reason: string | null;
  git_head: string | null;
  git_dirty: boolean | null;
  git_remote_repo: string | null;
  cwd_digest: string | null;
  binding_refs: BindingRef[] | null;
  worktree_refs: Array<BindingRef & { source: "WORKTREE" | "BRANCH" }> | null;
}

export interface ClaudeHookSpoolParse {
  entries: ClaudeHookEntry[];
  skipped: { line: number; reason: string }[];
  duplicates: number;
}

const EVENTS = new Set<string>(CLAUDE_HOOK_EVENTS);
const SHA40 = /^[0-9a-f]{40}$/;
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

function toEntry(e: unknown): ClaudeHookEntry | null {
  if (typeof e !== "object" || e === null) return null;
  const o = e as Record<string, unknown>;
  if (o.schema !== CLAUDE_HOOK_SCHEMA || o.agent !== "claude") return null;
  if (typeof o.event !== "string" || !EVENTS.has(o.event)) return null;
  if (typeof o.session_id !== "string" || o.session_id === "") return null;
  const head = strOrNull(o.git_head);
  return {
    schema: o.schema,
    plugin_version: strOrNull(o.plugin_version) ?? "",
    event: o.event as ClaudeHookEvent,
    session_id: o.session_id,
    agent_id: strOrNull(o.agent_id),
    tool_call_id: strOrNull(o.tool_call_id),
    tool_name: strOrNull(o.tool_name),
    received_at: strOrNull(o.received_at),
    mode: strOrNull(o.mode),
    model: strOrNull(o.model),
    session_source: strOrNull(o.session_source),
    input_class: strOrNull(o.input_class),
    outcome: strOrNull(o.outcome),
    error_type: strOrNull(o.error_type),
    duration_ms: numOrNull(o.duration_ms),
    result_bytes: numOrNull(o.result_bytes),
    prompt_bytes: numOrNull(o.prompt_bytes),
    end_reason: strOrNull(o.end_reason),
    git_head: head !== null && SHA40.test(head) ? head : null,
    git_dirty: typeof o.git_dirty === "boolean" ? o.git_dirty : null,
    git_remote_repo: strOrNull(o.git_remote_repo),
    cwd_digest: strOrNull(o.cwd_digest),
    binding_refs: toRefs(o.binding_refs, false),
    worktree_refs: toRefs(o.worktree_refs, true) as ClaudeHookEntry["worktree_refs"],
  };
}

export function parseClaudeHookSpool(text: string): ClaudeHookSpoolParse {
  const entries: ClaudeHookEntry[] = [];
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

export interface ClaudeHookTool {
  callId: string;
  name: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Claude Code's own `duration_ms` (tool execution only; excludes permission wait). */
  durationMs: number | null;
  status: "success" | "failure" | "interrupt" | "UNKNOWN";
  inputClass: string | null;
}

export interface ClaudeHookAnalysis {
  plugin: string;
  events: number;
  tools: ClaudeHookTool[];
  stops: number;
  sessionEnds: number;
  /** git HEAD at the first SessionStart that carried one. */
  headBefore: string | null;
  /** git HEAD at the last Stop/SessionEnd that carried one. */
  headAfter: string | null;
  dirtyAfter: boolean | null;
  remoteRepo: string | null;
}

const ms = (s: string | null): number | null => {
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

export function analyzeClaudeHooks(entries: ClaudeHookEntry[]): ClaudeHookAnalysis {
  const byTime = [...entries].sort((a, b) => (ms(a.received_at) ?? 0) - (ms(b.received_at) ?? 0));
  const versions = [
    ...new Set(entries.map((e) => e.plugin_version).filter((v) => v !== "")),
  ].sort();
  const byId = new Map<string, { pre?: ClaudeHookEntry; post?: ClaudeHookEntry }>();
  for (const e of byTime) {
    if (e.tool_call_id === null) continue;
    if (e.event !== "PreToolUse" && e.event !== "PostToolUse" && e.event !== "PostToolUseFailure") {
      continue;
    }
    const rec = byId.get(e.tool_call_id) ?? {};
    const slot = e.event === "PreToolUse" ? "pre" : "post";
    rec[slot] ??= e;
    byId.set(e.tool_call_id, rec);
  }
  const tools: ClaudeHookTool[] = [];
  for (const [callId, r] of byId) {
    let status: ClaudeHookTool["status"] = "UNKNOWN";
    if (r.post) {
      status =
        r.post.event === "PostToolUse"
          ? "success"
          : r.post.outcome === "interrupt"
            ? "interrupt"
            : "failure";
    }
    const t0 = ms(r.pre?.received_at ?? null);
    const t1 = ms(r.post?.received_at ?? null);
    tools.push({
      callId,
      name: r.pre?.tool_name ?? r.post?.tool_name ?? null,
      startedAt: t0 === null ? null : new Date(t0).toISOString(),
      completedAt: t1 === null ? null : new Date(t1).toISOString(),
      durationMs: r.post?.duration_ms ?? null,
      status,
      inputClass: r.pre?.input_class ?? r.post?.input_class ?? null,
    });
  }
  const start = byTime.find((e) => e.event === "SessionStart" && e.git_head !== null);
  const ends = byTime.filter((e) => (e.event === "Stop" || e.event === "SessionEnd") && e.git_head);
  const end = ends[ends.length - 1];
  return {
    plugin: `task-meta-capture@${versions.length > 0 ? versions.join(",") : "unknown"}`,
    events: entries.length,
    tools,
    stops: entries.filter((e) => e.event === "Stop").length,
    sessionEnds: entries.filter((e) => e.event === "SessionEnd").length,
    headBefore: start?.git_head ?? null,
    headAfter: end?.git_head ?? null,
    dirtyAfter: end?.git_dirty ?? null,
    remoteRepo: end?.git_remote_repo ?? start?.git_remote_repo ?? null,
  };
}
