export interface ExtractedRef {
  kind: "ISSUE" | "PR" | "REPO";
  repo: string | null;
  number: number | null;
}
export interface ExtractOptions {
  aliases?: Record<string, string>;
  knownRepos?: string[];
}
export function extractRefs(text: string, opts?: ExtractOptions): { refs: ExtractedRef[] };
export function parseWorktreeName(name: string, opts?: ExtractOptions): { refs: ExtractedRef[] };
