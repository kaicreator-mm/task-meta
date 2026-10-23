import { GhCliClient, type GitHubClient } from "../publish/index.ts";

/** What auto-report needs beyond the report publisher: PR to linked Issue lookup. */
export interface AutoReportGitHub extends GitHubClient {
  /** Issue numbers (same repository) a PR closes or references; empty when none. */
  linkedIssuesOfPr(repo: string, pr: number): Promise<number[]>;
}

const GRAPHQL =
  "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:20){nodes{number repository{nameWithOwner}}}}}}";

const uniqSorted = (xs: number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);

interface ClosingNodes {
  data?: {
    repository?: {
      pullRequest?: {
        closingIssuesReferences?: {
          nodes?: Array<{ number?: number; repository?: { nameWithOwner?: string } }>;
        };
      };
    };
  };
}

/** `gh`-backed client. Only used for real runs; tests inject a fake. */
export class GhAutoReportClient extends GhCliClient implements AutoReportGitHub {
  async linkedIssuesOfPr(repo: string, pr: number): Promise<number[]> {
    const [owner, name] = repo.split("/");
    if (owner === undefined || name === undefined || !Number.isInteger(pr) || pr <= 0) {
      throw new Error("invalid pull request target");
    }
    const gql = await this.exec(this.gh, [
      "api",
      "graphql",
      "-f",
      `query=${GRAPHQL}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${pr}`,
    ]);
    const nodes =
      (JSON.parse(gql.stdout) as ClosingNodes).data?.repository?.pullRequest
        ?.closingIssuesReferences?.nodes ?? [];
    const closing = nodes
      .filter((n) => typeof n.number === "number" && n.repository?.nameWithOwner === repo)
      .map((n) => n.number as number);
    if (closing.length > 0) return uniqSorted(closing);

    // No closing refs: take same-repository `#n` refs from the PR title/body that are Issues.
    const pull = await this.exec(this.gh, ["api", `repos/${repo}/pulls/${pr}`]);
    const p = JSON.parse(pull.stdout) as { title?: unknown; body?: unknown };
    const text = `${typeof p.title === "string" ? p.title : ""}\n${typeof p.body === "string" ? p.body : ""}`;
    const cands = uniqSorted(
      [...text.matchAll(/(?<![\w/&])#(\d{1,6})\b/g)]
        .map((m) => Number(m[1]))
        .filter((n) => n !== pr),
    ).slice(0, 8);
    const issues: number[] = [];
    for (const n of cands) {
      try {
        const r = await this.exec(this.gh, ["api", `repos/${repo}/issues/${n}`]);
        const j = JSON.parse(r.stdout) as { pull_request?: unknown };
        if (j.pull_request === undefined) issues.push(n);
      } catch {
        // not an issue of this repository
      }
    }
    return issues;
  }
}
