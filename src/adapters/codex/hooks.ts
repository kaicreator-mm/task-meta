// Ingestion of the Codex task-meta-capture hook spool (plugins/codex/task-meta-capture).
// Lines are `{"d":sha256(JCS(e)),"e":e}`, metadata only, schema `task-meta/codex-hook/v1`.
import { canonicalDigest } from "../../canonical.ts";

export const CODEX_HOOK_SCHEMA = "task-meta/codex-hook/v1";

export const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
  "Interrupt",
  "SubagentStart",
  "SubagentStop",
] as const;
export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];

export interface CodexHookEntry {
  schema: string;
  plugin_version: string;
  event: CodexHookEvent;
  session_id: string;
  turn_id: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  received_at: string | null;
  mode: string | null;
  model: string | null;
  session_source: string | null;
  input_class: string | null;
  outcome: string | null;
  exit_code: number | null;
  result_bytes: number | null;
  prompt_bytes: number | null;
  message_bytes: number | null;
  end_reason: string | null;
  git_head: string | null;
  git_dirty: boolean | null;
  git_remote_repo: string | null;
  cwd_digest: string | null;
}

export interface CodexHookSpoolParse {
  entries: CodexHookEntry[];
  skipped: { line: number; reason: string }[];
  duplicates: number;
}

const EVENTS = new Set<string>(CODEX_HOOK_EVENTS);
const SHA40 = /^[0-9a-f]{40}$/;
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function toEntry(e: unknown): CodexHookEntry | null {
  if (typeof e !== "object" || e === null) return null;
  const o = e as Record<string, unknown>;
  if (o.schema !== CODEX_HOOK_SCHEMA || o.agent !== "codex") return null;
  if (typeof o.event !== "string" || !EVENTS.has(o.event)) return null;
  if (typeof o.session_id !== "string" || o.session_id === "") return null;
  const head = strOrNull(o.git_head);
  return {
    schema: o.schema,
    plugin_version: strOrNull(o.plugin_version) ?? "",
    event: o.event as CodexHookEvent,
    session_id: o.session_id,
    turn_id: strOrNull(o.turn_id),
    tool_call_id: strOrNull(o.tool_call_id),
    tool_name: strOrNull(o.tool_name),
    received_at: strOrNull(o.received_at),
    mode: strOrNull(o.mode),
    model: strOrNull(o.model),
    session_source: strOrNull(o.session_source),
    input_class: strOrNull(o.input_class),
    outcome: strOrNull(o.outcome),
    exit_code: numOrNull(o.exit_code),
    result_bytes: numOrNull(o.result_bytes),
    prompt_bytes: numOrNull(o.prompt_bytes),
    message_bytes: numOrNull(o.message_bytes),
    end_reason: strOrNull(o.end_reason),
    git_head: head !== null && SHA40.test(head) ? head : null,
    git_dirty: typeof o.git_dirty === "boolean" ? o.git_dirty : null,
    git_remote_repo: strOrNull(o.git_remote_repo),
    cwd_digest: strOrNull(o.cwd_digest),
  };
}

export function parseCodexHookSpool(text: string): CodexHookSpoolParse {
  const entries: CodexHookEntry[] = [];
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

export interface CodexHookAnalysis {
  plugin: string;
  events: number;
  /** Distinct tool call ids that reached PostToolUse. */
  toolCalls: number;
  stops: number;
  /** git HEAD at the first SessionStart that carried one. */
  headBefore: string | null;
  /** git HEAD at the last Stop/SessionEnd that carried one. */
  headAfter: string | null;
  dirtyAfter: boolean | null;
  remoteRepo: string | null;
}

export function analyzeCodexHooks(entries: CodexHookEntry[]): CodexHookAnalysis {
  const byTime = [...entries].sort((a, b) => {
    const ta = a.received_at ? Date.parse(a.received_at) : 0;
    const tb = b.received_at ? Date.parse(b.received_at) : 0;
    return ta - tb;
  });
  const versions = [
    ...new Set(entries.map((e) => e.plugin_version).filter((v) => v !== "")),
  ].sort();
  const posts = new Set(
    entries.filter((e) => e.event === "PostToolUse" && e.tool_call_id).map((e) => e.tool_call_id),
  );
  const start = byTime.find((e) => e.event === "SessionStart" && e.git_head !== null);
  const ends = byTime.filter((e) => (e.event === "Stop" || e.event === "SessionEnd") && e.git_head);
  const end = ends[ends.length - 1];
  return {
    plugin: `task-meta-capture@${versions.length > 0 ? versions.join(",") : "unknown"}`,
    events: entries.length,
    toolCalls: posts.size,
    stops: entries.filter((e) => e.event === "Stop").length,
    headBefore: start?.git_head ?? null,
    headAfter: end?.git_head ?? null,
    dirtyAfter: end?.git_dirty ?? null,
    remoteRepo: end?.git_remote_repo ?? start?.git_remote_repo ?? null,
  };
}
