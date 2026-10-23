import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface IssueComment {
  id: number;
  html_url: string;
  body: string;
  user_login: string | null;
  /** ISO timestamp of creation (absent in minimal fakes). */
  created_at?: string;
}

export interface GitHubClient {
  listIssueComments(
    repo: string,
    issue: number,
    page: number,
    perPage: number,
  ): Promise<{ comments: IssueComment[]; hasNext: boolean }>;
  createIssueComment(repo: string, issue: number, body: string): Promise<IssueComment>;
}

/** Thrown by clients for an HTTP-level failure. Network errors carry no status. */
export class GitHubHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "GitHubHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFn = (file, args) =>
  new Promise((resolve, reject) => {
    // shell is off by default: argv is passed verbatim, never through a shell.
    execFile(
      file,
      args,
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as Error & { stderr?: string };
          e.stderr = String(stderr ?? "");
          reject(e);
        } else resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function checkTarget(repo: string, issue: number): void {
  if (!REPO_RE.test(repo)) throw new Error(`invalid repo: ${repo}`);
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`invalid issue number: ${issue}`);
}

function mapError(err: unknown): Error {
  const e = err as Error & { stderr?: string };
  const text = `${e.stderr ?? ""}\n${e.message ?? ""}`;
  const m = /HTTP (\d{3})/.exec(text);
  if (!m) return e instanceof Error ? e : new Error(String(err));
  const status = Number(m[1]);
  const ra = /retry-after:?\s*(\d+)/i.exec(text);
  let retryAfter: number | null = ra ? Number(ra[1]) : null;
  if (retryAfter === null && status === 403 && /rate limit/i.test(text)) retryAfter = 60;
  return new GitHubHttpError(status, text.trim().slice(0, 300), retryAfter);
}

function toComment(raw: unknown): IssueComment {
  const r = raw as {
    id?: unknown;
    html_url?: unknown;
    body?: unknown;
    user?: { login?: unknown } | null;
    created_at?: unknown;
  };
  if (typeof r?.id !== "number") throw new Error("gh: comment without numeric id");
  return {
    id: r.id,
    html_url: typeof r.html_url === "string" ? r.html_url : "",
    body: typeof r.body === "string" ? r.body : "",
    user_login: typeof r.user?.login === "string" ? r.user.login : null,
    ...(typeof r.created_at === "string" ? { created_at: r.created_at } : {}),
  };
}

/** GitHub client over the `gh` CLI (`gh api`). Never invoked by tests against a real repo. */
export class GhCliClient implements GitHubClient {
  protected readonly exec: ExecFn;
  protected readonly gh: string;
  constructor(opts: { exec?: ExecFn; ghPath?: string } = {}) {
    this.exec = opts.exec ?? defaultExec;
    this.gh = opts.ghPath ?? "gh";
  }

  listArgs(repo: string, issue: number, page: number, perPage: number): string[] {
    checkTarget(repo, issue);
    return [
      "api",
      "-H",
      "Accept: application/vnd.github+json",
      `repos/${repo}/issues/${issue}/comments?per_page=${perPage}&page=${page}`,
    ];
  }

  createArgs(repo: string, issue: number, bodyFile: string): string[] {
    checkTarget(repo, issue);
    return [
      "api",
      "-X",
      "POST",
      "-H",
      "Accept: application/vnd.github+json",
      `repos/${repo}/issues/${issue}/comments`,
      "-F",
      `body=@${bodyFile}`,
    ];
  }

  async listIssueComments(repo: string, issue: number, page: number, perPage: number) {
    const args = this.listArgs(repo, issue, page, perPage);
    let stdout: string;
    try {
      ({ stdout } = await this.exec(this.gh, args));
    } catch (err) {
      throw mapError(err);
    }
    const arr: unknown = JSON.parse(stdout);
    if (!Array.isArray(arr)) throw new Error("gh: expected a JSON array of comments");
    // A full page may be followed by an empty one; that costs one extra request, never a miss.
    return { comments: arr.map(toComment), hasNext: arr.length >= perPage };
  }

  async createIssueComment(repo: string, issue: number, body: string): Promise<IssueComment> {
    checkTarget(repo, issue);
    const dir = await mkdtemp(join(tmpdir(), "task-meta-gh-"));
    try {
      const file = join(dir, "body.md");
      await writeFile(file, body, "utf8");
      let stdout: string;
      try {
        ({ stdout } = await this.exec(this.gh, this.createArgs(repo, issue, file)));
      } catch (err) {
        throw mapError(err);
      }
      return toComment(JSON.parse(stdout));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
