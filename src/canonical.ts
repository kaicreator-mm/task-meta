// RFC 8785 JSON Canonicalization Scheme (JCS) + SHA-256, as required by ADS v4.15 §16.5
// for the public report data digest and used by task-meta for private object addressing.
import { createHash } from "node:crypto";

const MAX_SAFE = 2 ** 53 - 1;

export class CanonicalizationError extends Error {}

/** Serialize a JSON value to its RFC 8785 canonical string. Rejects non-JSON values. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError("non-finite number");
      if (Number.isInteger(value) && Math.abs(value) > MAX_SAFE) {
        throw new CanonicalizationError("integer outside ±(2^53−1) must be a string");
      }
      // ECMAScript shortest round-trip form; JSON.stringify(-0) is already "0".
      return JSON.stringify(value);
    case "string":
      if (/\p{Surrogate}/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))) {
        throw new CanonicalizationError("lone surrogate in string");
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError("non-plain object");
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (obj[k] === undefined) throw new CanonicalizationError(`undefined value at key ${k}`);
        parts.push(`${canonicalize(k)}:${canonicalize(obj[k])}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported type ${typeof value}`);
  }
}

export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Lowercase SHA-256 over the UTF-8 JCS form. */
export function canonicalDigest(value: unknown): string {
  return sha256Hex(Buffer.from(canonicalize(value), "utf8"));
}
