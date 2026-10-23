import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { main } from "../src/cli.ts";
import { assertNoForbiddenContent } from "../src/privacy.ts";
import type { GitHubClient, IssueComment } from "../src/publish/index.ts";
import { parseReportComment } from "../src/report/index.ts";
import { EvidenceStore } from "../src/store/index.ts";

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
    // The default profile is v5 (owner-authorized); these v0.1 flows exercise v4 explicitly.
    "--profile",
    "v4",
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

test("--gate-sha without a single bare --gate-log is a usage error; bare --gate-log is allowed", async () => {
  const dir = await tmp();
  assert.equal((await exec(dropFlag(baseArgs(dir), "--gate-log"))).code, 2);
  const ok = await exec(dropFlag(baseArgs(dir), "--gate-sha"));
  assert.equal(ok.code, 0, ok.stderr);
  const dir2 = await tmp();
  const dup = baseArgs(dir2, ["--gate-log", `${fx("gate-pass.log")}@${SHA}`]);
  assert.equal((await exec(dup)).code, 2);
  assert.equal(countFiles(join(dir2, "store")), 0);
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

const CANDIDATE = "3041a1be3f130e5cc5e676c2e56a99882adfd97c";
const PUBLISHER_SHA = "b".repeat(40);
const v5Args = (dir: string, extra: string[] = []) =>
  dropFlag(dropFlag(baseArgs(dir), "--gate-log"), "--gate-sha").concat([
    "--gate-log",
    `${fx("gate-steps-green.log")}@${SHA}`,
    "--profile",
    "v5",
    "--publisher-source-sha",
    PUBLISHER_SHA,
    ...extra,
  ]);

test("v5 candidate dry run with clearance writes a v5 report", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const r = await exec(
    v5Args(dir, ["--ads-pin", CANDIDATE, "--clearance-ref", "clearance:synthetic"]),
    client,
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome, "DRY_RUN");
  assert.equal(client.creates, 0);
  const p = parseReportComment(await readFile(join(dir, "out", "report.md"), "utf8"));
  assert.ok(p.ok);
  assert.equal(p.profile, "v5");
  assert.equal((p.doc.data.subject as { ads_revision: string }).ads_revision, CANDIDATE);
});

test("v5 candidate with --publish is refused (exit 2) and posts nothing", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const r = await exec(
    v5Args(dir, ["--ads-pin", CANDIDATE, "--clearance-ref", "clearance:synthetic", "--publish"]),
    client,
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /CANDIDATE_TEST_PURPOSE_REQUIRED/);
  assert.equal(client.creates, 0);
});

test("v5 without clearance is HELD (exit 8): store written, no report file, no create", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const r = await exec(v5Args(dir, ["--ads-pin", CANDIDATE]), client);
  assert.equal(r.code, 8, r.stderr);
  assert.equal(r.json.outcome, "HELD");
  assert.equal(r.json.reason, "PUBLICATION_CLEARANCE_REQUIRED");
  assert.equal(client.creates, 0);
  assert.equal(existsSync(join(dir, "out", "report.md")), false);
  assert.ok(countFiles(join(dir, "store")) >= 4);
});

test("v5 without --ads-pin exits 2", async () => {
  const dir = await tmp();
  const r = await exec(v5Args(dir, ["--clearance-ref", "clearance:synthetic"]));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /ADS_PIN_REQUIRED/);
  assert.equal(countFiles(join(dir, "store")), 0);
});

test("v5 without --publisher-source-sha exits 2; unknown pin exits 2", async () => {
  const dir = await tmp();
  const noSha = baseArgs(dir, [
    "--profile",
    "v5",
    "--ads-pin",
    CANDIDATE,
    "--clearance-ref",
    "clearance:synthetic",
  ]);
  assert.equal((await exec(noSha)).code, 2);
  const unknown = await exec(v5Args(dir, ["--ads-pin", "a".repeat(40), "--clearance-ref", "c"]));
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /UNKNOWN_ADS_PIN/);
});

// ---- R2 integration ----

const GREEN = fx("gate-steps-green.log");
const RED = fx("gate-steps-red.log");
const noGate = (dir: string, extra: string[] = []) =>
  dropFlag(dropFlag(baseArgs(dir), "--gate-log"), "--gate-sha").concat(extra);

test("gate file@sha is OBSERVED: green on source_sha => STRICT_TERMINAL_SUCCESS", async () => {
  const dir = await tmp();
  const r = await exec(noGate(dir, ["--gate-log", `${GREEN}@${SHA}`]));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome_class, "STRICT_TERMINAL_SUCCESS");
  assert.equal(r.json.profile, "v4");
  assert.equal(r.json.mode, "dry-run");
  assert.equal(r.json.versions, 2);
  assert.equal(r.json.transitions.ADVANCE, 1);
  assert.ok(r.json.labels.ACTION_CATEGORY > 0);
  const p = parseReportComment(await readFile(join(dir, "out", "report.md"), "utf8"));
  assert.ok(p.ok);
  const vd = p.doc.data.verifier as { subject_sha: string; checked: string[] };
  assert.equal(vd.subject_sha, SHA);
  assert.ok(vd.checked.includes("task-check:test"));
  assert.match(await readFile(join(dir, "out", "report.md"), "utf8"), /gap ADS #1258/);
});

test("gate without @sha is inferred from mtime => PARTIAL_PROGRESS with a limit", async () => {
  const dir = await tmp();
  const log = join(dir, "g.log");
  await writeFile(log, await readFile(GREEN, "utf8"));
  // run.txt fixture finishes 2026-10-22T13:12:00Z
  const t = new Date("2026-10-22T14:00:00Z");
  await utimes(log, t, t);
  const r = await exec(noGate(dir, ["--gate-log", log]));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome_class, "PARTIAL_PROGRESS");
  const body = await readFile(join(dir, "out", "report.md"), "utf8");
  assert.match(body, /inferred from file mtime/);
  assert.ok(!body.includes(log));
});

test("gate with mtime before the run finished has no subject (UNVERIFIED-ish, never strict)", async () => {
  const dir = await tmp();
  const log = join(dir, "g.log");
  await writeFile(log, await readFile(GREEN, "utf8"));
  const t = new Date("2026-10-22T10:00:00Z");
  await utimes(log, t, t);
  const r = await exec(noGate(dir, ["--gate-log", log]));
  assert.equal(r.code, 0, r.stderr);
  assert.notEqual(r.json.outcome_class, "STRICT_TERMINAL_SUCCESS");
  assert.match(await readFile(join(dir, "out", "report.md"), "utf8"), /without subject binding/);
});

test("two contradicting gates on the same sha => UNVERIFIED", async () => {
  const dir = await tmp();
  const r = await exec(
    noGate(dir, ["--gate-log", `${GREEN}@${SHA}`, "--gate-log", `${RED}@${SHA}`]),
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome_class, "UNVERIFIED");
});

test("no gate log at all => UNVERIFIED, manifest still has all 7 roles", async () => {
  const dir = await tmp();
  const r = await exec(noGate(dir));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome_class, "UNVERIFIED");
  const store = new EvidenceStore(join(dir, "store"));
  const m = await store.readManifest(r.json.attempt_ref, 1);
  assert.deepEqual(m.objects.map((o) => o.role).sort(), [
    "aggregates",
    "capability",
    "labels",
    "lineage",
    "observations",
    "summary",
    "verifier",
  ]);
});

test("lineage from a temp git repo; verifier ref attached; stored objects are private-clean", async () => {
  const dir = await tmp();
  const repo = join(dir, "repo");
  await mkdir(repo);
  const git = (...a: string[]) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a],
      { encoding: "utf8" },
    ).trim();
  git("init", "-q");
  await writeFile(join(repo, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-q", "-m", "one");
  const c1 = git("rev-parse", "HEAD");
  await writeFile(join(repo, "a.txt"), "one\ntwo\n");
  git("commit", "-q", "-am", "two");
  const c2 = git("rev-parse", "HEAD");
  const run = (await readFile(fx("run.txt"), "utf8"))
    .replace("fedcba9876543210fedcba9876543210fedcba98", c1)
    .replace("0123456789abcdef0123456789abcdef01234567", c2);
  const runFile = join(dir, "run.txt");
  await writeFile(runFile, run);
  const args = noGate(dir, ["--gate-log", `${GREEN}@${c2}`, "--git-dir", join(repo, ".git")]).map(
    (a) => (a === fx("run.txt") ? runFile : a),
  );
  const a = await exec(args);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.outcome_class, "STRICT_TERMINAL_SUCCESS");
  const store = new EvidenceStore(join(dir, "store"));
  const m = await store.readManifest(a.json.attempt_ref, 1);
  const get = async (role: string) =>
    store.getObject((m.objects.find((o) => o.role === role) as { digest: string }).digest);
  const lineage = (await get("lineage")) as {
    versions: { observability: string }[];
    transitions: {
      change: { insertions: number | null };
      verifier_refs: string[];
      run_segment_ref: string;
    }[];
  };
  assert.equal(
    lineage.versions.every((v) => v.observability === "COMMITTED"),
    true,
  );
  assert.equal(lineage.transitions[0]?.change.insertions, 1);
  assert.equal(lineage.transitions[0]?.verifier_refs.length, 1);
  assert.match(
    lineage.transitions[0]?.run_segment_ref ?? "",
    /^zcode:run-record:sess-synth-0001#1$/,
  );
  for (const role of m.objects.map((o) => o.role)) {
    const text = JSON.stringify(await get(role));
    assertNoForbiddenContent(JSON.parse(text));
    assert.ok(!text.includes("SENTINEL"), role);
    assert.ok(!text.includes(dir.replaceAll("\\", "\\\\")), role);
  }
  // idempotent rerun with a moved clock
  const b = await exec(args, new FakeClient(), new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(b.code, 0, b.stderr);
  assert.equal(b.json.manifest.sha256, a.json.manifest.sha256);
});

// ---- E2E test subject ----

const E2E_REPO = "kaicreator-mm/task-meta-e2e";
const e2eArgs = (dir: string, repo: string, extra: string[] = []) =>
  v5Args(dir, [
    "--ads-pin",
    CANDIDATE,
    "--clearance-ref",
    "clearance:synthetic",
    "--publish",
    ...extra,
  ]).map((a, i, all) => (all[i - 1] === "--repo" ? repo : a));

test("E2E repo + candidate pin + --publish => PUBLISHED with the E2E limit in the body", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const r = await exec(e2eArgs(dir, E2E_REPO), client);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome, "PUBLISHED");
  assert.equal(client.creates, 1);
  const p = parseReportComment(client.comments[0]?.body ?? "");
  assert.ok(p.ok);
  assert.equal(p.profile, "v5");
  assert.ok(
    (p.doc.data.limits as string[]).includes(
      "ADS v4.16 candidate 3041a1b used as isolated E2E test subject; not production adoption",
    ),
  );
});

test("non-allowlisted repo + candidate pin + --publish => exit 2, nothing posted", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const r = await exec(e2eArgs(dir, "other/repo"), client);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /CANDIDATE_NOT_PUBLISHABLE/);
  assert.equal(client.creates, 0);
});

test("gate log with GATE_SUBJECT_SHA and no @sha binds OBSERVED (no mtime inference)", async () => {
  const dir = await tmp();
  const log = join(import.meta.dirname, "fixtures", "verifier", "gate-recorded-cli.txt");
  const r = await exec(noGate(dir, ["--gate-log", log]));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome_class, "STRICT_TERMINAL_SUCCESS");
  const p = parseReportComment(await readFile(join(dir, "out", "report.md"), "utf8"));
  assert.ok(p.ok);
  assert.ok(!(p.doc.data.limits as string[]).some((l) => l.includes("inferred from file mtime")));
});

// ---- owner-authorized default profile ----

const OWNER_LIMIT_TEXT =
  "ADS v4.16 adopted from version/v4.16@3041a1b by project-owner authorization; not ADS-main qualified";

test("collect without --profile uses qualified ADS main v5 adoption, not legacy candidate", async () => {
  const dir = await tmp();
  const client = new FakeClient();
  const args = dropFlag(
    v5Args(dir, ["--clearance-ref", "clearance:synthetic", "--publish"]),
    "--profile",
  );
  const r = await exec(args, client);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.outcome, "PUBLISHED");
  assert.equal(r.json.profile, "v5");
  const p = parseReportComment(client.comments[0]?.body ?? "");
  assert.ok(p.ok);
  const limits = p.doc.data.limits as string[];
  assert.ok(!limits.includes(OWNER_LIMIT_TEXT));
  assert.ok(!limits.some((l) => l.includes("isolated E2E test subject")));
  assert.equal((p.doc.data.subject as { ads_revision: string }).ads_revision, "718fb02e33b31f568736447b2b905883cc6fcc3a");
});

test("collect --profile v4 still works and carries no owner limit", async () => {
  const dir = await tmp();
  const r = await exec(baseArgs(dir));
  assert.equal(r.code, 0, r.stderr);
  const p = parseReportComment(await readFile(join(dir, "out", "report.md"), "utf8"));
  assert.ok(p.ok);
  assert.equal(p.profile, "v4");
  assert.ok(!(p.doc.data.limits as string[]).includes(OWNER_LIMIT_TEXT));
});
