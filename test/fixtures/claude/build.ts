// Synthetic Claude Code transcript builder modelled on the record shapes of real sessions
// (user / assistant / tool_result lines, one assistant line per content block repeating the same
// message.id + usage, subagent files with isSidechain + agentId). Every free-text, thinking,
// tool input/output, path, branch and attachment field carries a planted SENTINEL.

export const SENTINELS = [
  "SENTINEL_PROMPT_c1a0",
  "SENTINEL_THINK_c1a1",
  "SENTINEL_TEXT_c1a2",
  "SENTINEL_INPUT_c1a3",
  "SENTINEL_OUTPUT_c1a4",
  "SENTINEL_STDOUT_c1a5",
  "SENTINEL_FILE_c1a6",
  "SENTINEL_CWD_c1a7",
  "SENTINEL_BRANCH_c1a8",
  "SENTINEL_ATTACH_c1a9",
  "SENTINEL_SIG_c1aa",
  "SENTINEL_TITLE_c1ab",
  "ghp_SENTINELSENTINEL1234",
  "C:\\Users\\someone",
];

export const SID = "7c1d0000-aaaa-4bbb-8ccc-123456789abc";
export const AGENT = "aabbccddeeff00112";

/** ISO timestamp `s` seconds after 2026-10-22T10:00:00Z. */
export const T = (s: number): string => new Date(Date.UTC(2026, 9, 22, 10, 0, s)).toISOString();

export interface U {
  input: number;
  cr: number;
  cw: number;
  out: number;
  /** undefined = `output_tokens_details` absent. */
  thinking?: number | null;
}

export const usageObj = (u: U): Record<string, unknown> => ({
  input_tokens: u.input,
  cache_creation_input_tokens: u.cw,
  cache_read_input_tokens: u.cr,
  output_tokens: u.out,
  ...(u.thinking === undefined ? {} : { output_tokens_details: { thinking_tokens: u.thinking } }),
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: "standard",
  cache_creation: { ephemeral_1h_input_tokens: u.cw, ephemeral_5m_input_tokens: 0 },
});

export type Block = { t: "thinking" } | { t: "text" } | { t: "tool_use"; id: string; name: string };

export interface MsgOpts {
  id: string;
  req?: string;
  /** Seconds of the first block line; block i is written at t + i. */
  t: number;
  usage: U | null;
  blocks: Block[];
  stop?: string | null;
  model?: string;
  sidechain?: boolean;
  agentId?: string;
  session?: string;
  extra?: Record<string, unknown>;
}

const base = (o: { sidechain?: boolean; agentId?: string; session?: string }) => ({
  isSidechain: o.sidechain === true,
  ...(o.agentId ? { agentId: o.agentId } : {}),
  userType: "external",
  entrypoint: "cli",
  cwd: "C:\\Users\\someone\\SENTINEL_CWD_c1a7",
  sessionId: o.session ?? SID,
  version: "2.1.261",
  gitBranch: "SENTINEL_BRANCH_c1a8",
});

let uuidN = 0;
const uuid = (): string => `u-${++uuidN}`;

/** One JSONL line per content block, all repeating the message id, request id and usage. */
export function msg(o: MsgOpts): string[] {
  return o.blocks.map((b, i) => {
    let block: Record<string, unknown>;
    if (b.t === "thinking") {
      block = { type: "thinking", thinking: "SENTINEL_THINK_c1a1", signature: "SENTINEL_SIG_c1aa" };
    } else if (b.t === "text") {
      block = { type: "text", text: "SENTINEL_TEXT_c1a2" };
    } else {
      block = {
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: {
          command: "SENTINEL_INPUT_c1a3",
          file_path: "C:\\Users\\someone\\SENTINEL_FILE_c1a6",
        },
        caller: { type: "direct" },
      };
    }
    return JSON.stringify({
      parentUuid: null,
      ...base(o),
      message: {
        model: o.model ?? "claude-opus-5-5",
        id: o.id,
        type: "message",
        role: "assistant",
        content: [block],
        stop_reason: o.stop === undefined ? "end_turn" : o.stop,
        stop_sequence: null,
        ...(o.usage === null ? {} : { usage: usageObj(o.usage) }),
        ...o.extra,
      },
      requestId: o.req ?? `req_${o.id}`,
      type: "assistant",
      uuid: uuid(),
      timestamp: T(o.t + i),
    });
  });
}

export function prompt(
  t: number,
  o: { sidechain?: boolean; agentId?: string; session?: string; meta?: boolean } = {},
): string {
  return JSON.stringify({
    parentUuid: null,
    ...base(o),
    promptId: `p-${t}`,
    type: "user",
    message: { role: "user", content: "SENTINEL_PROMPT_c1a0" },
    ...(o.meta ? { isMeta: true } : {}),
    uuid: uuid(),
    timestamp: T(t),
  });
}

export function toolResult(
  toolUseId: string,
  t: number,
  o: {
    isError?: boolean;
    denied?: boolean;
    sidechain?: boolean;
    agentId?: string;
    session?: string;
  } = {},
): string {
  return JSON.stringify({
    parentUuid: null,
    ...base(o),
    promptId: "p-x",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: "SENTINEL_OUTPUT_c1a4",
          ...(o.isError === undefined ? {} : { is_error: o.isError }),
        },
      ],
    },
    uuid: uuid(),
    timestamp: T(t),
    toolUseResult: {
      stdout: "SENTINEL_STDOUT_c1a5",
      filePath: "C:\\Users\\someone\\SENTINEL_FILE_c1a6",
    },
    sourceToolAssistantUUID: "u-0",
    ...(o.denied ? { toolDenialKind: "user_rejected" } : {}),
  });
}

/** Non-message record types real transcripts contain, carrying sentinels. */
export function noise(): string[] {
  return [
    JSON.stringify({
      type: "queue-operation",
      operation: "enqueue",
      timestamp: T(0),
      sessionId: SID,
      content: "SENTINEL_ATTACH_c1a9",
    }),
    JSON.stringify({ type: "custom-title", customTitle: "SENTINEL_TITLE_c1ab", sessionId: SID }),
    JSON.stringify({
      type: "attachment",
      attachment: { type: "x", content: "SENTINEL_ATTACH_c1a9" },
      timestamp: T(0),
      sessionId: SID,
    }),
    JSON.stringify({
      type: "file-history-snapshot",
      snapshot: { trackedFileBackups: { "C:\\Users\\someone\\SENTINEL_FILE_c1a6": {} } },
    }),
    JSON.stringify({ type: "cost-state", sessionId: SID, totalCostUSD: 12.5, modelUsage: {} }),
  ];
}

export const U1: U = { input: 10, cr: 1000, cw: 200, out: 50, thinking: 20 };
export const U2: U = { input: 5, cr: 1200, cw: 0, out: 30 }; // no output_tokens_details
export const U3: U = { input: 3, cr: 1300, cw: 10, out: 40, thinking: 10 };
export const U4: U = { input: 4, cr: 1400, cw: 20, out: 35, thinking: 7 };
export const US1: U = { input: 2, cr: 500, cw: 100, out: 25, thinking: 5 };
export const U5: U = { input: 1, cr: 1500, cw: 0, out: 45, thinking: 9 };

export interface Session {
  main: string;
  sub: string;
}

/** Two turns, one subagent. See test/claude-adapter.test.ts for the exact expected numbers. */
export function basicSession(): Session {
  const main = [
    ...noise(),
    prompt(0),
    ...msg({
      id: "msg_A1",
      t: 1,
      usage: U1,
      stop: "tool_use",
      blocks: [{ t: "thinking" }, { t: "text" }, { t: "tool_use", id: "toolu_1", name: "Bash" }],
    }),
    toolResult("toolu_1", 5),
    ...msg({
      id: "msg_A2",
      t: 6,
      usage: U2,
      stop: "tool_use",
      blocks: [{ t: "tool_use", id: "toolu_2", name: "Read" }],
    }),
    toolResult("toolu_2", 7, { isError: true }),
    ...msg({ id: "msg_A3", t: 8, usage: U3, blocks: [{ t: "thinking" }, { t: "text" }] }),
    prompt(60),
    ...msg({
      id: "msg_A4",
      t: 61,
      usage: U4,
      stop: "tool_use",
      blocks: [{ t: "tool_use", id: "toolu_3", name: "Agent" }],
    }),
    toolResult("toolu_3", 70),
    ...msg({ id: "msg_A5", t: 71, usage: U5, blocks: [{ t: "thinking" }, { t: "text" }] }),
  ].join("\n");
  const sub = [
    prompt(61, { sidechain: true, agentId: AGENT }),
    ...msg({
      id: "msg_S1",
      t: 62,
      usage: US1,
      stop: "tool_use",
      sidechain: true,
      agentId: AGENT,
      blocks: [{ t: "tool_use", id: "toolu_s1", name: "Grep" }],
    }),
    toolResult("toolu_s1", 63, { sidechain: true, agentId: AGENT, isError: false }),
  ].join("\n");
  return { main: `${main}\n`, sub: `${sub}\n` };
}
