// Allowlist parser for Claude Code session transcripts:
// `~/.claude/projects/<slug>/<sessionId>.jsonl` plus subagent files
// `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`.
// One JSON object per line. Only ids, timestamps, model ids, tool names, token counters and the
// `is_error` flag are read. Message text, thinking, tool inputs/outputs (`toolUseResult`),
// attachments, cwd, git branch, signatures and every other field are never copied.
//
// One assistant API response is written as SEVERAL lines (one per content block) that repeat the
// same `message.id` and `usage`; `mergeClaudeMessages` folds them into one record per id.

export interface ClaudeUsage {
  /** Anthropic `input_tokens`: EXCLUDES cache reads and cache writes. */
  input: number | null;
  cacheRead: number | null;
  /** `cache_creation_input_tokens`. */
  cacheWrite: number | null;
  /** `output_tokens`; INCLUDES extended-thinking tokens. */
  output: number | null;
  /** `output_tokens_details.thinking_tokens` (a subset of `output`), when exposed. */
  thinking: number | null;
}

export interface ClaudeMessage {
  /** `message.id` (or `req:<requestId>` when the id is missing). */
  key: string;
  messageId: string | null;
  requestId: string | null;
  model: string | null;
  /** Timestamp of the first line carrying the id. */
  firstTs: string | null;
  /** Timestamp of the last line carrying the id. */
  lastTs: string | null;
  usage: ClaudeUsage;
  stopReason: string | null;
  sidechain: boolean;
  agentId: string | null;
  /** Number of transcript lines folded into this record. */
  lines: number;
  /** Repeated lines disagreed on usage; the line with the largest output_tokens was kept. */
  usageConflict: boolean;
  /** A client-side placeholder (`<synthetic>`, API error): no model request happened. */
  synthetic: boolean;
}

export interface ClaudeToolUse {
  id: string;
  name: string;
  ts: string | null;
  sidechain: boolean;
  agentId: string | null;
}

export interface ClaudeToolResult {
  toolUseId: string;
  ts: string | null;
  isError: boolean | null;
  denied: boolean;
}

export interface ClaudePrompt {
  ts: string | null;
  promptId: string | null;
}

export interface ClaudeParse {
  sessionId: string | null;
  /** Lines whose `sessionId` differs from the first one (not parsed further). */
  foreignSession: number;
  messages: ClaudeMessage[];
  toolUses: ClaudeToolUse[];
  toolResults: ClaudeToolResult[];
  prompts: ClaudePrompt[];
  /** Most frequent `version` field (Claude Code version), if present. */
  version: string | null;
  lines: number;
  rejected: { line: number; reason: string }[];
}

const IDENT_RE = /^[A-Za-z0-9_.:@/+<>-]{1,128}$/;
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

export const NULL_CLAUDE_USAGE: ClaudeUsage = {
  input: null,
  cacheRead: null,
  cacheWrite: null,
  output: null,
  thinking: null,
};

function usageOf(v: unknown): ClaudeUsage {
  if (!isObj(v)) return { ...NULL_CLAUDE_USAGE };
  const details = isObj(v.output_tokens_details) ? v.output_tokens_details : null;
  return {
    input: count(v.input_tokens),
    cacheRead: count(v.cache_read_input_tokens),
    cacheWrite: count(v.cache_creation_input_tokens),
    output: count(v.output_tokens),
    thinking: details === null ? null : count(details.thinking_tokens),
  };
}

const sameUsage = (a: ClaudeUsage, b: ClaudeUsage): boolean =>
  a.input === b.input &&
  a.cacheRead === b.cacheRead &&
  a.cacheWrite === b.cacheWrite &&
  a.output === b.output &&
  a.thinking === b.thinking;

const tsMs = (s: string | null): number => (s === null ? Number.NaN : Date.parse(s));

/**
 * Fold several records of the same message key (repeated lines, or the same message present in
 * several files) into one. Usage: the record with the largest `output_tokens` wins (streamed
 * partial lines can only grow); disagreement is flagged, never summed.
 */
export function mergeClaudeMessages(list: ClaudeMessage[]): ClaudeMessage[] {
  const byKey = new Map<string, ClaudeMessage>();
  for (const m of list) {
    const prev = byKey.get(m.key);
    if (prev === undefined) {
      byKey.set(m.key, { ...m });
      continue;
    }
    const conflict = prev.usageConflict || m.usageConflict || !sameUsage(prev.usage, m.usage);
    const better = (m.usage.output ?? -1) > (prev.usage.output ?? -1) ? m : prev;
    const first = tsMs(m.firstTs) < tsMs(prev.firstTs) ? m.firstTs : prev.firstTs;
    const last = tsMs(m.lastTs) > tsMs(prev.lastTs) ? m.lastTs : prev.lastTs;
    byKey.set(m.key, {
      ...prev,
      requestId: prev.requestId ?? m.requestId,
      messageId: prev.messageId ?? m.messageId,
      model: prev.model ?? m.model,
      firstTs: Number.isNaN(tsMs(first)) ? (prev.firstTs ?? m.firstTs) : first,
      lastTs: Number.isNaN(tsMs(last)) ? (prev.lastTs ?? m.lastTs) : last,
      usage: { ...better.usage },
      stopReason: better.stopReason ?? prev.stopReason ?? m.stopReason,
      sidechain: prev.sidechain || m.sidechain,
      agentId: prev.agentId ?? m.agentId,
      lines: prev.lines + m.lines,
      usageConflict: conflict,
      synthetic: prev.synthetic || m.synthetic,
    });
  }
  return [...byKey.values()];
}

export function parseClaudeTranscript(text: string): ClaudeParse {
  const out: ClaudeParse = {
    sessionId: null,
    foreignSession: 0,
    messages: [],
    toolUses: [],
    toolResults: [],
    prompts: [],
    version: null,
    lines: 0,
    rejected: [],
  };
  const versions = new Map<string, number>();
  const raw: ClaudeMessage[] = [];
  const lines = text.split("\n");
  const last = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).replace(/\r$/, "");
    if (line === "") continue;
    const n = i + 1;
    out.lines += 1;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      out.rejected.push({
        line: n,
        reason: i === last ? "truncated trailing line" : "invalid JSON",
      });
      continue;
    }
    if (!isObj(obj)) {
      out.rejected.push({ line: n, reason: "not an object" });
      continue;
    }
    const type = obj.type;
    if (type !== "assistant" && type !== "user") continue;
    const sid = ident(obj.sessionId);
    if (sid !== null) {
      if (out.sessionId === null) out.sessionId = sid;
      else if (sid !== out.sessionId) {
        out.foreignSession += 1;
        continue;
      }
    }
    const v = ident(obj.version);
    if (v !== null) versions.set(v, (versions.get(v) ?? 0) + 1);
    const ts = isoOrNull(obj.timestamp);
    const sidechain = obj.isSidechain === true;
    const agentId = ident(obj.agentId);
    const msg = isObj(obj.message) ? obj.message : null;
    if (msg === null) continue;
    const content = Array.isArray(msg.content) ? msg.content : null;

    if (type === "assistant") {
      const messageId = ident(msg.id);
      const requestId = ident(obj.requestId);
      const key = messageId ?? (requestId !== null ? `req:${requestId}` : null);
      if (key === null) {
        out.rejected.push({
          line: n,
          reason: "assistant line without message id",
        });
        continue;
      }
      const model = ident(msg.model);
      raw.push({
        key,
        messageId,
        requestId,
        model,
        firstTs: ts,
        lastTs: ts,
        usage: usageOf(msg.usage),
        stopReason: ident(msg.stop_reason),
        sidechain,
        agentId,
        lines: 1,
        usageConflict: false,
        synthetic: model === "<synthetic>" || obj.isApiErrorMessage === true,
      });
      for (const c of content ?? []) {
        if (!isObj(c) || c.type !== "tool_use") continue;
        const id = ident(c.id);
        const name = ident(c.name);
        if (id === null || name === null) {
          out.rejected.push({
            line: n,
            reason: "tool_use without usable id or name",
          });
          continue;
        }
        out.toolUses.push({ id, name, ts, sidechain, agentId });
      }
      continue;
    }

    // user line: tool results, or a human prompt
    let results = 0;
    for (const c of content ?? []) {
      if (!isObj(c) || c.type !== "tool_result") continue;
      results += 1;
      const toolUseId = ident(c.tool_use_id);
      if (toolUseId === null) {
        out.rejected.push({
          line: n,
          reason: "tool_result without tool_use_id",
        });
        continue;
      }
      out.toolResults.push({
        toolUseId,
        ts,
        isError: typeof c.is_error === "boolean" ? c.is_error : null,
        denied: typeof obj.toolDenialKind === "string",
      });
    }
    if (results === 0 && !sidechain && obj.isMeta !== true && obj.isCompactSummary !== true) {
      const human =
        typeof msg.content === "string" ||
        (content?.some((c) => isObj(c) && c.type === "text") ?? false);
      if (human) out.prompts.push({ ts, promptId: ident(obj.promptId) });
    }
  }
  out.messages = mergeClaudeMessages(raw);
  let best = 0;
  for (const [v, c] of versions) {
    if (c > best) {
      best = c;
      out.version = v;
    }
  }
  return out;
}
