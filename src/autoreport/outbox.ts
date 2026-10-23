import { mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { TaskBinding } from "../model.ts";
import { Spool } from "../store/spool.ts";

export type OutboxState =
  | "PUBLISHED"
  | "ALREADY_PUBLISHED"
  | "HELD"
  | "FAILED"
  | "DISABLED"
  | "ALREADY_RUNNING"
  /** A Stop-triggered run saw new session activity while settling; the later Stop reports. */
  | "SUPERSEDED_BY_ACTIVITY"
  /** Returned by `--dry-run` only; never written to the outbox. */
  | "DRY_RUN";

export interface OutboxEntry {
  session: string;
  agent: string;
  state: OutboxState;
  binding: TaskBinding | null;
  comment_url: string | null;
  data_digest: string | null;
  reasons: string[];
  at: string;
  revision?: number | null;
}

/** Entries that `auto-report --retry` re-drives (latest state per session). */
export const RETRYABLE: ReadonlySet<OutboxState> = new Set(["HELD", "FAILED"]);

const STALE_LOCK_MS = 15 * 60 * 1000;

export const safeName = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);

/** Append-only JSONL outbox: `<dir>/<YYYY-MM-DD>.jsonl`, one verified line per outcome. */
export class Outbox {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  async append(entry: OutboxEntry): Promise<void> {
    await new Spool(join(this.dir, `${entry.at.slice(0, 10)}.jsonl`)).append(entry);
  }

  /** All verifiable entries in chronological file order. */
  async readAll(): Promise<OutboxEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: OutboxEntry[] = [];
    for (const n of names.filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) {
      const { entries } = await new Spool(join(this.dir, n)).replay();
      for (const e of entries) {
        const o = e as Partial<OutboxEntry>;
        if (typeof o.session === "string" && typeof o.state === "string")
          out.push(o as OutboxEntry);
      }
    }
    return out;
  }

  /** Latest entry per session, in order of their latest appearance. */
  async latestPerSession(): Promise<OutboxEntry[]> {
    const m = new Map<string, OutboxEntry>();
    for (const e of await this.readAll()) {
      m.delete(`${e.agent}|${e.session}`);
      m.set(`${e.agent}|${e.session}`, e);
    }
    return [...m.values()];
  }

  /** Exclusive per-session lock file. Returns a release function, or null when already held. */
  async lock(session: string): Promise<(() => Promise<void>) | null> {
    const dir = join(this.dir, "locks");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${safeName(session)}.lock`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fh = await open(file, "wx");
        try {
          await fh.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
        } finally {
          await fh.close();
        }
        return async () => {
          try {
            await unlink(file);
          } catch {
            // already gone
          }
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        // A crashed process must not block the session forever.
        try {
          if (Date.now() - (await stat(file)).mtimeMs > STALE_LOCK_MS) {
            await unlink(file);
            continue;
          }
        } catch {
          continue;
        }
        return null;
      }
    }
    return null;
  }
}
