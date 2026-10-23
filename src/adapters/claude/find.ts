import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface ClaudeTranscriptFiles {
  /** `<projects>/<slug>/<sessionId>.jsonl` (normally one; a moved project may leave copies). */
  main: string[];
  /** `<projects>/<slug>/<sessionId>/subagents/*.jsonl` */
  subagents: string[];
}

/** Transcript files of one Claude Code session under the projects dir (depth: slug dirs only). */
export async function findClaudeTranscripts(
  projectsDir: string,
  sessionId: string,
): Promise<ClaudeTranscriptFiles> {
  const found: ClaudeTranscriptFiles = { main: [], subagents: [] };
  let slugs: string[];
  try {
    slugs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return found;
  }
  for (const slug of slugs.sort()) {
    const dir = join(projectsDir, slug);
    try {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name === `${sessionId}.jsonl`) found.main.push(join(dir, e.name));
      }
    } catch {
      // unreadable project dir: skipped
    }
    try {
      const sub = join(dir, sessionId, "subagents");
      for (const e of await readdir(sub, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".jsonl")) found.subagents.push(join(sub, e.name));
      }
    } catch {
      // no subagents for this session in this project dir
    }
  }
  found.subagents.sort();
  return found;
}
