// Shared scaffolding for the Claude auto-report tests: a temp workspace (config, projects dir with
// a synthetic transcript, hook spool, store, outbox), a fake GitHub client and spool-line builders.
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type { AutoReportGitHub } from "../../../src/autoreport/index.ts";
import { canonicalDigest, canonicalize } from "../../../src/canonical.ts";
import type { IssueComment } from "../../../src/publish/index.ts";
import { basicSession, SID } from "./build.ts";

export const H1 = "a".repeat(40);
export const H2 = "b".repeat(40);
export const PUB_SHA = "d".repeat(40);
export const REPO = "kaicreator-mm/domain-harness";
export const NOW = new Date("2026-10-23T08:00:00.000Z");

export const line = (e: unknown): string =>
  `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;

const WT = [
  { source: "WORKTREE", kind: "ISSUE", repo: "domain-harness", number: 1296 },
  { source: "BRANCH", kind: "ISSUE", repo: "domain-harness", number: 1296 },
];

let seq = 0;
export function ent(over: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: "task-meta/claude-hook/v1",
    plugin_version: "0.2.1",
    agent: "claude",
    session_id: SID,
    agent_id: null,
    tool_call_id: null,
    tool_name: null,
    received_at: "2026-10-22T10:00:00.000Z",
    mode: "default",
    model: null,
    session_source: null,
    input_class: null,
    outcome: null,
    error_type: null,
    duration_ms: null,
    result_bytes: null,
    prompt_bytes: null,
    end_reason: null,
    binding_refs: null,
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    worktree_refs: null,
    cwd_digest: null,
    ...over,
  };
}

export const startLine = (): string =>
  line(
    ent({
      event: "SessionStart",
      session_source: "startup",
      received_at: "2026-10-22T10:00:00.000Z",
      git_head: H1,
      git_dirty: false,
      git_remote_repo: REPO,
      worktree_refs: WT,
    }),
  );
export const promptLine = (): string =>
  line(
    ent({
      event: "UserPromptSubmit",
      received_at: "2026-10-22T10:00:05.000Z",
      binding_refs: [{ kind: "ISSUE", repo: "domain-harness", number: 1296 }],
    }),
  );
/** A Stop line; `at` is seconds after 10:00:00 so every call is a distinct line. */
export const stopLine = (at = 72): string =>
  line(
    ent({
      event: "Stop",
      received_at: new Date(Date.UTC(2026, 9, 22, 10, 0, at)).toISOString(),
      git_head: H2,
      git_dirty: false,
      git_remote_repo: REPO,
      worktree_refs: WT,
    }),
  );
export const endLine = (at = 90): string =>
  line(
    ent({
      event: "SessionEnd",
      received_at: new Date(Date.UTC(2026, 9, 22, 10, 0, at)).toISOString(),
      end_reason: "other",
      git_head: H2,
      git_dirty: false,
    }),
  );
/** A late tool hook line: changes the collected data (hook_events) without being new activity. */
export const postToolLine = (): string =>
  line(
    ent({
      event: "PostToolUse",
      received_at: new Date(Date.UTC(2026, 9, 22, 10, 1, 30 + seq)).toISOString(),
      tool_call_id: `toolu_late_${++seq}`,
      tool_name: "Read",
      outcome: "success",
      duration_ms: 5,
    }),
  );
export const preToolLine = (): string =>
  line(
    ent({
      event: "PreToolUse",
      received_at: new Date(Date.UTC(2026, 9, 22, 10, 1, 40 + seq)).toISOString(),
      tool_call_id: `toolu_new_${++seq}`,
      tool_name: "Read",
    }),
  );

export const GOOD_SPOOL = (): string => startLine() + promptLine() + stopLine();

export class FakeGh implements AutoReportGitHub {
  comments: IssueComment[] = [];
  creates = 0;
  async listIssueComments(_r: string, _i: number, page: number, perPage: number) {
    const s = (page - 1) * perPage;
    return {
      comments: this.comments.slice(s, s + perPage),
      hasNext: s + perPage < this.comments.length,
    };
  }
  async createIssueComment(repo: string, issue: number, body: string) {
    this.creates++;
    const id = 1000 + this.creates;
    const c: IssueComment = {
      id,
      html_url: `https://github.com/${repo}/issues/${issue}#issuecomment-${id}`,
      body,
      user_login: "bot",
      created_at: "2026-10-23T08:00:00Z",
    };
    this.comments.push(c);
    return c;
  }
  async linkedIssuesOfPr() {
    return [];
  }
}

export interface Env {
  root: string;
  config: string;
  spool: string;
  spoolFile: string;
  projects: string;
  store: string;
  outbox: string;
}

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

export async function setup(
  opts: {
    spool?: string;
    transcript?: boolean;
    settleSeconds?: number;
    maxRevisions?: number;
  } = {},
): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), "tm-autorep-claude-"));
  temps.push(root);
  const env: Env = {
    root,
    config: join(root, "auto-report.json"),
    spool: join(root, "claude-spool"),
    spoolFile: join(root, "claude-spool", `${SID}.jsonl`),
    projects: join(root, "projects"),
    store: join(root, "store"),
    outbox: join(root, "outbox"),
  };
  await mkdir(env.spool, { recursive: true });
  await writeFile(
    env.config,
    JSON.stringify({
      enabled: true,
      clearance_ref: "owner-authorization:2026-10-23:kaicreator-mm/*",
      store: env.store,
      outbox: env.outbox,
      zcode: { spool_dir: join(root, "zcode-spool"), rollout_dir: join(root, "zcode-rollout") },
      codex: { spool_dir: join(root, "codex-spool"), sessions_dir: join(root, "codex-sessions") },
      claude: { spool_dir: env.spool, projects_dir: env.projects },
      settle_seconds: opts.settleSeconds ?? 0,
      max_revisions_per_session: opts.maxRevisions ?? 3,
      gate_log_root: join(root, "gates"),
      publisher_source_sha: PUB_SHA,
    }),
  );
  if (opts.spool !== undefined) await writeFile(env.spoolFile, opts.spool);
  if (opts.transcript !== false) {
    const s = basicSession();
    const slug = join(env.projects, "C--proj-slug");
    await mkdir(join(slug, SID, "subagents"), { recursive: true });
    await writeFile(join(slug, `${SID}.jsonl`), s.main);
    await writeFile(join(slug, SID, "subagents", "agent-aabbccddeeff00112.jsonl"), s.sub);
  }
  return env;
}

export const append = (env: Env, text: string): void => appendFileSync(env.spoolFile, text);

export async function allText(dir: string): Promise<string> {
  let acc = "";
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) acc += await readFile(join(e.parentPath, e.name), "utf8");
  }
  return acc;
}
