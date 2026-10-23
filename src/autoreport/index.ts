import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT } from "../collect-core.ts";
import { loadAutoReportConfig } from "./config.ts";
import type { AutoReportGitHub } from "./github.ts";
import { Outbox, type OutboxEntry, RETRYABLE } from "./outbox.ts";
import {
  type AutoReportDeps,
  type AutoReportOptions,
  type AutoReportTrigger,
  autoReportSession,
} from "./runner.ts";

export { loadAutoReportConfig } from "./config.ts";
export type { AutoReportGitHub } from "./github.ts";
export { Outbox, type OutboxEntry, type OutboxState } from "./outbox.ts";
export {
  type AutoReportDeps,
  type AutoReportOptions,
  type AutoReportTrigger,
  autoReportSession,
} from "./runner.ts";

export interface AutoReportCliDeps {
  client?: unknown;
  now?: () => Date;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  autoReport?: Partial<AutoReportDeps>;
}

/** `auto-report ...` command. Exit 0 for every outcome; only usage errors exit 2. */
export async function runAutoReportCommand(
  argv: string[],
  deps: AutoReportCliDeps,
  out: (s: string) => void,
): Promise<number> {
  const err = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  let values: ReturnType<typeof parse>["values"];
  try {
    values = parse(argv).values;
  } catch (e) {
    err(`error: ${(e as Error).message}\n`);
    return EXIT.USAGE;
  }
  const v = values;
  if (v.retry !== true) {
    if (v.agent === undefined || v.session === undefined) {
      err("error: auto-report needs --agent zcode|claude|codex --session <id> (or --retry)\n");
      return EXIT.USAGE;
    }
    if (v.session.startsWith("-")) {
      err("error: invalid --session\n");
      return EXIT.USAGE;
    }
  }
  if (v.trigger !== undefined && v.trigger !== "stop" && v.trigger !== "session-end") {
    err("error: --trigger must be stop or session-end\n");
    return EXIT.USAGE;
  }
  const base: Omit<AutoReportOptions, "agent" | "session"> = {
    spoolDir: v["spool-dir"],
    rolloutDir: v["rollout-dir"],
    projectsDir: v["projects-dir"],
    trigger: v.retry === true ? "retry" : (v.trigger as AutoReportTrigger | undefined),
    store: v.store,
    outbox: v.outbox,
    configPath: v.config,
    dryRun: v["dry-run"] === true,
  };
  const d: AutoReportDeps = {
    ...(deps.client !== undefined ? { client: deps.client as AutoReportGitHub } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.autoReport ?? {}),
  };
  try {
    if (v.retry !== true) {
      const r = await autoReportSession(
        { ...base, agent: v.agent as string, session: v.session as string },
        d,
      );
      out(`${JSON.stringify(r)}\n`);
      return EXIT.OK;
    }
    let outboxDir = v.outbox;
    if (outboxDir === undefined) outboxDir = loadAutoReportConfig(v.config).outbox;
    const outbox = new Outbox(resolve(outboxDir));
    const results: OutboxEntry[] = [];
    for (const e of await outbox.latestPerSession()) {
      if (!RETRYABLE.has(e.state)) continue;
      results.push(
        await autoReportSession(
          { ...base, agent: e.agent, session: e.session, outbox: outboxDir },
          d,
        ),
      );
    }
    out(
      `${JSON.stringify({
        retried: results.length,
        results: results.map((r) => ({ session: r.session, state: r.state })),
      })}\n`,
    );
  } catch (e) {
    // never throw to the caller (the capture plugin spawns this detached)
    err(`auto-report: ${(e as Error).name}\n`);
  }
  return EXIT.OK;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      agent: { type: "string" },
      session: { type: "string" },
      "spool-dir": { type: "string" },
      "rollout-dir": { type: "string" },
      "projects-dir": { type: "string" },
      trigger: { type: "string" },
      store: { type: "string" },
      outbox: { type: "string" },
      config: { type: "string" },
      retry: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
}
