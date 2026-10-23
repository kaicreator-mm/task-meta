export function parseGithubRemote(url: string): string | null;
export function gitInfo(cwd: string): {
  git_head: string | null;
  git_dirty: boolean | null;
  git_remote_repo: string | null;
  branch: string | null;
};
