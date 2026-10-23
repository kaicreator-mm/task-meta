import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { autoReportSession } from "../src/autoreport/index.ts";
import { main } from "../src/cli.ts";
import { parseReportComment } from "../src/report/index.ts";
import {
  allText,
  endLine,
  ent,
  FakeGh,
  GOOD_SPOOL,
  H2,
  line,
  NOW,
  PUB_SHA,
  REPO,
  setup,
  startLine,
} from "./fixtures/claude/autoenv.ts";
import { SENTINELS, SID } from "./fixtures/claude/build.ts";

const OWNER_LIMIT =
  "ADS v4.16 adopted from version/v4.16@3041a1b by project-owner authorization; not ADS-main qualified";

const run = (
  env: Awaited<ReturnType<typeof setup>>,
  gh: FakeGh,
  over: Record<string, unknown> = {},
) =>
  autoReportSession(
    { agent: "claude", session: SID, configPath: env.config, ...over },
    { client: gh, now: () => NOW, sleep: async () => {}, settleMs: 0, env: {} },
  );

test("auto-report --agent claude: PUBLISHED v5 to the bound Issue (transcript + subagent file), then ALREADY_PUBLISHED", async () => {
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
  assert.ok((d.limits as string[]).includes(OWNER_LIMIT));
  const metrics = d.metrics as Array<{ name: string; adapter_id: string; value: number | null }>;
  assert.ok(metrics.every((m) => m.adapter_id === "claude"));
  const val = (n: string) => metrics.find((m) => m.name === n)?.value;
  assert.equal(val("model_requests"), 6);
  assert.equal(val("subagent_requests"), 1);
  assert.equal(val("input_tokens"), 7255);
  assert.equal(val("output_tokens"), 225);

  const again = await run(env, gh);
  assert.equal(again.state, "ALREADY_PUBLISHED", again.reasons.join(";"));
  assert.equal(gh.creates, 1);
  assert.equal(again.data_digest, r.data_digest);

  // content-free end to end (store, outbox and the posted comment)
  const stored = (await allText(env.store)) + (await allText(env.outbox));
  for (const s of SENTINELS) {
    assert.ok(!stored.includes(s), `store/outbox leaks ${s}`);
    assert.ok(!(gh.comments[0]?.body ?? "").includes(s), `report leaks ${s}`);
  }
});

test("claude: dry run publishes nothing; missing transcript and unbound sessions are HELD", async () => {
  const env = await setup({ spool: GOOD_SPOOL() });
  const gh = new FakeGh();
  const dry = await run(env, gh, { dryRun: true });
  assert.equal(dry.state, "DRY_RUN", dry.reasons.join(";"));
  assert.equal(gh.creates, 0);

  const noTranscript = await setup({ spool: GOOD_SPOOL(), transcript: false });
  const h = await run(noTranscript, gh);
  assert.equal(h.state, "HELD");
  assert.match(h.reasons.join(";"), /no transcript file/);

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

  const noSpool = await setup({});
  const n = await run(noSpool, gh);
  assert.equal(n.state, "HELD");
  assert.match(n.reasons.join(";"), /no hook spool entries/);
});

test("claude: a transcript without its subagent file still publishes, with an honest limit", async () => {
  const env = await setup({ spool: GOOD_SPOOL() });
  await rm(join(env.projects, "C--proj-slug", SID, "subagents"), { recursive: true });
  const gh = new FakeGh();
  const r = await run(env, gh);
  assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
  const p = parseReportComment(gh.comments[0]?.body ?? "");
  assert.ok(p.ok);
  const d = p.doc.data as Record<string, unknown>;
  assert.ok((d.limits as string[]).some((l) => l.includes("subagent invocation")));
  const m = (d.metrics as Array<{ name: string; value: number | null; coverage: string }>).find(
    (x) => x.name === "model_requests",
  );
  assert.equal(m?.value, 5);
});

test("claude: a session-end-only spool (no Stop) is reported; the SessionEnd line ends the Stop wait", async () => {
  const env = await setup({ spool: startLine() + endLine() });
  const gh = new FakeGh();
  const r = await run(env, gh, { trigger: "session-end" });
  // no prompt ref and no binding sources beyond the worktree: still bound via worktree/branch refs
  assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
  const p = parseReportComment(gh.comments[0]?.body ?? "");
  assert.ok(p.ok);
  assert.equal((p.doc.data as { subject: { source_sha: string } }).subject.source_sha, H2);
});

test("claude: the CLI entry accepts --agent claude --trigger and honours the kill switch", async () => {
  const env = await setup({ spool: GOOD_SPOOL() });
  const gh = new FakeGh();
  let out = "";
  const code = await main(
    [
      "auto-report",
      "--agent",
      "claude",
      "--session",
      SID,
      "--trigger",
      "session-end",
      "--config",
      env.config,
    ],
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

  let err = "";
  const bad = await main(
    ["auto-report", "--agent", "claude", "--session", SID, "--trigger", "bogus"],
    { stderr: (s) => (err += s), stdout: () => {} },
  );
  assert.equal(bad, 2);
  assert.match(err, /--trigger must be stop or session-end/);
});

test("claude: explicit --spool-dir / --projects-dir override the config", async () => {
  const env = await setup({ spool: GOOD_SPOOL() });
  const moved = join(env.root, "elsewhere");
  await mkdir(moved, { recursive: true });
  await writeFile(join(moved, `${SID}.jsonl`), GOOD_SPOOL());
  const gh = new FakeGh();
  const r = await run(env, gh, {
    spoolDir: moved,
    projectsDir: join(env.root, "no-projects-here"),
  });
  assert.equal(r.state, "HELD");
  assert.match(r.reasons.join(";"), /no transcript file/);
  const ok = await run(env, gh, { spoolDir: moved, projectsDir: env.projects });
  assert.equal(ok.state, "PUBLISHED", ok.reasons.join(";"));
});
