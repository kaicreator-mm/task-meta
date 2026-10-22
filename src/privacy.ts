// Metadata-only guard (DEFINITION §5): flags forbidden keys, planted sentinels,
// absolute local paths and credential-looking strings anywhere in a JSON-like value.

const FORBIDDEN_KEYS = new Set([
  "prompt",
  "system",
  "messages",
  "text",
  "response",
  "request",
  "body",
  "headers",
  "input",
  "arguments",
  "content",
  "providermetadata",
  "authorization",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
  "password",
  "secret",
]);

const ABSOLUTE_PATH_PATTERNS = [/^[A-Za-z]:(?:\\|\/)/, /^\/(home|Users|root|mnt)\//];
const TOKEN_PATTERN = /(?<![A-Za-z0-9])(sk-|ghp_|github_pat_)[A-Za-z0-9_]{10,}/;

/** Returns violation descriptions (empty = clean). */
export function findForbiddenContent(value: unknown, sentinels: string[] = []): string[] {
  const out: string[] = [];
  const visit = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      for (const s of sentinels) {
        if (s && v.includes(s)) out.push(`${path}: contains sentinel ${s}`);
      }
      if (ABSOLUTE_PATH_PATTERNS.some((re) => re.test(v))) out.push(`${path}: absolute path`);
      if (TOKEN_PATTERN.test(v)) out.push(`${path}: credential-like string`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        visit(item, `${path}[${i}]`);
      });
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.has(k.toLowerCase())) out.push(`${path}.${k}: forbidden key`);
        for (const s of sentinels) {
          if (s && k.includes(s)) out.push(`${path}.${k}: key contains sentinel ${s}`);
        }
        visit(child, `${path}.${k}`);
      }
    }
  };
  visit(value, "$");
  return out;
}

export function assertNoForbiddenContent(value: unknown, sentinels: string[] = []): void {
  const violations = findForbiddenContent(value, sentinels);
  if (violations.length > 0) {
    throw new Error(`forbidden content found:\n${violations.join("\n")}`);
  }
}
