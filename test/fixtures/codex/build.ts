// Synthetic Codex rollout builder modelled on the record shapes of a real desktop-app session
// (session_meta / task_started / turn_context / response_item / event_msg / token_usage_record).
// Every free-text, argument, output, path and account field carries a planted SENTINEL.

export const SENTINELS = [
  "SENTINEL_INSTR_1a2b",
  "SENTINEL_CWD_4c1d",
  "SENTINEL_BRANCH_77aa",
  "SENTINEL_USER_7f3a",
  "SENTINEL_AGENT_91bc",
  "SENTINEL_REASON_c0de",
  "SENTINEL_CODE_3d2e",
  "SENTINEL_OUTPUT_8812",
  "SENTINEL_CMD_55aa",
  "SENTINEL_ARGS_0042",
  "SENTINEL_FILE_6e6e",
  "SENTINEL_PLAN_9e9e",
  "SENTINEL_ACCOUNT_b1b1",
  "SENTINEL_LASTMSG_d0d0",
  "ghp_SENTINELSENTINEL1234",
  "C:\\Users\\someone",
];

export const SID = "01a1aaaa-1111-7222-8333-444455556666";
export const CHILD_SUFFIX = "01a1bbbb-1111-7222-8333-444455556666";
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

export interface Usage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export const usage = (input: number, cached: number, output: number, reasoning = 0): Usage => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});

export const add = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  cached_input_tokens: a.cached_input_tokens + b.cached_input_tokens,
  cache_write_input_tokens: a.cache_write_input_tokens + b.cache_write_input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  reasoning_output_tokens: a.reasoning_output_tokens + b.reasoning_output_tokens,
  total_tokens: a.total_tokens + b.total_tokens,
});

export const ZERO: Usage = usage(0, 0, 0, 0);

/** ISO timestamp `s` seconds after 2026-10-22T10:00:00Z (+ ms). */
export const T = (s: number, ms = 0): string =>
  new Date(Date.UTC(2026, 9, 22, 10, 0, s, ms)).toISOString();
const EPOCH_S = (s: number): number => Math.floor(Date.UTC(2026, 9, 22, 10, 0, s) / 1000);
const EPOCH_MS = (s: number, ms = 0): number => Date.UTC(2026, 9, 22, 10, 0, s, ms);

let ordinal = 0;
export function resetOrdinal(to = 0): void {
  ordinal = to;
}
export const rec = (type: string, payload: unknown, ts: string, metadata?: unknown): string =>
  JSON.stringify({
    timestamp: ts,
    ordinal: ordinal++,
    type,
    payload,
    ...(metadata !== undefined ? { metadata } : {}),
  });

export interface MetaOpts {
  id?: string;
  commit?: string | null;
  historyBase?: { thread_id: string; end_ordinal_exclusive: number } | null;
}

export function sessionMeta(o: MetaOpts = {}): string {
  const id = o.id ?? SID;
  return rec(
    "session_meta",
    {
      creator_user_id: "SENTINEL_ACCOUNT_b1b1",
      creator_account_id: "SENTINEL_ACCOUNT_b1b1",
      session_id: id,
      id,
      timestamp: T(0),
      cwd: "C:\\Users\\someone\\SENTINEL_CWD_4c1d",
      runtime_workspace_roots: ["C:\\Users\\someone\\SENTINEL_CWD_4c1d"],
      originator: "Codex Desktop",
      cli_version: "0.163.0-alpha.11",
      source: "vscode",
      thread_source: "user",
      model_provider: "openai",
      base_instructions: { text: "SENTINEL_INSTR_1a2b", provenance: {} },
      history_mode: "paginated",
      ...(o.historyBase ? { history_base: o.historyBase } : {}),
      git: {
        ...(o.commit === null ? {} : { commit_hash: o.commit ?? COMMIT }),
        branch: "SENTINEL_BRANCH_77aa",
        repository_url: "https://github.com/kaicreator-mm/task-meta.git",
      },
    },
    T(0),
  );
}

export function turnStart(turn: string, s: number, trigger = "composer"): string[] {
  return [
    rec(
      "event_msg",
      {
        type: "task_started",
        turn_attribution: { turn_id: turn, turn_trigger: trigger, root_turn_id: turn },
        turn_id: turn,
        root_turn_id: turn,
        started_at: EPOCH_S(s),
        model_context_window: 475000,
      },
      T(s),
    ),
    rec(
      "turn_context",
      {
        turn_id: turn,
        cwd: "C:\\Users\\someone\\SENTINEL_CWD_4c1d",
        model: "gpt-test-1",
        effort: "low",
        summary: "SENTINEL_REASON_c0de",
      },
      T(s, 5),
    ),
    rec(
      "response_item",
      {
        type: "message",
        id: `m-${turn}`,
        role: "user",
        content: [{ type: "input_text", text: "SENTINEL_USER_7f3a" }],
        internal_chat_message_metadata_passthrough: { turn_id: turn },
      },
      T(s, 6),
    ),
  ];
}

export function turnEnd(
  turn: string,
  startS: number,
  endS: number,
  kind: "task_complete" | "turn_aborted" = "task_complete",
): string {
  return rec(
    "event_msg",
    {
      type: kind,
      root_turn_id: turn,
      turn_id: turn,
      ...(kind === "task_complete"
        ? { last_agent_message: "SENTINEL_LASTMSG_d0d0", time_to_first_token_ms: 900 }
        : { reason: "interrupted" }),
      started_at: EPOCH_S(startS),
      completed_at: EPOCH_S(endS),
      duration_ms: (endS - startS) * 1000 + 250,
    },
    T(endS),
  );
}

export function toolCall(
  callId: string,
  turn: string,
  s: number,
  opts: { output?: boolean; outS?: number; kind?: "custom" | "function" } = {},
): string[] {
  const fn = opts.kind === "function";
  const out = [
    rec(
      "response_item",
      fn
        ? {
            type: "function_call",
            status: "completed",
            id: `fc-${callId}`,
            name: "sleep",
            namespace: "SENTINEL_ARGS_0042",
            arguments: '{"x":"SENTINEL_ARGS_0042"}',
            call_id: callId,
            internal_chat_message_metadata_passthrough: { turn_id: turn },
          }
        : {
            type: "custom_tool_call",
            id: `ct-${callId}`,
            status: "completed",
            call_id: callId,
            name: "exec",
            input: "run('SENTINEL_CODE_3d2e')",
            internal_chat_message_metadata_passthrough: { turn_id: turn },
          },
      T(s),
    ),
  ];
  if (opts.output !== false) {
    out.push(
      rec(
        "response_item",
        fn
          ? {
              type: "function_call_output",
              id: `fo-${callId}`,
              call_id: callId,
              output: "SENTINEL_OUTPUT_8812",
            }
          : {
              type: "custom_tool_call_output",
              id: `co-${callId}`,
              call_id: callId,
              output: [{ type: "input_text", text: "SENTINEL_OUTPUT_8812" }],
            },
        T(opts.outS ?? s + 2),
      ),
    );
  }
  return out;
}

export function commandItem(
  id: string,
  turn: string,
  startS: number,
  endS: number,
  exitCode: number,
): string {
  return rec(
    "event_msg",
    {
      type: "item_completed",
      thread_id: SID,
      turn_id: turn,
      item: {
        type: "CommandExecution",
        id,
        process_id: "1",
        command: ["bash", "-lc", "SENTINEL_CMD_55aa"],
        cwd: "C:\\Users\\someone\\SENTINEL_CWD_4c1d",
        parsed_cmd: [{ type: "unknown", cmd: "SENTINEL_CMD_55aa" }],
        source: "unified_exec_startup",
        status: exitCode === 0 ? "completed" : "failed",
        aggregated_output: "SENTINEL_OUTPUT_8812",
        exit_code: exitCode,
        duration: { secs: endS - startS, nanos: 0 },
      },
      started_at_ms: EPOCH_MS(startS),
      completed_at_ms: EPOCH_MS(endS),
    },
    T(endS),
  );
}

export function otherItems(turn: string, s: number): string[] {
  return [
    rec(
      "event_msg",
      {
        type: "item_completed",
        thread_id: SID,
        turn_id: turn,
        item: {
          type: "McpToolCall",
          id: `mcp-${turn}`,
          server: "github",
          tool: "search_issues",
          arguments: { query: "SENTINEL_ARGS_0042" },
          status: "failed",
          result: { content: [{ type: "text", text: "SENTINEL_OUTPUT_8812" }], isError: true },
          duration: { secs: 0, nanos: 90000000 },
        },
        started_at_ms: EPOCH_MS(s),
        completed_at_ms: EPOCH_MS(s, 90),
      },
      T(s, 100),
    ),
    rec(
      "event_msg",
      {
        type: "item_completed",
        thread_id: SID,
        turn_id: turn,
        item: {
          type: "FileChange",
          id: `fc-${turn}`,
          changes: {
            "C:\\Users\\someone\\SENTINEL_FILE_6e6e.txt": {
              type: "add",
              content: "SENTINEL_FILE_6e6e",
            },
          },
          status: "completed",
          stdout: "SENTINEL_OUTPUT_8812",
          stderr: "",
        },
        started_at_ms: EPOCH_MS(s, 10),
        completed_at_ms: EPOCH_MS(s, 15),
      },
      T(s, 120),
    ),
    rec(
      "response_item",
      {
        type: "reasoning",
        id: `r-${turn}`,
        summary: [],
        encrypted_content: "SENTINEL_REASON_c0de",
        internal_chat_message_metadata_passthrough: { turn_id: turn },
      },
      T(s, 130),
    ),
    rec(
      "response_item",
      {
        type: "message",
        id: `a-${turn}`,
        role: "assistant",
        content: [{ type: "output_text", text: "SENTINEL_AGENT_91bc" }],
        internal_chat_message_metadata_passthrough: { turn_id: turn },
      },
      T(s, 140),
    ),
  ];
}

export interface ReqOpts {
  responseId: string;
  turn: string;
  s: number;
  delta: Usage;
  /** Running thread total AFTER this response (null = omit thread_token_usage). */
  thread: Usage | null;
  /** Also emit the paired event_msg/token_count line (cumulative total + last delta). */
  tokenCount?: boolean;
  /** Emit ONLY a token_count line (no token_usage_record). */
  onlyTokenCount?: { withLast: boolean };
}

export function request(o: ReqOpts): string[] {
  const lines: string[] = [];
  if (!o.onlyTokenCount) {
    lines.push(
      rec(
        "token_usage_record",
        {
          thread_id: SID,
          turn_id: o.turn,
          session_id: SID,
          root_turn_id: o.turn,
          response_id: o.responseId,
          usage: o.delta,
          turn_token_usage: o.delta,
          ...(o.thread ? { thread_token_usage: o.thread } : {}),
        },
        T(o.s),
      ),
    );
  }
  if (o.tokenCount || o.onlyTokenCount) {
    lines.push(
      rec(
        "event_msg",
        {
          type: "token_count",
          info: {
            total_token_usage: o.thread ?? o.delta,
            ...(o.onlyTokenCount && !o.onlyTokenCount.withLast
              ? {}
              : { last_token_usage: o.delta }),
            model_context_window: 475000,
          },
          rate_limits: {
            limit_id: "codex",
            plan_type: "SENTINEL_PLAN_9e9e",
            primary: { used_percent: 19, window_minutes: 300, resets_at: 1792658571 },
          },
        },
        T(o.s, 1),
      ),
    );
  }
  return lines;
}

export const join = (...parts: Array<string | string[]>): string => `${parts.flat().join("\n")}\n`;

/** A complete two-turn session: 3 + 2 requests, 2 exec calls, command/MCP/file items. */
export function basicSession(): { text: string; total: Usage; deltas: Usage[] } {
  resetOrdinal();
  const d = [
    usage(1000, 800, 100, 20),
    usage(1500, 1200, 60, 0),
    usage(2000, 1900, 140, 40),
    usage(2500, 2400, 80, 10),
    usage(3000, 2900, 120, 0),
  ];
  let run = ZERO;
  const th = d.map((x) => {
    run = add(run, x);
    return run;
  });
  const text = join(
    sessionMeta(),
    turnStart("turn-1", 10),
    request({
      responseId: "resp-1",
      turn: "turn-1",
      s: 12,
      delta: d[0] as Usage,
      thread: th[0] as Usage,
      tokenCount: true,
    }),
    toolCall("call-1", "turn-1", 13, { outS: 15 }),
    commandItem("cmd-1", "turn-1", 13, 14, 0),
    commandItem("cmd-2", "turn-1", 13, 16, 1),
    request({
      responseId: "resp-2",
      turn: "turn-1",
      s: 17,
      delta: d[1] as Usage,
      thread: th[1] as Usage,
      tokenCount: true,
    }),
    toolCall("call-2", "turn-1", 18, { outS: 19, kind: "function" }),
    otherItems("turn-1", 18),
    request({
      responseId: "resp-3",
      turn: "turn-1",
      s: 20,
      delta: d[2] as Usage,
      thread: th[2] as Usage,
      tokenCount: true,
    }),
    turnEnd("turn-1", 10, 21),
    turnStart("turn-2", 30),
    request({
      responseId: "resp-4",
      turn: "turn-2",
      s: 32,
      delta: d[3] as Usage,
      thread: th[3] as Usage,
      tokenCount: true,
    }),
    request({
      responseId: "resp-5",
      turn: "turn-2",
      s: 34,
      delta: d[4] as Usage,
      thread: th[4] as Usage,
      tokenCount: true,
    }),
    turnEnd("turn-2", 30, 35),
  );
  return { text, total: run, deltas: d };
}
