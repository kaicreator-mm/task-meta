// GENERATED from plugins/shared/binding-extract.mjs by scripts/sync-plugin-shared.mjs; do not edit.
"use strict";
// Task-binding reference extraction. Pure, dependency-free (Node built-ins only).
// Shared source: copied into each plugin's scripts/lib/ by `npm run sync-plugins`.
// The input text is examined in memory; the output holds ONLY normalized refs
// (kind + known repository name + number), never any substring of the text.

const MAX_REFS = 32;
const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9._-]*/g;
// Characters allowed between a repo mention, version tokens, keywords and the "#".
const GAP_RE = /^[\s:：,，、/\-–—()（）"'`的中里在]*$/;
const VERSION_RE = /^v?\d+(\.\d+){1,3}([-+][A-Za-z0-9.]+)?$|^v\d+$/i;
const KEYWORDS = new Set(["pr", "mr", "pull", "request", "issue", "issues"]);

/** Lowercase lookup of repo names and aliases to canonical repo names. */
function repoMap(opts) {
  const m = new Map();
  for (const r of opts?.knownRepos ?? []) {
    if (typeof r === "string" && r !== "") m.set(r.toLowerCase(), r);
  }
  for (const [a, r] of Object.entries(opts?.aliases ?? {})) {
    if (typeof a === "string" && typeof r === "string" && a !== "" && r !== "") {
      m.set(a.toLowerCase(), r);
    }
  }
  return m;
}

function trimToken(t) {
  return t.replace(/[._-]+$/, "");
}

function lookup(map, token) {
  return map.get(trimToken(token).toLowerCase()) ?? null;
}

function toNumber(s) {
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function blank(text, start, end) {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

/**
 * @param {string} text
 * @param {{ aliases?: Record<string,string>, knownRepos?: string[] }} opts
 * @returns {{ refs: Array<{ kind: "ISSUE"|"PR"|"REPO", repo: string|null, number: number|null }> }}
 */
function extractRefs(text, opts = {}) {
  if (typeof text !== "string" || text === "") return { refs: [] };
  const map = repoMap(opts);
  /** @type {Array<{ pos: number, kind: string, repo: string|null, number: number|null }>} */
  const found = [];
  /** @type {Array<{ pos: number, repo: string }>} */
  const mentions = [];
  let work = text;

  // 1) GitHub URLs.
  const urlRe = /github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d{1,7})(?![\w])/gi;
  for (const m of text.matchAll(urlRe)) {
    const repo = lookup(map, m[2]);
    const n = toNumber(m[4]);
    work = blank(work, m.index, m.index + m[0].length);
    if (repo === null || n === null) continue;
    found.push({
      pos: m.index,
      kind: m[3].toLowerCase() === "pull" ? "PR" : "ISSUE",
      repo,
      number: n,
    });
    mentions.push({ pos: m.index, repo });
  }

  // 2) owner/repo#n
  const slashRe = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d{1,7})(?![\w])/g;
  for (const m of work.matchAll(slashRe)) {
    const repo = lookup(map, m[2]);
    const n = toNumber(m[3]);
    if (repo === null || n === null) continue;
    found.push({ pos: m.index, kind: "ISSUE", repo, number: n });
    mentions.push({ pos: m.index, repo });
    work = blank(work, m.index, m.index + m[0].length);
  }

  // 3) repo / alias mentions (whole ASCII tokens).
  const tokens = [];
  for (const m of work.matchAll(TOKEN_RE)) {
    const repo = lookup(map, m[0]);
    tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], repo });
    if (repo !== null) mentions.push({ pos: m.index, repo });
  }

  // 4) "#n" references.
  const hashRe = /(?<![&#])#(\d{1,6})(?![\w])/g;
  for (const m of work.matchAll(hashRe)) {
    const n = toNumber(m[1]);
    if (n === null) continue;
    const hashPos = m.index;
    // Glued forms ("PR#5", "dh#12") only count after a repo/alias or a PR/issue keyword.
    if (/\w/.test(work[hashPos - 1] ?? "")) {
      const glued = tokens.find((t) => t.end === hashPos);
      if (!glued || (glued.repo === null && !KEYWORDS.has(trimToken(glued.text).toLowerCase()))) {
        continue;
      }
    }
    let kind = "ISSUE";
    let repo = null;
    let cursor = hashPos;
    let seen = 0;
    // Walk back over up to ~4 tokens (version tokens and PR/issue keywords do not count).
    const before = tokens.filter((t) => t.end <= hashPos);
    for (let i = before.length - 1; i >= 0 && seen < 4; i--) {
      const t = before[i];
      if (!GAP_RE.test(work.slice(t.end, cursor))) break;
      cursor = t.start;
      const low = trimToken(t.text).toLowerCase();
      if (VERSION_RE.test(trimToken(t.text))) continue;
      if (KEYWORDS.has(low)) {
        kind = low === "issue" || low === "issues" ? "ISSUE" : "PR";
        continue;
      }
      seen += 1;
      if (t.repo !== null) {
        repo = t.repo;
        break;
      }
    }
    found.push({ pos: hashPos, kind, repo, number: n });
  }

  found.sort((a, b) => a.pos - b.pos);
  mentions.sort((a, b) => a.pos - b.pos);
  const distinctMentioned = new Set(mentions.map((x) => x.repo));
  // A PR without an explicit repo inherits the nearest earlier repo, else the only one mentioned.
  for (const f of found) {
    if (f.kind !== "PR" || f.repo !== null) continue;
    let near = null;
    for (const x of mentions) if (x.pos < f.pos) near = x.repo;
    f.repo = near ?? (distinctMentioned.size === 1 ? [...distinctMentioned][0] : null);
  }

  const refs = [];
  const seenKeys = new Set();
  const push = (kind, repo, number) => {
    const k = `${kind}|${repo ?? ""}|${number ?? ""}`;
    if (seenKeys.has(k) || refs.length >= MAX_REFS) return;
    seenKeys.add(k);
    refs.push({ kind, repo, number });
  };
  for (const f of found) push(f.kind, f.repo, f.number);
  const withNumbers = new Set(found.map((f) => f.repo).filter((r) => r !== null));
  for (const x of mentions) if (!withNumbers.has(x.repo)) push("REPO", x.repo, null);
  return { refs };
}

/**
 * Parse a worktree directory name or branch name following the workspace convention
 * `<repo-or-alias>-i<issue>-<agent>`, `<repo-or-alias>-pr<n>-...`, `task/<name>`.
 * Task numbers (`-t13-`) are not Issue numbers and yield no Issue ref.
 */
function parseWorktreeName(name, opts = {}) {
  if (typeof name !== "string" || name === "") return { refs: [] };
  const map = repoMap(opts);
  const base = name.split(/[/]/).filter(Boolean).pop() ?? "";
  const segs = base.split("-");
  const refs = [];
  let k = -1;
  for (let i = 0; i < segs.length; i++) {
    if (/^(i|pr)\d{1,6}$/i.test(segs[i])) {
      k = i;
      break;
    }
  }
  const limit = k >= 0 ? k : segs.length;
  let repo = null;
  for (let n = limit; n >= 1 && repo === null; n--) {
    repo = map.get(segs.slice(0, n).join("-").toLowerCase()) ?? null;
  }
  if (k >= 0) {
    const m = /^(i|pr)(\d{1,6})$/i.exec(segs[k]);
    const num = toNumber(m[2]);
    if (num !== null)
      refs.push({ kind: m[1].toLowerCase() === "pr" ? "PR" : "ISSUE", repo, number: num });
  } else if (repo !== null) {
    refs.push({ kind: "REPO", repo, number: null });
  }
  return { refs };
}

module.exports = { extractRefs, parseWorktreeName };
