// T19 golden-set sampler (#16): deterministic, stratified sample of REAL tool-call events from the
// capture-plugin hook spools. Metadata only: output rows carry no session ids, timestamps or paths.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENTS = ["zcode", "claude", "codex"] as const;
export type GoldenAgent = (typeof AGENTS)[number];
export const SEED = "task-meta-golden-v0.2";
export const STRATUM_CAP = 15;

export interface GoldenRow {
  id: string;
  agent: GoldenAgent;
  tool_name: string;
  input_class: string | null;
  outcome: "success" | "failure" | "unknown";
  prev_tool: string | null;
  next_tool: string | null;
}

interface Call {
  session: string;
  callId: string;
  agent: GoldenAgent;
  tool_name: string;
  input_class: string | null;
  outcome: GoldenRow["outcome"];
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const label = (c: Pick<Call, "tool_name" | "input_class">): string =>
  c.input_class ? `${c.tool_name}:${c.input_class}` : c.tool_name;

/** Read one agent's spool dir into ordered calls (file order within a session = event order). */
export function readCalls(agent: GoldenAgent, dir: string): Call[] {
  if (!existsSync(dir)) return [];
  const out: Call[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
    const bySession = new Map<string, Map<string, Call>>();
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e: Record<string, unknown>;
      try {
        e = (JSON.parse(line) as { e?: Record<string, unknown> }).e ?? {};
      } catch {
        continue;
      }
      const session = e.session_id;
      const callId = e.tool_call_id;
      const tool = e.tool_name;
      if (typeof session !== "string" || typeof callId !== "string" || typeof tool !== "string") {
        continue;
      }
      let calls = bySession.get(session);
      if (!calls) {
        calls = new Map();
        bySession.set(session, calls);
      }
      const ic = typeof e.input_class === "string" ? e.input_class : null;
      if (e.event === "PreToolUse") {
        if (!calls.has(callId)) {
          const c: Call = {
            session,
            callId,
            agent,
            tool_name: tool,
            input_class: ic,
            outcome: "unknown",
          };
          calls.set(callId, c);
          out.push(c);
        }
      } else if (e.event === "PostToolUse" || e.event === "PostToolUseFailure") {
        const c = calls.get(callId);
        if (c) c.outcome = e.event === "PostToolUseFailure" || e.outcome === "failure" ? "failure" : "success";
      }
    }
  }
  return out;
}

export function buildSample(
  spoolDirs: Record<GoldenAgent, string>,
  opts: { seed?: string; cap?: number } = {},
): GoldenRow[] {
  const seed = opts.seed ?? SEED;
  const cap = opts.cap ?? STRATUM_CAP;
  const rows: GoldenRow[] = [];
  for (const agent of AGENTS) {
    const calls = readCalls(agent, spoolDirs[agent]);
    const bySession = new Map<string, Call[]>();
    for (const c of calls) {
      const l = bySession.get(c.session) ?? [];
      l.push(c);
      bySession.set(c.session, l);
    }
    const strata = new Map<string, GoldenRow[]>();
    for (const list of bySession.values()) {
      list.forEach((c, i) => {
        const prev = list[i - 1];
        const next = list[i + 1];
        const row: GoldenRow = {
          id: sha(`${c.session}${c.callId}`).slice(0, 12),
          agent,
          tool_name: c.tool_name,
          input_class: c.input_class,
          outcome: c.outcome,
          prev_tool: prev ? label(prev) : null,
          next_tool: next ? label(next) : null,
        };
        const key = `${c.tool_name}|${c.input_class ?? ""}`;
        const s = strata.get(key) ?? [];
        s.push(row);
        strata.set(key, s);
      });
    }
    for (const s of strata.values()) {
      const ranked = [...s].sort((a, b) => {
        const ka = sha(seed + a.id);
        const kb = sha(seed + b.id);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      rows.push(...ranked.slice(0, cap));
    }
  }
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => (a.agent === b.agent ? (a.id < b.id ? -1 : 1) : a.agent < b.agent ? -1 : 1));
}

function main(): void {
  const root = process.env.TASK_META_HOME ?? join(homedir(), ".task-meta");
  const dirs = Object.fromEntries(AGENTS.map((a) => [a, join(root, `${a}-spool`)])) as Record<
    GoldenAgent,
    string
  >;
  const rows = buildSample(dirs);
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "v0.2", "golden");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "sample.json"), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`golden sample: ${rows.length} rows`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
