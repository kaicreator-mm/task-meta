import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Rollout files of one Codex thread under a sessions dir: `rollout-*<id>*.jsonl` (depth <= 4). */
export async function findCodexRollouts(dir: string, sessionId: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth < 4) await walk(join(d, e.name), depth + 1);
      } else if (
        e.name.startsWith("rollout-") &&
        e.name.endsWith(".jsonl") &&
        e.name.includes(sessionId)
      ) {
        found.push(join(d, e.name));
      }
    }
  };
  await walk(dir, 0);
  return found.sort();
}
