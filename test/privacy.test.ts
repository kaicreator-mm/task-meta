import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoForbiddenContent, findForbiddenContent } from "../src/privacy.ts";

test("clean metadata passes", () => {
  assert.deepEqual(
    findForbiddenContent({
      a: "ok",
      b: [{ input_tokens: 5, tool: { call_id: "x", name: "Read" } }],
    }),
    [],
  );
});

test("forbidden keys are flagged case-insensitively at any depth", () => {
  for (const k of [
    "prompt",
    "System",
    "messages",
    "text",
    "response",
    "request",
    "body",
    "headers",
    "input",
    "arguments",
    "content",
    "providerMetadata",
    "Authorization",
    "cookie",
    "Set-Cookie",
    "api_key",
    "apiKey",
    "password",
    "secret",
  ]) {
    assert.equal(findForbiddenContent({ x: [{ [k]: 1 }] }).length, 1, k);
  }
});

test("absolute paths, token-like strings and sentinels are flagged", () => {
  assert.equal(findForbiddenContent({ p: "C:\\Users\\a\\b" }).length, 1);
  assert.equal(findForbiddenContent({ p: "c:/x" }).length, 1);
  assert.equal(findForbiddenContent({ p: "/home/me/x" }).length, 1);
  assert.equal(findForbiddenContent({ p: "/mnt/c/x" }).length, 1);
  assert.equal(findForbiddenContent({ p: "token ghp_abcdefghij1234" }).length, 1);
  assert.equal(findForbiddenContent({ p: "sk-abcdefghijkl" }).length, 1);
  assert.equal(findForbiddenContent({ p: "github_pat_abcdefghij" }).length, 1);
  assert.equal(findForbiddenContent({ p: "has SENTINEL_X inside" }, ["SENTINEL_X"]).length, 1);
  assert.equal(findForbiddenContent(["SENTINEL_X"], ["SENTINEL_X"]).length, 1);
});

test("relative paths and short sk- strings are not flagged", () => {
  assert.deepEqual(findForbiddenContent({ p: "src/a.ts", q: "sk-short", r: "task-check:abc" }), []);
});

test("assertNoForbiddenContent throws with violations", () => {
  assert.throws(() => assertNoForbiddenContent({ prompt: "x" }), /forbidden key/);
  assert.doesNotThrow(() => assertNoForbiddenContent({ ok: 1 }));
});
