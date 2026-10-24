import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type AutoReportGitHub, autoReportSession } from "../src/autoreport/index.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";
import { main } from "../src/cli.ts";
import type { IssueComment } from "../src/publish/index.ts";
import { parseReportComment } from "../src/report/index.ts";
import { basicSession, SENTINELS, SID } from "./fixtures/codex/build.ts";
import {
  fixtureGrantPolicy,
  ownerClearanceRef,
  ownerGrantComment,
} from "./fixtures/publication-grant.ts";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const PUB_SHA = "d".repeat(40);
const REPO = "kaicreator-mm/domain-harness";
const OWNER_LIMIT =
  "ADS v4.16 adopted from version/v4.16@3041a1b by project-owner authorization; not ADS-main qualified";
const NOW = new Date("2026-10-23T08:00:00.000Z");

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

const line = (e: unknown): string => `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
const WT = [
  { source: "WORKTREE", kind: "ISSUE", repo: "domain-harness", number: 1296 },
  { source: "BRANCH", kind: "ISSUE", repo: "domain-harness", number: 1296 },
];
function ent(over: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: "task-meta/codex-hook/v1",
    plugin_version: "0.2.0",
    agent: "codex",
    session_id: SID,
    turn_id: "turn-1",
    tool_call_id: null,
    tool_name: null,
    received_at: "2026-10-22T10:00:00.000Z",
    mode: "default",
    model: "gpt-test-1",
    session_source: null,
    input_class: null,
    outcome: null,
    exit_code: null,
    result_bytes: null,
    prompt_bytes: null,
    message_bytes: null,
    end_reason: null,
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    binding_refs: null,
    worktree_refs: null,
    cwd_digest: null,
    ...over,
  };
}
const GOOD_SPOOL = (): string =>
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
  ) +
  line(
    ent({
      event: "UserPromptSubmit",
      received_at: "2026-10-22T10:00:05.000Z",
      binding_refs: [{ kind: "ISSUE", repo: "domain-harness", number: 1296 }],
    }),
  ) +
  line(
    ent({
      event: "Stop",
      received_at: "2026-10-22T10:02:00.000Z",
      git_head: H2,
      git_dirty: false,
      git_remote_repo: REPO,
      worktree_refs: WT,
    }),
  );

class FakeGh implements AutoReportGitHub {
  comments: IssueComment[] = [];
  creates = 0;
  async listIssueComments(r: string, i: number, page: number, perPage: number) {
    const all = [ownerGrantComment(r, i), ...this.comments];
    const s = (page - 1) * perPage;
    return {
      comments: all.slice(s, s + perPage),
      hasNext: s + perPage < all.length,
    };
  }
  async verifyIssuePublicationPermission() {
    return true;
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

interface Env {
  root: string;
  config: string;
  spool: string;
  sessions: string;
  store: string;
  outbox: string;
}
async function setup(opts: { spool?: string; rollout?: boolean } = {}): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), "tm-autorep-codex-"));
  temps.push(root);
  const env: Env = {
    root,
    config: join(root, "auto-report.json"),
    spool: join(root, "codex-spool"),
    sessions: join(root, "sessions"),
    store: join(root, "store"),
    outbox: join(root, "outbox"),
  };
  const day = join(env.sessions, "2026", "10", "22");
  await mkdir(env.spool, { recursive: true });
  await mkdir(day, { recursive: true });
  await writeFile(
    env.config,
    JSON.stringify({
      enabled: true,
      clearance_ref: ownerClearanceRef(REPO, 1296),
      store: env.store,
      outbox: env.outbox,
      zcode: { spool_dir: join(root, "zcode-spool"), rollout_dir: join(root, "zcode-rollout") },
      codex: { spool_dir: env.spool, sessions_dir: env.sessions },
      gate_log_root: join(root, "gates"),
      publisher_source_sha: PUB_SHA,
    }),
  );
  if (opts.spool !== undefined) await writeFile(join(env.spool, `${SID}.jsonl`), opts.spool);
  if (opts.rollout !== false) {
    await writeFile(join(day, `rollout-2026-10-22T10-00-00-${SID}.jsonl`), basicSession().text);
  }
  return env;
}

const run = (env: Env, gh: FakeGh, over: Record<string, unknown> = {}) =>
  autoReportSession(
    { agent: "codex", session: SID, configPath: env.config, ...over },
    {
      client: gh,
      now: () => NOW,
      sleep: async () => {},
      settleMs: 0,
      env: {},
      publicationPolicy: fixtureGrantPolicy(),
    },
  );

async function allText(dir: string): Promise<string> {
  let acc = "";
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) acc += await readFile(join(e.parentPath, e.name), "utf8");
  }
  return acc;
}

test("auto-report --agent codex: PUBLISHED v5 to the bound Issue, then ALREADY_PUBLISHED", async () => {
  const env = await setup({ spool: GOOD_SPOOL() });
  const gh = new FakeGh();
  const r = await run(env, gh);
  assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
  assert.equal(gh.creates, 1);
  assert.equal(r.binding?.state, "RESOLVED");
  assert.equal(r.binding?.repository, REPO);
  assert.equal(r.binding?.issue_number, 1296);
  assert.equal(r.revision, 1);
  const p = parseReportComment(gh.comments[0]?.body ?? "");
  assert.ok(p.ok);
  assert.equal(p.profile, "v5");
  const d = p.doc.data as Record<string, unknown>;
  const subject = d.subject as Record<string, unknown>;
  assert.equal(subject.issue_ref, `https://github.com/${REPO}/issues/1296`);
  assert.equal(subject.source_sha, H2);
  assert.equal(subject.publisher_source_sha, PUB_SHA);
  assert.ok(!(d.limits as string[]).includes(OWNER_LIMIT));
  assert.equal(subject.ads_revision, "718fb02e33b31f568736447b2b905883cc6fcc3a");
  const metrics = d.metrics as Array<{ name: string; adapter_id: string }>;
  assert.ok(metrics.length > 0);
  assert.ok(metrics.every((m) => m.adapter_id === "codex"));
  assert.ok(metrics.some((m) => m.name === "model_requests"));

  const again = await run(env, gh);
  assert.equal(again.state, "ALREADY_PUBLISHED", again.reasons.join(";"));
  assert.equal(gh.creates, 1);
  assert.equal(again.data_digest, r.data_digest);

  // content-free end to end
  const stored = await allText(env.store);
  for (const s of SENTINELS) {
    assert.ok(!stored.includes(s), `store leaks ${s}`);
    assert.ok(!(gh.comments[0]?.body ?? "").includes(s), `report leaks ${s}`);
  }
});

test("codex: dry run publishes nothing; missing rollout and unbound sessions are HELD", async () => {
  const env = await setup({ spool: GOOD_SPOOL() });
  const gh = new FakeGh();
  const dry = await run(env, gh, { dryRun: true });
  assert.equal(dry.state, "DRY_RUN", dry.reasons.join(";"));
  assert.equal(gh.creates, 0);

  const noRollout = await setup({ spool: GOOD_SPOOL(), rollout: false });
  const h = await run(noRollout, gh);
  assert.equal(h.state, "HELD");
  assert.match(h.reasons.join(";"), /no rollout file/);

  const unbound = await setup({
    spool: line(
      ent({
        event: "SessionStart",
        session_source: "startup",
        received_at: "2026-10-22T10:00:00.000Z",
      }),
    ),
  });
  const u = await run(unbound, gh);
  assert.equal(u.state, "HELD");
  assert.equal(gh.creates, 0);
});

test("codex: the CLI entry accepts --agent codex and honours the kill switch", async () => {
  const env = await setup({ spool: GOOD_SPOOL() });
  const gh = new FakeGh();
  let out = "";
  const code = await main(
    ["auto-report", "--agent", "codex", "--session", SID, "--config", env.config],
    {
      client: gh,
      now: () => NOW,
      stdout: (s) => {
        out += s;
      },
      autoReport: { sleep: async () => {}, settleMs: 0, env: { TASK_META_AUTO_REPORT: "0" } },
    },
  );
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).state, "DISABLED");
  assert.equal(gh.creates, 0);
});
