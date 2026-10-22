import assert from "node:assert/strict";
import { test } from "node:test";
import { CanonicalizationError, canonicalDigest, canonicalize } from "../src/canonical.ts";

test("sorts keys by UTF-16 code units and strips whitespace", () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
  // RFC 8785 §3.2.3 sorting example: "€" (U+20AC) sorts before "😀" (surrogates).
  assert.equal(canonicalize({ "😀": 1, "€": 2 }), '{"€":2,"😀":1}');
});

test("RFC 8785 Appendix B number samples", () => {
  const cases: Array<[number, string]> = [
    [0, "0"],
    [-0, "0"],
    [5e-324, "5e-324"],
    [0.000001, "0.000001"],
    [1e-7, "1e-7"],
    [333333333.3333333, "333333333.3333333"],
    [9007199254740991, "9007199254740991"],
  ];
  for (const [n, s] of cases) assert.equal(canonicalize(n), s);
});

test("rejects non-JSON values", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, undefined, () => 1]) {
    assert.throws(() => canonicalize(bad), CanonicalizationError);
  }
  assert.throws(() => canonicalize({ a: undefined }), CanonicalizationError);
  assert.throws(() => canonicalize("\uD800"), CanonicalizationError);
  assert.throws(() => canonicalize(new Date(0)), CanonicalizationError);
});

test("equal data in different key order has equal digest", () => {
  const a = canonicalDigest({ x: 1, y: { p: "q", r: [1, 2] } });
  const b = canonicalDigest({ y: { r: [1, 2], p: "q" }, x: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, canonicalDigest({ x: 1, y: { p: "q", r: [2, 1] } }));
});
