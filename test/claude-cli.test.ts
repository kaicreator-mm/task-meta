import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { findClaudeTranscripts } from "../src/adapters/claude/find.ts";
import { CLAUDE_HOOK_SCHEMA } from "../src/adapters/claude/hooks.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";
import { main } from "../src/cli.ts";
import type { GitHubClient, IssueComment } from "../src/publish/index.ts";
import { parseReportComment } from "../src/report/index.ts";
import { basicSession, SENTINELS, SID, T } from "./fixtures/claude/build.ts";

const REPO = "kaicreator-mm/task-meta";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const NOW = new Date("2026-10-23T00:00:00.000Z");

class FakeClient implements GitHubClient {
  comments: IssueComment[] = [];
  creates = 0;
  async listIssueComments(_r: string, _i: number, page: number, perPage: number) {
    const start = (page - 1) * perPage;
    return {
      comments: this.comments.slice(start, start + perPage),
      hasNext: start + perPage < this.comments.length,
    };
  }
  async createIssueComment(_r: string, _i: number, body: string) {
    this.creates++;
    const c: IssueComment = {
      id: 1000 + this.creates,
      html_url: "https://example.invalid/c",
      body,
      user_login: "bot",
    };
    this.comments.push(c);
    return c;
  }
}

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-claude-cli-"));
  temps.push(d);
  return d;
}

const spoolLine = (event: string, s: number, extra: Record<string, unknown> = {}): string => {
  const e = {
    schema: CLAUDE_HOOK_SCHEMA,
    plugin_version: "0.2.2",
    agent: "claude",
    event,
    session_id: SID,
    received_at: T(s),
    git_head: null,
    git_dirty: null,
    ...extra,
  };
  return `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
};

/** projects/<slug>/<sid>.jsonl + projects/<slug>/<sid>/subagents/agent-x.jsonl + hook spool. */
async function layout(dir: string) {
  const s = basicSession();
  const slug = join(dir, "projects", "C--proj-slug");
  await mkdir(join(slug, SID, "subagents"), { recursive: true });
  await writeFile(join(slug, `${SID}.jsonl`), s.main);
  await writeFile(join(slug, SID, "subagents", "agent-aabbccddeeff00112.jsonl"), s.sub);
  const spool = join(dir, "spool");
  await mkdir(spool, { recursive: true });
  await writeFile(
    join(spool, `${SID}.jsonl`),
    spoolLine("SessionStart", 0, { git_head: HEAD, git_dirty: false }) +
      spoolLine("Stop", 72, { git_head: HEAD, git_dirty: false }),
  );
  return { projects: join(dir, "projects"), main: join(slug, `${SID}.jsonl`), spool, slug };
}

async function exec(args: string[], client: GitHubClient = new FakeClient()) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    client,
    now: () => NOW,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr, json: stdout ? JSON.parse(stdout.trim()) : null };
}

const countFiles = (d: string): number =>
  existsSync(d)
    ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length
    : 0;

test("findClaudeTranscripts: main transcript and subagent files across project dirs", async () => {
  const dir = await tmp();
  const l = await layout(dir);
  await mkdir(join(l.projects, "other-slug"), { recursive: true });
  await writeFile(join(l.projects, "other-slug", "unrelated.jsonl"), "{}\n");
  const f = await findClaudeTranscripts(l.projects, SID);
  assert.deepEqual(f.main, [l.main]);
  assert.equal(f.subagents.length, 1);
  assert.match(f.subagents[0] as string, /agent-aabbccddeeff00112\.jsonl$/);
  const none = await findClaudeTranscripts(l.projects, "no-such-session");
  assert.deepEqual(none, { main: [], subagents: [] });
  assert.deepEqual(await findClaudeTranscripts(join(dir, "missing"), SID), {
    main: [],
    subagents: [],
  });
});

test("collect-claude dry run from a projects dir: valid report, exact numbers, no content", async () => {
  const dir = await tmp();
  const l = await layout(dir);
  const client = new FakeClient();
  const r = await exec(
    [
      "collect-claude",
      "--repo",
      REPO,
      "--issue",
      "2",
      "--claude-projects-dir",
      l.projects,
      "--session-id",
      SID,
      "--claude-hook-spool",
      l.spool,
      "--store",
      join(dir, "store"),
      "--out",
      join(dir, "out", "report.md"),
      "--profile",
      "v4",
    ],
    client,
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome, "DRY_RUN");
  assert.equal(r.json.attempt_ref, SID);
  assert.equal(r.json.mode, "dry-run");
  assert.equal(client.creates, 0);
  assert.ok(countFiles(join(dir, "store")) >= 4);
  const body = await readFile(join(dir, "out", "report.md"), "utf8");
  const p = parseReportComment(body);
  assert.ok(p.ok);
  assert.match(body, /\| model_requests \| 6 count \|/);
  assert.match(body, /\| subagent_requests \| 1 count \|/);
  assert.match(body, /\| input_tokens \| 7255 tokens \|/);
  assert.match(body, /\| output_tokens \| 225 tokens \|/);
  assert.match(body, /\| model_wall_ms \| unknown \|/);
  for (const s of SENTINELS) assert.ok(!body.includes(s), `body leaks ${s}`);
  assert.ok(!body.includes(dir));
  for (const f of readdirSync(join(dir, "store"), { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue;
    const text = await readFile(join(f.parentPath, f.name), "utf8");
    for (const s of SENTINELS) assert.ok(!text.includes(s), `store leaks ${s}`);
  }
});

test("explicit --claude-transcript files give the same data as discovery; rerun is idempotent", async () => {
  const dir = await tmp();
  const l = await layout(dir);
  const sub = join(l.slug, SID, "subagents", "agent-aabbccddeeff00112.jsonl");
  const common = (store: string) => [
    "collect-claude",
    "--repo",
    REPO,
    "--issue",
    "2",
    "--store",
    join(dir, store),
    "--out",
    join(dir, "out", "r.md"),
    "--profile",
    "v4",
  ];
  const a = await exec([
    ...common("s1"),
    "--claude-transcript",
    l.main,
    "--claude-transcript",
    sub,
    "--claude-hook-spool",
    l.spool,
  ]);
  const b = await exec([
    ...common("s2"),
    "--claude-projects-dir",
    l.projects,
    "--session-id",
    SID,
    "--claude-hook-spool",
    l.spool,
  ]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(a.json.data_digest, b.json.data_digest);
  const c = await exec([
    ...common("s1"),
    "--claude-transcript",
    l.main,
    "--claude-transcript",
    sub,
    "--claude-hook-spool",
    l.spool,
  ]);
  assert.equal(c.json.manifest.sha256, a.json.manifest.sha256);
});

test("collect-claude --publish posts once (fake client), then ALREADY_PUBLISHED", async () => {
  const dir = await tmp();
  const l = await layout(dir);
  const client = new FakeClient();
  const args = [
    "collect-claude",
    "--repo",
    REPO,
    "--issue",
    "2",
    "--claude-projects-dir",
    l.projects,
    "--session-id",
    SID,
    "--claude-hook-spool",
    l.spool,
    "--store",
    join(dir, "store"),
    "--out",
    join(dir, "out", "r.md"),
    "--profile",
    "v4",
    "--publish",
  ];
  const a = await exec(args, client);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.outcome, "PUBLISHED");
  const b = await exec(args, client);
  assert.equal(b.json.outcome, "ALREADY_PUBLISHED");
  assert.equal(client.creates, 1);
});

test("collect-claude usage and failure modes", async () => {
  const dir = await tmp();
  const l = await layout(dir);
  const base = [
    "--repo",
    REPO,
    "--issue",
    "2",
    "--store",
    join(dir, "st"),
    "--out",
    join(dir, "o.md"),
    "--profile",
    "v4",
  ];
  assert.equal((await exec(["collect-claude", ...base])).code, 2);
  assert.equal(
    (await exec(["collect-claude", ...base, "--claude-projects-dir", l.projects])).code,
    2,
    "projects dir needs --session-id",
  );
  assert.equal(
    (await exec(["collect-claude", ...base, "--codex-session", l.main])).code,
    2,
    "codex options are not valid",
  );
  assert.equal(
    (await exec(["collect-claude", ...base, "--headless", l.main, "--claude-transcript", l.main]))
      .code,
    2,
  );
  assert.equal(
    (await exec(["collect-claude", ...base, "--claude-transcript", l.main, "--session-id", SID]))
      .code,
    2,
    "transcript excludes session-id",
  );
  assert.equal(
    (await exec(["collect", ...base, "--headless", l.main, "--claude-transcript", l.main])).code,
    2,
    "claude options only on collect-claude",
  );
  const missing = await exec([
    "collect-claude",
    ...base,
    "--claude-projects-dir",
    l.projects,
    "--session-id",
    "nope",
  ]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no transcript file found/);
  const bad = await exec([
    "collect-claude",
    ...base,
    "--claude-projects-dir",
    l.projects,
    "--session-id",
    "../x",
  ]);
  assert.equal(bad.code, 2);
});
