import { mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalDigest, canonicalize } from "../canonical.ts";

/**
 * Append-only JSONL outbox. Each line is `{"d":"<sha256 of canonical entry>","e":<entry>}`.
 * `replay` skips (and reports) truncated or digest-mismatched lines; it never throws on them.
 * Duplicate identical entries are returned as-is: de-duplication is the caller's job.
 */
export class Spool {
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
  }

  async append(entry: unknown): Promise<void> {
    const line = `{"d":"${canonicalDigest(entry)}","e":${canonicalize(entry)}}\n`;
    await mkdir(dirname(this.path), { recursive: true });
    // If a previous crash left a partial line (no trailing newline), start on a fresh line
    // so the new entry is not glued to the garbage.
    let prefix = "";
    try {
      const size = (await stat(this.path)).size;
      if (size > 0) {
        const rh = await open(this.path, "r");
        try {
          const b = Buffer.alloc(1);
          await rh.read(b, 0, 1, size - 1);
          if (b[0] !== 0x0a) prefix = "\n";
        } finally {
          await rh.close();
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const fh = await open(this.path, "a");
    try {
      await fh.appendFile(prefix + line, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  async replay(): Promise<{
    entries: unknown[];
    skipped: { line: number; reason: string }[];
  }> {
    const entries: unknown[] = [];
    const skipped: { line: number; reason: string }[] = [];
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { entries, skipped };
      throw e;
    }
    const lines = text.split("\n");
    const last = lines.length - 1;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] as string;
      if (raw === "") continue;
      const n = i + 1;
      if (i === last) {
        // No terminating newline: crash mid-append. Never trust it, even if it parses.
        skipped.push({ line: n, reason: "truncated trailing line" });
        continue;
      }
      let obj: unknown;
      try {
        obj = JSON.parse(raw);
      } catch {
        skipped.push({ line: n, reason: "invalid JSON" });
        continue;
      }
      if (
        typeof obj !== "object" ||
        obj === null ||
        typeof (obj as { d?: unknown }).d !== "string" ||
        !("e" in obj)
      ) {
        skipped.push({ line: n, reason: "malformed line" });
        continue;
      }
      const { d, e } = obj as { d: string; e: unknown };
      let actual: string;
      try {
        actual = canonicalDigest(e);
      } catch {
        skipped.push({ line: n, reason: "entry not canonicalizable" });
        continue;
      }
      if (actual !== d) {
        skipped.push({ line: n, reason: "digest mismatch" });
        continue;
      }
      entries.push(e);
    }
    return { entries, skipped };
  }
}
