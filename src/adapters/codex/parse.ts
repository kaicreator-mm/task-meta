// Allowlist parser for Codex (ChatGPT desktop "Codex & OWL") session rollouts:
// `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread id>[_<continuation id>].jsonl`.
// One JSON object per line: `{timestamp, ordinal, type, payload, metadata?}`.
// Only ids, timestamps, model ids, tool call ids/names, counters and exit codes are read.
// Message text, reasoning, tool arguments/outputs, instructions, file contents, rate limits,
// account ids and paths are never copied (cwd and the git remote are reduced to a digest and
// an `owner/name` pair).
import { sha256Hex } from "../../canonical.ts";

export interface CodexUsage {
  input: number | null;
  /** Subset of `input` served from the prompt cache (input INCLUDES cached). */
  cachedInput: number | null;
  cacheWrite: number | null;
  /** Total output tokens; INCLUDES reasoning output tokens. */
  output: number | null;
  reasoning: number | null;
  total: number | null;
}

export interface CodexSessionMeta {
  /** Thread id (`payload.id`); equals `session_id` on every observed rollout. */
  id: string;
  startedAt: string | null;
  originator: string | null;
  cliVersion: string | null;
  source: string | null;
  threadSource: string | null;
  modelProvider: string | null;
  gitCommit: string | null;
  /** `owner/name` parsed from the remote URL; never the URL itself. */
  gitRepo: string | null;
  cwdDigest: string | null;
  /** Present on continuation files: the file contains only lines after `endOrdinal` of the base. */
  historyBase: { threadId: string | null; endOrdinal: number | null } | null;
}

export interface CodexTurn {
  turnId: string;
  trigger: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  durationMs: number | null;
  timeToFirstTokenMs: number | null;
  status: "COMPLETED" | "ABORTED" | "OPEN";
  abortReason: string | null;
}

export interface CodexUsageRecord {
  responseId: string;
  turnId: string | null;
  ts: string | null;
  usage: CodexUsage;
  /** Running thread total at this record (may include earlier files of the thread). */
  threadTotal: CodexUsage | null;
  /** Which rollout line family produced it. */
  origin: "token_usage_record" | "token_count";
}

export interface CodexTokenCount {
  ts: string | null;
  turnId: string | null;
  total: CodexUsage | null;
  last: CodexUsage | null;
}

export interface CodexCall {
  callId: string;
  name: string;
  kind: "custom_tool_call" | "function_call";
  turnId: string | null;
  ts: string | null;
}

export interface CodexCallOutput {
  callId: string;
  ts: string | null;
}

/** An executed tool item (`event_msg/item_completed`): command, MCP call, file change, extension. */
export interface CodexItem {
  id: string;
  turnId: string | null;
  type: "CommandExecution" | "McpToolCall" | "FileChange" | "Extension";
  /** Tool-ish name: `CommandExecution`, `mcp:<server>/<tool>`, `FileChange`, `ext:<kind>`. */
  name: string;
  status: string | null;
  exitCode: number | null;
  isError: boolean | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
}

export interface CodexParse {
  session: CodexSessionMeta | null;
  /** session_meta lines whose id differs from the first one. */
  foreignSessionMeta: number;
  turns: CodexTurn[];
  models: Map<string, { model: string | null; effort: string | null }>;
  usageRecords: CodexUsageRecord[];
  tokenCounts: CodexTokenCount[];
  tokenCountsWithoutInfo: number;
  calls: CodexCall[];
  outputs: CodexCallOutput[];
  items: CodexItem[];
  lines: number;
  rejected: { line: number; reason: string }[];
}

const IDENT_RE = /^[A-Za-z0-9_.:@/+-]{1,128}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;

const ident = (v: unknown): string | null => (typeof v === "string" && IDENT_RE.test(v) ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const secToMs = (v: unknown): number | null => {
  const n = count(v);
  return n === null ? null : n * 1000;
};

/** `https://github.com/owner/name(.git)`, `git@github.com:owner/name.git` -> `owner/name`. */
export function repoNameFromRemote(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function usageOf(v: unknown): CodexUsage | null {
  if (!isObj(v)) return null;
  const u: CodexUsage = {
    input: count(v.input_tokens),
    cachedInput: count(v.cached_input_tokens),
    cacheWrite: count(v.cache_write_input_tokens),
    output: count(v.output_tokens),
    reasoning: count(v.reasoning_output_tokens),
    total: count(v.total_tokens),
  };
  return Object.values(u).every((x) => x === null) ? null : u;
}

function sessionMeta(p: Record<string, unknown>): CodexSessionMeta | null {
  const id = ident(p.id) ?? ident(p.session_id);
  if (id === null) return null;
  const git = isObj(p.git) ? p.git : {};
  const hb = isObj(p.history_base) ? p.history_base : null;
  const commit = typeof git.commit_hash === "string" ? git.commit_hash.toLowerCase() : "";
  return {
    id,
    startedAt: isoOrNull(p.timestamp),
    originator: ident(typeof p.originator === "string" ? p.originator.replace(/ /g, "_") : null),
    cliVersion: ident(p.cli_version),
    source: ident(p.source),
    threadSource: ident(p.thread_source),
    modelProvider: ident(p.model_provider),
    gitCommit: SHA40_RE.test(commit) ? commit : null,
    gitRepo: repoNameFromRemote(git.repository_url),
    cwdDigest: typeof p.cwd === "string" && p.cwd !== "" ? sha256Hex(p.cwd) : null,
    historyBase: hb
      ? { threadId: ident(hb.thread_id), endOrdinal: count(hb.end_ordinal_exclusive) }
      : null,
  };
}

function itemOf(payload: Record<string, unknown>): CodexItem | null {
  const it = payload.item;
  if (!isObj(it)) return null;
  const id = ident(it.id);
  if (id === null) return null;
  const startedAtMs = count(payload.started_at_ms);
  const completedAtMs = count(payload.completed_at_ms);
  const base = {
    id,
    turnId: ident(payload.turn_id),
    status: ident(it.status),
    startedAtMs,
    completedAtMs,
  };
  switch (it.type) {
    case "CommandExecution":
      return {
        ...base,
        type: "CommandExecution",
        name: "CommandExecution",
        exitCode:
          typeof it.exit_code === "number" && Number.isSafeInteger(it.exit_code)
            ? it.exit_code
            : null,
        isError: null,
      };
    case "McpToolCall": {
      const server = ident(it.server);
      const tool = ident(it.tool);
      const result = isObj(it.result) ? it.result : null;
      return {
        ...base,
        type: "McpToolCall",
        name: `mcp:${server ?? "unknown"}/${tool ?? "unknown"}`,
        exitCode: null,
        isError: result && typeof result.isError === "boolean" ? result.isError : null,
      };
    }
    case "FileChange":
      return { ...base, type: "FileChange", name: "FileChange", exitCode: null, isError: null };
    case "Extension":
      return {
        ...base,
        type: "Extension",
        name: `ext:${ident(it.kind) ?? "unknown"}`,
        exitCode: null,
        isError: null,
      };
    default:
      return null;
  }
}

export function parseCodexRollout(text: string): CodexParse {
  const out: CodexParse = {
    session: null,
    foreignSessionMeta: 0,
    turns: [],
    models: new Map(),
    usageRecords: [],
    tokenCounts: [],
    tokenCountsWithoutInfo: 0,
    calls: [],
    outputs: [],
    items: [],
    lines: 0,
    rejected: [],
  };
  const turnIndex = new Map<string, CodexTurn>();
  const turn = (id: string): CodexTurn => {
    let t = turnIndex.get(id);
    if (!t) {
      t = {
        turnId: id,
        trigger: null,
        startedAtMs: null,
        completedAtMs: null,
        durationMs: null,
        timeToFirstTokenMs: null,
        status: "OPEN",
        abortReason: null,
      };
      turnIndex.set(id, t);
      out.turns.push(t);
    }
    return t;
  };
  const rows = text.split("\n");
  for (let i = 0; i < rows.length; i++) {
    const raw = (rows[i] as string).replace(/\r$/, "");
    if (raw === "") continue;
    out.lines += 1;
    const n = i + 1;
    let rec: unknown;
    try {
      rec = JSON.parse(raw);
    } catch {
      out.rejected.push({
        line: n,
        reason: i === rows.length - 1 ? "truncated trailing line" : "invalid JSON",
      });
      continue;
    }
    if (!isObj(rec) || typeof rec.type !== "string" || !isObj(rec.payload)) {
      out.rejected.push({ line: n, reason: "not a rollout record" });
      continue;
    }
    const ts = isoOrNull(rec.timestamp);
    const p = rec.payload;
    const ptype = typeof p.type === "string" ? p.type : "";

    if (rec.type === "session_meta") {
      const sm = sessionMeta(p);
      if (!sm) out.rejected.push({ line: n, reason: "session_meta without id" });
      else if (out.session === null) out.session = sm;
      else if (sm.id !== out.session.id) out.foreignSessionMeta += 1;
    } else if (rec.type === "turn_context") {
      const id = ident(p.turn_id);
      if (id !== null) out.models.set(id, { model: ident(p.model), effort: ident(p.effort) });
    } else if (rec.type === "token_usage_record") {
      const responseId = ident(p.response_id);
      const usage = usageOf(p.usage);
      if (responseId === null || usage === null) {
        out.rejected.push({ line: n, reason: "token_usage_record without response id or usage" });
      } else {
        out.usageRecords.push({
          responseId,
          turnId: ident(p.turn_id),
          ts,
          usage,
          threadTotal: usageOf(p.thread_token_usage),
          origin: "token_usage_record",
        });
      }
    } else if (rec.type === "event_msg") {
      if (ptype === "task_started") {
        const id = ident(p.turn_id);
        if (id !== null) {
          const t = turn(id);
          t.startedAtMs = secToMs(p.started_at) ?? t.startedAtMs;
          const attr = isObj(p.turn_attribution) ? p.turn_attribution : {};
          t.trigger = ident(attr.turn_trigger) ?? t.trigger;
        }
      } else if (ptype === "task_complete" || ptype === "turn_aborted") {
        const id = ident(p.turn_id);
        if (id !== null) {
          const t = turn(id);
          t.startedAtMs = secToMs(p.started_at) ?? t.startedAtMs;
          t.completedAtMs = secToMs(p.completed_at);
          t.durationMs = count(p.duration_ms);
          t.timeToFirstTokenMs = count(p.time_to_first_token_ms);
          t.status = ptype === "task_complete" ? "COMPLETED" : "ABORTED";
          if (ptype === "turn_aborted") t.abortReason = ident(p.reason);
        }
      } else if (ptype === "token_count") {
        const info = isObj(p.info) ? p.info : null;
        if (!info) {
          out.tokenCountsWithoutInfo += 1;
        } else {
          out.tokenCounts.push({
            ts,
            turnId: null,
            total: usageOf(info.total_token_usage),
            last: usageOf(info.last_token_usage),
          });
        }
      } else if (ptype === "item_completed") {
        const item = itemOf(p);
        if (item) out.items.push(item);
      }
    } else if (rec.type === "response_item") {
      if (ptype === "custom_tool_call" || ptype === "function_call") {
        const callId = ident(p.call_id);
        const name = ident(p.name);
        if (callId === null || name === null) {
          out.rejected.push({ line: n, reason: "tool call without call id or name" });
        } else {
          const meta = isObj(p.internal_chat_message_metadata_passthrough)
            ? p.internal_chat_message_metadata_passthrough
            : {};
          out.calls.push({ callId, name, kind: ptype, turnId: ident(meta.turn_id), ts });
        }
      } else if (ptype === "custom_tool_call_output" || ptype === "function_call_output") {
        const callId = ident(p.call_id);
        if (callId !== null) out.outputs.push({ callId, ts });
      }
    }
  }
  return out;
}
