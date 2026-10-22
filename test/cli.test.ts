import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { main } from "../src/cli.ts";
import type { GitHubClient, IssueComment } from "../src/publish/index.ts";
import { parseReportComment } from "../src/report/index.ts";

const fxDir = join(import.meta.dirname, "fixtures", "zcode");
const fx = (n: string) => join(fxDir, n);
const REPO = "kaicreator-mm/task-meta";
const SHA = "0123456789abcdef0123456789abcdef01234567";
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
  const d = await mkdtemp(join(tmpdir(), "tm-cli-"));
  temps.push(d);
  return d;
}

async function exec(args: string[], client: GitHubClient = new FakeClient(), now = NOW) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    client,
    now: () => now,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr, json: stdout ? JSON.parse(stdout.trim()) : null };
}

function baseArgs(dir: string, extra: string[] = []): string[] {
  return [
    "collect",
    "--repo",
    REPO,
    "--issue",
    "7",
    "--headless",
    fx("headless.json.txt"),
    "--model-io",
    fx("model-io.jsonl"),
    "--run",
    fx("run.txt"),
    "--gate-log",
    fx("gate-pass.log"),
    "--gate-sha",
    SHA,
    "--store",
    join(dir, "store"),
    "--out",
    join(dir, "out", "report.md"),
    ...extra,
  ];
}

/** Remove a flag and its value. */
const dropFlag = (args: string[], flag: string): string[] =>
  args.filter((a, i, all) => a !== flag && all[i - 1] !== flag);

const countFiles = (d: string): number =>
  existsSync(d)
    ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length
    : 0;

test("dry run stores evidence, writes a valid report, makes zero create calls", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const r = await exec(baseArgs(dir), client);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome, "DRY_RUN");
  assert.equal(r.json.attempt_ref, "sess-synth-0001");
  assert.equal(r.json.capture_coverage, "COMPLETE");
  assert.match(r.json.manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(client.creates, 0);
  assert.ok(countFiles(join(dir, "store")) >= 4);
  const body = await readFile(join(dir, "out", "report.md"), "utf8");
  const p = parseReportComment(body);
  assert.ok(p.ok);
  assert.equal(p.profile, "v4");
  assert.equal(p.dataDigest, r.json.data_digest);
  assert.match(body, /\| model_requests \|/);
});

test("report body has no absolute paths and no raw content", async () => {
  const dir = await tmp();
  const r = await exec(baseArgs(dir));
  assert.equal(r.code, 0, r.stderr);
  const body = await readFile(join(dir, "out", "report.md"), "utf8");
  assert.ok(!/(^|[\s"'(])[A-Za-z]:[\\/](?!\/)/.test(body), "drive path");
  assert.ok(!/(^|\s)\/(home|Users|root|mnt|c)\//.test(body), "posix path");
  assert.ok(!body.includes("SENTINEL"));
  assert.ok(!body.includes(dir));
});

test("rerun with the same inputs is idempotent even when the clock moved", async () => {
  const dir = await tmp();
  const a = await exec(baseArgs(dir));
  const b = await exec(baseArgs(dir), new FakeClient(), new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(b.code, 0, b.stderr);
  assert.equal(b.json.outcome, "DRY_RUN");
  assert.equal(b.json.manifest.sha256, a.json.manifest.sha256);
  assert.equal(b.json.data_digest, a.json.data_digest);
});

test("changed input yields exit 4 and leaves the store untouched", async () => {
  const dir = await tmp();
  assert.equal((await exec(baseArgs(dir))).code, 0);
  const before = countFiles(join(dir, "store"));
  const changed = baseArgs(dir).map((a) => (a === fx("gate-pass.log") ? fx("gate-fail.log") : a));
  const r = await exec(changed);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /different revision 1/);
  assert.equal(countFiles(join(dir, "store")), before);
});

test("gate flags must be given together (exit 2)", async () => {
  const dir = await tmp();
  assert.equal((await exec(dropFlag(baseArgs(dir), "--gate-sha"))).code, 2);
  assert.equal((await exec(dropFlag(baseArgs(dir), "--gate-log"))).code, 2);
  assert.equal(countFiles(join(dir, "store")), 0);
});

test("other usage errors exit 2", async () => {
  const dir = await tmp();
  assert.equal((await exec(["bogus"])).code, 2);
  assert.equal((await exec(baseArgs(dir, ["--profile", "v9"]))).code, 2);
  assert.equal((await exec(baseArgs(dir, ["--nope"]))).code, 2);
  assert.equal((await exec(baseArgs(dir, ["--zcode-rollout-dir", dir]))).code, 2);
});

test("gate log binds only to --gate-sha, not to run.txt head_after", async () => {
  const dir = await tmp();
  const other = "f".repeat(40);
  const r = await exec(baseArgs(dir).map((a) => (a === SHA ? other : a)));
  assert.equal(r.code, 0, r.stderr);
  const p = parseReportComment(await readFile(join(dir, "out", "report.md"), "utf8"));
  assert.ok(p.ok);
  assert.equal((p.doc.data.verifier as { subject_sha: string }).subject_sha, other);
});

test("privacy violation exits 3 and stores nothing", async () => {
  const dir = await tmp();
  const r = await exec(baseArgs(dir, ["--operator-id", "C:\\Users\\someone\\secret"]));
  assert.equal(r.code, 3);
  assert.equal(countFiles(join(dir, "store")), 0);
  assert.ok(!existsSync(join(dir, "out", "report.md")));
});

test("headless without sessionId fails cleanly, nothing stored", async () => {
  const dir = await tmp();
  const bad = join(dir, "bad.json");
  await writeFile(bad, '{"response":"x"}\n');
  const args = dropFlag(
    baseArgs(dir).map((a) => (a === fx("headless.json.txt") ? bad : a)),
    "--model-io",
  );
  const r = await exec(args);
  assert.equal(r.code, 1);
  assert.equal(countFiles(join(dir, "store")), 0);
});

test("--zcode-rollout-dir resolves model-io by session id; missing file is a limit", async () => {
  const dir = await tmp();
  const rollout = join(dir, "rollout");
  await mkdir(rollout);
  await writeFile(
    join(rollout, "model-io-sess-synth-0001.jsonl"),
    await readFile(fx("model-io.jsonl"), "utf8"),
  );
  const a = await exec(dropFlag(baseArgs(dir, ["--zcode-rollout-dir", rollout]), "--model-io"));
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.capture_coverage, "COMPLETE");

  const dir2 = await tmp();
  const empty = join(dir2, "empty");
  await mkdir(empty);
  const b = await exec(dropFlag(baseArgs(dir2, ["--zcode-rollout-dir", empty]), "--model-io"));
  assert.equal(b.code, 0, b.stderr);
  assert.equal(b.json.capture_coverage, "PARTIAL");
  assert.match(await readFile(join(dir2, "out", "report.md"), "utf8"), /no model-io rollout/);
});

test("--publish: PUBLISHED then ALREADY_PUBLISHED", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const a = await exec(baseArgs(dir, ["--publish"]), client);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.outcome, "PUBLISHED");
  assert.equal(client.creates, 1);
  const b = await exec(baseArgs(dir, ["--publish"]), client);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(b.json.outcome, "ALREADY_PUBLISHED");
  assert.equal(client.creates, 1);
});

test("a differing report already on the issue yields CONFLICT, exit 7", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  assert.equal((await exec(baseArgs(dir, ["--publish"]), client)).code, 0);
  const c = client.comments[0] as IssueComment;
  c.body = c.body.replace("reasoning tokens unknown", "reasoning tokens unknown (edited)");
  const r = await exec(baseArgs(dir, ["--publish"]), client);
  assert.equal(r.code, 7);
  assert.equal(r.json.outcome, "CONFLICT");
  assert.equal(client.creates, 1);
});
