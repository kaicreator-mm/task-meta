import type { GitHubClient, IssueComment } from "../publish/index.ts";
import { parseReportComment, REPORT_MARKER } from "../report/index.ts";

export const WRITEBACK_GRACE_MS = 10 * 60 * 1000;
export const MAX_WRITEBACK_CITES = 5;
const PER_PAGE = 100;
const MAX_PAGES = 50;

export function isReportComment(c: IssueComment): boolean {
  return c.body.startsWith(REPORT_MARKER) || parseReportComment(c.body).ok;
}

/**
 * Agent write-back comments (DEFINITION section 1.3): Issue comments created between the session
 * start and the last Stop + 10 minutes that are not ADS report comments. Only ids are returned;
 * comment content is never read further or copied. The latest five are cited.
 */
export async function findWritebackComments(
  client: GitHubClient,
  repo: string,
  issue: number,
  startIso: string,
  stopIso: string,
): Promise<number[]> {
  const from = Date.parse(startIso);
  const to = Date.parse(stopIso) + WRITEBACK_GRACE_MS;
  const hits: Array<{ id: number; t: number }> = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.listIssueComments(repo, issue, page, PER_PAGE);
    for (const c of res.comments) {
      const t = c.created_at ? Date.parse(c.created_at) : Number.NaN;
      if (Number.isNaN(t) || t < from || t > to) continue;
      if (isReportComment(c)) continue;
      hits.push({ id: c.id, t });
    }
    if (!res.hasNext) break;
  }
  hits.sort((a, b) => a.t - b.t || a.id - b.id);
  return hits.slice(-MAX_WRITEBACK_CITES).map((h) => h.id);
}
