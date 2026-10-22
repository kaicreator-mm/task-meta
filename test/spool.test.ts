import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Spool } from "../src/store/index.ts";

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tm-spool-"));
  path = join(dir, "sub", "outbox.jsonl");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("replay of a missing file is empty", async () => {
  assert.deepEqual(await new Spool(path).replay(), { entries: [], skipped: [] });
});

test("3 appends + truncated trailing line: 3 entries, 1 skipped", async () => {
  const s = new Spool(path);
  await s.append({ n: 1 });
  await s.append({ n: 2 });
  await s.append({ n: 3 });
  await appendFile(path, '{"d":"abc","e":{"n"');
  const r = await s.replay();
  assert.deepEqual(r.entries, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0]?.line, 4);
  // A later append starts on a fresh line and is not glued to the garbage.
  await s.append({ n: 4 });
  const r2 = await s.replay();
  assert.deepEqual(r2.entries, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
  assert.equal(r2.skipped.length, 1);
});

test("corrupted middle line (digest mismatch) is skipped and reported", async () => {
  const s = new Spool(path);
  await s.append({ n: 1 });
  await s.append({ n: 2 });
  await s.append({ n: 3 });
  const lines = (await readFile(path, "utf8")).split("\n");
  lines[1] = (lines[1] as string).replace('"n":2', '"n":9');
  await writeFile(path, lines.join("\n"));
  const r = await s.replay();
  assert.deepEqual(r.entries, [{ n: 1 }, { n: 3 }]);
  assert.deepEqual(r.skipped, [{ line: 2, reason: "digest mismatch" }]);
});

test("garbage lines are skipped; duplicates are returned as-is", async () => {
  const s = new Spool(path);
  await s.append({ n: 1 });
  await s.append({ n: 1 });
  await appendFile(path, "not json\n[1]\n");
  const r = await s.replay();
  assert.deepEqual(r.entries, [{ n: 1 }, { n: 1 }]);
  assert.equal(r.skipped.length, 2);
});
