import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  ConflictError,
  EvidenceStore,
  LineageError,
  NotFoundError,
  TamperError,
} from "../src/store/index.ts";

let root: string;
let store: EvidenceStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tm-store-"));
  store = new EvidenceStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const objPath = (d: string) => join(root, "objects", "sha256", d.slice(0, 2), `${d}.json`);

test("put/get round trip, key order irrelevant, idempotent", async () => {
  const a = await store.putObject({ b: 1, a: [1, 2] });
  assert.equal(a.existed, false);
  assert.match(a.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(await store.getObject(a.digest), { a: [1, 2], b: 1 });
  const b = await store.putObject({ a: [1, 2], b: 1 });
  assert.equal(b.digest, a.digest);
  assert.equal(b.existed, true);
});

test("tampered object: getObject and verifyManifest report it; put never overwrites", async () => {
  const o = await store.putObject({ x: 1 });
  const m = await store.writeManifest({
    attempt_ref: "att-1",
    revision: 1,
    objects: [{ role: "r", digest: o.digest }],
    predecessor: null,
    created_at: "2026-01-01T00:00:00Z",
  });
  await writeFile(objPath(o.digest), '{"x":2}');
  await assert.rejects(store.getObject(o.digest), TamperError);
  const v = await store.verifyManifest(m.sha256);
  assert.equal(v.ok, false);
  assert.equal(v.manifest_ok, true);
  assert.deepEqual(v.tampered, [o.digest]);
  await assert.rejects(store.putObject({ x: 1 }), TamperError);
  assert.equal(await readFile(objPath(o.digest), "utf8"), '{"x":2}');
});

test("missing object is listed by verifyManifest; missing getObject is NotFound", async () => {
  const o = await store.putObject({ y: 1 });
  const m = await store.writeManifest({
    attempt_ref: "att-2",
    revision: 1,
    objects: [{ role: "r", digest: o.digest }],
    predecessor: null,
    created_at: "t",
  });
  await rm(objPath(o.digest));
  const v = await store.verifyManifest(m.sha256);
  assert.deepEqual(v.missing, [o.digest]);
  assert.equal(v.ok, false);
  await assert.rejects(store.getObject(o.digest), NotFoundError);
});

test("invalid digest strings are rejected", async () => {
  for (const bad of ["../x", "A".repeat(64), "abc", `${"a".repeat(63)}/`, ""]) {
    await assert.rejects(store.getObject(bad), TypeError);
  }
});

test("manifest lineage rules", async () => {
  const o = await store.putObject({ z: 1 });
  const base = {
    attempt_ref: "att-3",
    objects: [{ role: "r", digest: o.digest }],
    created_at: "t",
  };
  await assert.rejects(
    store.writeManifest({ ...base, revision: 1, predecessor: "a".repeat(64) }),
    LineageError,
  );
  const r1 = await store.writeManifest({ ...base, revision: 1, predecessor: null });
  await assert.rejects(
    store.writeManifest({ ...base, revision: 2, predecessor: "b".repeat(64) }),
    LineageError,
  );
  await assert.rejects(
    store.writeManifest({ ...base, revision: 2, predecessor: null }),
    LineageError,
  );
  await assert.rejects(
    store.writeManifest({ ...base, revision: 3, predecessor: r1.sha256 }),
    LineageError,
  );
  const r2 = await store.writeManifest({ ...base, revision: 2, predecessor: r1.sha256 });
  assert.equal(r2.revision, 2);
  assert.equal((await store.readManifest("att-3")).revision, 2);
  assert.equal((await store.readManifest("att-3", 1)).revision, 1);
  await assert.rejects(store.readManifest("att-3", 9), NotFoundError);
  await assert.rejects(store.readManifest("nope"), NotFoundError);
});

test("rewriting a revision: different content conflicts, same content is idempotent", async () => {
  const o1 = await store.putObject({ k: 1 });
  const o2 = await store.putObject({ k: 2 });
  const mk = (d: string) => ({
    attempt_ref: "att-4",
    revision: 1,
    objects: [{ role: "r", digest: d }],
    predecessor: null,
    created_at: "t",
  });
  const a = await store.writeManifest(mk(o1.digest));
  const again = await store.writeManifest(mk(o1.digest));
  assert.deepEqual(again, a);
  await assert.rejects(store.writeManifest(mk(o2.digest)), ConflictError);
});

test("manifest referencing a missing object is NotFound", async () => {
  await assert.rejects(
    store.writeManifest({
      attempt_ref: "att-5",
      revision: 1,
      objects: [{ role: "r", digest: "c".repeat(64) }],
      predecessor: null,
      created_at: "t",
    }),
    NotFoundError,
  );
});

test("pointer ref never leaks a filesystem path", async () => {
  const o = await store.putObject({ p: 1 });
  const p = await store.writeManifest({
    attempt_ref: "att-6",
    revision: 1,
    objects: [{ role: "r", digest: o.digest }],
    predecessor: null,
    created_at: "t",
  });
  assert.equal(p.ref, `task-meta-private://sha256/${p.sha256}`);
  assert.match(p.ref, /^task-meta-private:\/\/sha256\/[0-9a-f]{64}$/);
  assert.equal(p.access, "PROJECT_PRIVATE");
  assert.ok(!p.ref.includes("\\"));
  assert.ok(!p.ref.includes(root));
  assert.ok((await store.verifyManifest(p.sha256)).ok);
});

test("crash simulation: stray tmp file is removed by recover; store still verifies", async () => {
  const o = await store.putObject({ c: 1 });
  const p = await store.writeManifest({
    attempt_ref: "att-7",
    revision: 1,
    objects: [{ role: "r", digest: o.digest }],
    predecessor: null,
    created_at: "t",
  });
  await writeFile(join(root, "tmp", "deadbeef"), "partial");
  assert.deepEqual(await store.recover(), { removed_tmp: 1 });
  assert.deepEqual(await readdir(join(root, "tmp")), []);
  assert.ok((await store.verifyManifest(p.sha256)).ok);
  assert.deepEqual(await new EvidenceStore(join(root, "fresh")).recover(), { removed_tmp: 0 });
});

test("concurrent identical puts all succeed and leave one file", async () => {
  const rs = await Promise.all(Array.from({ length: 20 }, () => store.putObject({ same: "v" })));
  assert.equal(new Set(rs.map((r) => r.digest)).size, 1);
  assert.equal(rs.filter((r) => !r.existed).length >= 1, true);
  const d = (rs[0] as { digest: string }).digest;
  assert.deepEqual(await readdir(join(root, "objects", "sha256", d.slice(0, 2))), [`${d}.json`]);
  assert.deepEqual(await readdir(join(root, "tmp")), []);
});
