// auto-report watcher (`--trigger watch`): a long-lived process started at SessionStart for hosts
// that kill the Stop/SessionEnd-spawned reporter with the session (Codex on Windows). It polls the
// session spool and runs the normal auto-report when the session ends or a turn has settled.
// Never throws; every state lands in the outbox (docs/v0.2 section 12).
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type AutoReportConfig, loadAutoReportConfig } from "./config.ts";
import { Outbox, type OutboxEntry, type OutboxState, safeName } from "./outbox.ts";
import {
  AUTO_REPORT_AGENTS,
  type AutoReportDeps,
  type AutoReportOptions,
  agentDirs,
  autoReportSession,
  realSleep,
  STRAGGLER_EVENTS,
  spoolParser,
} from "./runner.ts";

export interface WatchDeps extends AutoReportDeps {
  /** Poll interval (default 2000 ms). */
  pollMs?: number;
}

const SESSION_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,199}$/;

interface SpoolState {
  size: number;
  /** Number of non-straggler events of this session. */
  activity: number;
  sessionEnd: boolean;
  /** The latest non-straggler event is a Stop. */
  lastIsStop: boolean;
}

export async function watchSession(
  opts: AutoReportOptions,
  deps: WatchDeps = {},
): Promise<OutboxEntry> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? realSleep;
  const pollMs = deps.pollMs ?? 2000;
  const env = deps.env ?? process.env;
  const entry = (
    state: OutboxState,
    reasons: string[],
    extra: Partial<OutboxEntry> = {},
  ): OutboxEntry => ({
    session: opts.session,
    agent: opts.agent,
    state,
    binding: null,
    comment_url: null,
    data_digest: null,
    reasons,
    at: now().toISOString(),
    ...extra,
  });
  let outbox: Outbox | null = null;
  const finish = async (e: OutboxEntry): Promise<OutboxEntry> => {
    if (outbox !== null) {
      try {
        await outbox.append(e);
      } catch {
        // the outbox is the only log
      }
    }
    return e;
  };
  let cfg: AutoReportConfig;
  try {
    cfg = loadAutoReportConfig(opts.configPath);
    outbox = new Outbox(resolve(opts.outbox ?? cfg.outbox));
  } catch (e) {
    try {
      outbox = new Outbox(resolve(opts.outbox ?? loadAutoReportConfig().outbox));
    } catch {
      outbox = null;
    }
    return finish(entry("FAILED", [`watch config: ${(e as Error).name}`]));
  }
  if (!(AUTO_REPORT_AGENTS as readonly string[]).includes(opts.agent))
    return finish(entry("FAILED", [`unsupported agent: ${opts.agent.slice(0, 40)}`]));
  if (!SESSION_RE.test(opts.session)) return finish(entry("FAILED", ["invalid session id"]));

  const stopFile = join(outbox.dir, "STOP");
  const killed = (c: AutoReportConfig): boolean =>
    !c.enabled || env.TASK_META_AUTO_REPORT === "0" || existsSync(stopFile);
  const killedEntry = () =>
    entry("DISABLED", ["watcher stopped (config disabled, TASK_META_AUTO_REPORT=0 or STOP file)"]);
  if (killed(cfg)) return finish(killedEntry());

  let release: (() => Promise<void>) | null;
  try {
    release = await outbox.lock(opts.session, "watch", cfg.watch_max_seconds * 1000);
  } catch (e) {
    return finish(entry("FAILED", [`watch lock: ${(e as Error).name}`]));
  }
  if (release === null) {
    return finish(entry("ALREADY_WATCHING", ["another watcher holds the session watch lock"]));
  }

  try {
    const file = join(agentDirs(opts, cfg).spoolDir, `${safeName(opts.session)}.jsonl`);
    const parse = spoolParser(opts.agent);
    const read = async (): Promise<SpoolState | null> => {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        return null;
      }
      const mine = parse(text).entries.filter((e) => e.session_id === opts.session);
      const meaningful = mine.filter((e) => !STRAGGLER_EVENTS.has(e.event));
      return {
        size: Buffer.byteLength(text),
        activity: meaningful.length,
        sessionEnd: mine.some((e) => e.event === "SessionEnd"),
        lastIsStop: meaningful.at(-1)?.event === "Stop",
      };
    };
    const t0 = now().getTime();
    let lastSize = -1;
    let lastChange = t0;
    let state: SpoolState | null = null;
    let publishedActivity = -1;
    let last: OutboxEntry | null = null;
    const publish = async (trigger: "stop" | "session-end"): Promise<OutboxEntry> => {
      const r = await autoReportSession(
        { ...opts, trigger, skipSettle: true, dryRun: false },
        { ...deps, sleep, now },
      );
      last = r;
      return r;
    };

    for (;;) {
      let cur = cfg;
      try {
        cur = loadAutoReportConfig(opts.configPath);
        cfg = cur;
      } catch {
        // keep the last good config
      }
      if (killed(cur)) return await finish(killedEntry());

      let size = -1;
      try {
        size = (await stat(file)).size;
      } catch {
        size = -1;
      }
      if (size !== lastSize) {
        lastSize = size;
        lastChange = now().getTime();
        state = await read();
      }
      const idleMs = now().getTime() - lastChange;

      if (state?.sessionEnd) {
        let r = await publish("session-end");
        if (r.state === "ALREADY_RUNNING") {
          await sleep(pollMs);
          r = await publish("session-end");
        }
        return r; // runAutoReport already appended its own outbox entry
      }
      if (
        state?.lastIsStop &&
        state.activity > publishedActivity &&
        idleMs >= Math.round(cur.settle_seconds * 1000)
      ) {
        const r = await publish("stop");
        if (r.state !== "ALREADY_RUNNING") publishedActivity = state.activity;
      } else if (idleMs >= cur.watch_idle_exit_seconds * 1000) {
        return await finish(
          entry("WATCH_IDLE_EXIT", ["no spool activity for watch_idle_exit_seconds"]),
        );
      } else if (now().getTime() - t0 >= cur.watch_max_seconds * 1000) {
        return await finish(entry("WATCH_IDLE_EXIT", ["watch_max_seconds reached"]));
      }
      await sleep(pollMs);
    }
  } catch (e) {
    return finish(entry("FAILED", [`watch: ${(e as Error).name}`]));
  } finally {
    await release();
  }
}
