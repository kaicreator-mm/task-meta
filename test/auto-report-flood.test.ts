// Per-turn flood guard (docs/v0.2 section 10): settle window, SUPERSEDED_BY_ACTIVITY, session-end,
// revision cap. All with an injected clock and sleep; nothing waits in real time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type AutoReportTrigger, autoReportSession, Outbox } from "../src/autoreport/index.ts";
import { main } from "../src/cli.ts";
import { parseReportComment } from "../src/report/index.ts";
import {
  append,
  type Env,
  endLine,
  FakeGh,
  GOOD_SPOOL,
  NOW,
  postToolLine,
  preToolLine,
  publicationPolicy,
  setup,
  stopLine,
} from "./fixtures/claude/autoenv.ts";
import { SID } from "./fixtures/claude/build.ts";

interface Clock {
  sleeps: number[];
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

/** A virtual clock: sleep(ms) advances it; `onSleep(n)` runs on the n-th sleep (1-based). */
function clock(onSleep?: (n: number) => void): Clock {
  let t = NOW.getTime();
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => new Date(t),
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
      onSleep?.(sleeps.length);
    },
  };
}

const go = (env: Env, gh: FakeGh, trigger: AutoReportTrigger | undefined, c: Clock) =>
  autoReportSession(
    { agent: "claude", session: SID, configPath: env.config, trigger },
    { client: gh, now: c.now, sleep: c.sleep, settleMs: 0, env: {}, publicationPolicy },
  );

const total = (c: Clock): number => c.sleeps.reduce((a, b) => a + b, 0);

test("two quick Stops produce one publish: activity during the settle window supersedes the first", async () => {
  const env = await setup({ spool: GOOD_SPOOL(), settleSeconds: 180 });
  const gh = new FakeGh();
  // Stop #1 starts its run; the next turn's prompt+Stop land during its settle window.
  const c1 = clock((n) => {
    if (n === 3) append(env, preToolLine() + stopLine(100));
  });
  const first = await go(env, gh, "stop", c1);
  assert.equal(first.state, "SUPERSEDED_BY_ACTIVITY");
  assert.equal(gh.creates, 0);
  assert.equal(c1.sleeps.length, 3, "stops waiting as soon as activity is seen");
  assert.ok(first.reasons.join(" ").includes("settle window"));

  // Stop #2's run settles quietly for the whole window, then publishes once.
  const c2 = clock();
  const second = await go(env, gh, "stop", c2);
  assert.equal(second.state, "PUBLISHED", second.reasons.join(";"));
  assert.equal(total(c2), 180_000);
  assert.equal(gh.creates, 1);

  // A third Stop with nothing new reports the same data: no new comment.
  const c3 = clock();
  const third = await go(env, gh, "stop", c3);
  assert.equal(third.state, "ALREADY_PUBLISHED");
  assert.equal(gh.creates, 1);

  // the outbox keeps the superseded attempt, and --retry does not re-drive it
  const latest = await new Outbox(env.outbox).readAll();
  assert.deepEqual(
    latest.map((e) => e.state),
    ["SUPERSEDED_BY_ACTIVITY", "PUBLISHED", "ALREADY_PUBLISHED"],
  );
});

test("two simultaneous quiet Stop runs publish exactly once", async () => {
  const env = await setup({ spool: GOOD_SPOOL(), settleSeconds: 60 });
  const gh = new FakeGh();
  const [a, b] = await Promise.all([go(env, gh, "stop", clock()), go(env, gh, "stop", clock())]);
  assert.equal(gh.creates, 1);
  const states = [a.state, b.state].sort();
  assert.ok(
    states[0] === "ALREADY_PUBLISHED" || states[0] === "ALREADY_RUNNING",
    `unexpected ${states.join(",")}`,
  );
  assert.equal(states[1], "PUBLISHED");
});

test("late PostToolUse lines of the finished turn are not new activity", async () => {
  const env = await setup({ spool: GOOD_SPOOL(), settleSeconds: 30 });
  const gh = new FakeGh();
  const c = clock((n) => {
    if (n === 2) append(env, postToolLine());
  });
  const r = await go(env, gh, "stop", c);
  assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
  assert.equal(total(c), 30_000);
  // the straggler is part of the published data
  const p = parseReportComment(gh.comments[0]?.body ?? "");
  assert.ok(p.ok);
  const hook = (p.doc.data as { metrics: Array<{ name: string; value: number }> }).metrics.find(
    (m) => m.name === "hook_events",
  );
  assert.equal(hook?.value, 4);
});

test("the settle wait is bounded even if the clock jumps; poll steps are at most 2 s", async () => {
  const env = await setup({ spool: GOOD_SPOOL(), settleSeconds: 180 });
  const gh = new FakeGh();
  // wall clock advances 100 s per sleep while the sleeps themselves are no-ops of 2 s
  let t = NOW.getTime();
  const sleeps: number[] = [];
  const r = await autoReportSession(
    { agent: "claude", session: SID, configPath: env.config, trigger: "stop" },
    {
      client: gh,
      now: () => new Date(t),
      sleep: async (ms) => {
        sleeps.push(ms);
        t += 100_000;
      },
      settleMs: 0,
      env: {},
      publicationPolicy,
    },
  );
  assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
  // settle (180 s) + 30 s slack = 210 s of wall clock => stops after 3 jumps of 100 s
  assert.ok(sleeps.length <= 3, `${sleeps.length} polls`);
  assert.ok(sleeps.every((ms) => ms <= 2000));
});

test("session-end publishes immediately: no settle wait", async () => {
  const env = await setup({ spool: GOOD_SPOOL() + endLine(), settleSeconds: 180 });
  const gh = new FakeGh();
  const c = clock();
  const r = await go(env, gh, "session-end", c);
  assert.equal(r.state, "PUBLISHED", r.reasons.join(";"));
  assert.equal(c.sleeps.length, 0);
  assert.equal(gh.creates, 1);
  // and so do manual runs (no trigger) and dry runs
  const m = clock();
  const again = await go(env, gh, undefined, m);
  assert.equal(again.state, "ALREADY_PUBLISHED");
  assert.equal(m.sleeps.length, 0);
});

test("revision cap: new data beyond max_revisions_per_session is HELD (REVISION_CAP); session-end publishes one final revision", async () => {
  const env = await setup({ spool: GOOD_SPOOL(), maxRevisions: 2 });
  const gh = new FakeGh();
  const c = clock();
  const r1 = await go(env, gh, "stop", c);
  assert.equal(r1.state, "PUBLISHED");
  assert.equal(r1.revision, 1);

  append(env, postToolLine());
  const r2 = await go(env, gh, "stop", c);
  assert.equal(r2.state, "PUBLISHED", r2.reasons.join(";"));
  assert.equal(r2.revision, 2);

  append(env, postToolLine());
  const held = await go(env, gh, "stop", c);
  assert.equal(held.state, "HELD");
  assert.deepEqual(held.reasons, ["REVISION_CAP"]);
  assert.equal(gh.creates, 2);
  const held2 = await go(env, gh, "stop", c);
  assert.deepEqual(held2.reasons, ["REVISION_CAP"]);
  assert.equal(gh.creates, 2);

  // the session ends: one final revision, superseding revision 2
  append(env, endLine());
  const last = await go(env, gh, "session-end", c);
  assert.equal(last.state, "PUBLISHED", last.reasons.join(";"));
  assert.equal(last.revision, 3);
  assert.equal(gh.creates, 3);
  const p2 = parseReportComment(gh.comments[1]?.body ?? "");
  const p3 = parseReportComment(gh.comments[2]?.body ?? "");
  assert.ok(p2.ok && p3.ok);
  const d3 = p3.doc.data as Record<string, unknown>;
  assert.equal(d3.revision, 3);
  const sup = d3.supersedes as { revision: number; data_digest: string; comment_ref: string };
  assert.equal(sup.revision, 2);
  assert.equal(sup.data_digest, r2.data_digest);
  assert.match(sup.comment_ref, /#issuecomment-1002$/);

  // only ONE final revision: more data after it stays HELD even at session-end
  append(env, postToolLine());
  const beyond = await go(env, gh, "session-end", c);
  assert.equal(beyond.state, "HELD");
  assert.deepEqual(beyond.reasons, ["REVISION_CAP"]);
  assert.equal(gh.creates, 3);
  // while unchanged data is still idempotent for any trigger
  const stop3 = await go(env, gh, "stop", c);
  assert.deepEqual(stop3.reasons, ["REVISION_CAP"]);
});

test("auto-report --retry publishes the capped session's final revision", async () => {
  const env = await setup({ spool: GOOD_SPOOL(), maxRevisions: 1 });
  const gh = new FakeGh();
  const c = clock();
  assert.equal((await go(env, gh, "stop", c)).state, "PUBLISHED");
  append(env, postToolLine());
  const held = await go(env, gh, "stop", c);
  assert.deepEqual(held.reasons, ["REVISION_CAP"]);
  assert.equal(gh.creates, 1);

  let out = "";
  const code = await main(["auto-report", "--retry", "--config", env.config], {
    client: gh,
    now: c.now,
    stdout: (s) => {
      out += s;
    },
    autoReport: { sleep: c.sleep, settleMs: 0, env: {}, publicationPolicy },
  });
  assert.equal(code, 0);
  const j = JSON.parse(out) as { retried: number; results: Array<{ state: string }> };
  assert.equal(j.retried, 1);
  assert.equal(j.results[0]?.state, "PUBLISHED");
  assert.equal(gh.creates, 2);
  const p = parseReportComment(gh.comments[1]?.body ?? "");
  assert.ok(p.ok);
  assert.equal((p.doc.data as { revision: number }).revision, 2);
});

test("SUPERSEDED_BY_ACTIVITY is not retried by --retry; dry runs never settle", async () => {
  const env = await setup({ spool: GOOD_SPOOL(), settleSeconds: 120 });
  const gh = new FakeGh();
  const c = clock((n) => {
    if (n === 1) append(env, stopLine(200));
  });
  const s = await go(env, gh, "stop", c);
  assert.equal(s.state, "SUPERSEDED_BY_ACTIVITY");
  let out = "";
  await main(["auto-report", "--retry", "--config", env.config], {
    client: gh,
    now: c.now,
    stdout: (x) => {
      out += x;
    },
    autoReport: { sleep: c.sleep, settleMs: 0, env: {} },
  });
  assert.equal(JSON.parse(out).retried, 0);
  assert.equal(gh.creates, 0);

  const dry = clock();
  const d = await autoReportSession(
    { agent: "claude", session: SID, configPath: env.config, trigger: "stop", dryRun: true },
    { client: gh, now: dry.now, sleep: dry.sleep, settleMs: 0, env: {} },
  );
  assert.equal(d.state, "DRY_RUN", d.reasons.join(";"));
  assert.equal(dry.sleeps.length, 0);
});

test("config defaults: settle_seconds 180 and max_revisions_per_session 3", async () => {
  const { loadAutoReportConfig } = await import("../src/autoreport/config.ts");
  const cfg = loadAutoReportConfig();
  assert.equal(cfg.settle_seconds, 180);
  assert.equal(cfg.max_revisions_per_session, 3);
  assert.match(cfg.claude.spool_dir.replace(/\\/g, "/"), /\.task-meta\/claude-spool$/);
  assert.match(cfg.claude.projects_dir.replace(/\\/g, "/"), /\.claude\/projects$/);
});
