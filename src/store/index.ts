import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalize, sha256Hex } from "../canonical.ts";
import type { ManifestPointer } from "../model.ts";
import { ConflictError, LineageError, NotFoundError, TamperError } from "./errors.ts";

export { ConflictError, LineageError, NotFoundError, TamperError } from "./errors.ts";
export { Spool } from "./spool.ts";

const DIGEST_RE = /^[0-9a-f]{64}$/;
const MANIFEST_SCHEMA = "task-meta/manifest/v1";
const REF_PREFIX = "task-meta-private://sha256/";

export interface ManifestObjectRef {
  role: string;
  digest: string;
}
export interface ManifestInput {
  attempt_ref: string;
  revision: number;
  objects: ManifestObjectRef[];
  predecessor: string | null;
  created_at: string;
}
export interface ManifestDoc extends ManifestInput {
  schema: typeof MANIFEST_SCHEMA;
}

function assertDigest(d: unknown): asserts d is string {
  if (typeof d !== "string" || !DIGEST_RE.test(d)) {
    throw new TypeError(`invalid digest: ${String(d)}`);
  }
}
const isCode = (e: unknown, ...codes: string[]) =>
  codes.includes((e as NodeJS.ErrnoException)?.code ?? "");

export class EvidenceStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private objectPath(digest: string): string {
    return join(this.root, "objects", "sha256", digest.slice(0, 2), `${digest}.json`);
  }
  private manifestDir(attemptRef: string): string {
    return join(this.root, "manifests", sha256Hex(attemptRef).slice(0, 32));
  }

  /** true if path exists and hashes to digest; false if absent; TamperError if present but wrong. */
  private async tryVerify(path: string, digest: string): Promise<boolean> {
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (e) {
      if (isCode(e, "ENOENT")) return false;
      throw e;
    }
    if (sha256Hex(bytes) !== digest) {
      throw new TamperError(`object ${digest} content does not match its digest`);
    }
    return true;
  }

  async putObject(value: unknown): Promise<{ digest: string; existed: boolean }> {
    const bytes = Buffer.from(canonicalize(value), "utf8");
    const digest = sha256Hex(bytes);
    const target = this.objectPath(digest);

    if (await this.tryVerify(target, digest)) return { digest, existed: true };

    const tmpDir = join(this.root, "tmp");
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, randomBytes(12).toString("hex"));
    const fh = await open(tmp, "wx");
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      try {
        await rename(tmp, target);
        return { digest, existed: false };
      } catch (e) {
        // Concurrent writer (EPERM/EEXIST/EBUSY on Windows): treat as "already exists -> verify".
        if (!isCode(e, "EPERM", "EEXIST", "EBUSY", "EACCES")) throw e;
        if (await this.tryVerify(target, digest)) return { digest, existed: true };
        throw e;
      }
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }

  async getObject(digest: string): Promise<unknown> {
    assertDigest(digest);
    let bytes: Buffer;
    try {
      bytes = await readFile(this.objectPath(digest));
    } catch (e) {
      if (isCode(e, "ENOENT")) throw new NotFoundError(`object ${digest} not found`);
      throw e;
    }
    if (sha256Hex(bytes) !== digest) {
      throw new TamperError(`object ${digest} content does not match its digest`);
    }
    return JSON.parse(bytes.toString("utf8"));
  }

  private async readIndex(attemptRef: string, revision: number): Promise<string | null> {
    let text: string;
    try {
      text = await readFile(join(this.manifestDir(attemptRef), `${revision}.json`), "utf8");
    } catch (e) {
      if (isCode(e, "ENOENT")) return null;
      throw e;
    }
    let d: unknown;
    try {
      d = (JSON.parse(text) as { digest?: unknown }).digest;
    } catch {
      throw new TamperError(`manifest index ${revision} is corrupt`);
    }
    if (typeof d !== "string" || !DIGEST_RE.test(d)) {
      throw new TamperError(`manifest index ${revision} is corrupt`);
    }
    return d;
  }

  async writeManifest(input: ManifestInput): Promise<ManifestPointer & { revision: number }> {
    const { attempt_ref, revision, objects, predecessor, created_at } = input;
    if (typeof attempt_ref !== "string" || attempt_ref === "") {
      throw new TypeError("attempt_ref must be a non-empty string");
    }
    if (!Number.isInteger(revision) || revision < 1) {
      throw new TypeError("revision must be a positive integer");
    }
    for (const o of objects) {
      assertDigest(o.digest);
      await this.getObject(o.digest); // NotFoundError / TamperError
    }
    if (revision === 1) {
      if (predecessor !== null) throw new LineageError("revision 1 must have null predecessor");
    } else {
      if (predecessor === null) throw new LineageError(`revision ${revision} needs a predecessor`);
      const prev = await this.readIndex(attempt_ref, revision - 1);
      if (prev === null) throw new LineageError(`revision ${revision - 1} does not exist`);
      if (prev !== predecessor) {
        throw new LineageError(`predecessor is not revision ${revision - 1}'s manifest digest`);
      }
    }
    const doc: ManifestDoc = {
      schema: MANIFEST_SCHEMA,
      attempt_ref,
      revision,
      predecessor,
      created_at,
      objects: objects.map((o) => ({ role: o.role, digest: o.digest })),
    };
    const { digest } = await this.putObject(doc);

    const dir = this.manifestDir(attempt_ref);
    await mkdir(dir, { recursive: true });
    try {
      const fh = await open(join(dir, `${revision}.json`), "wx");
      try {
        await fh.writeFile(JSON.stringify({ digest }));
        await fh.sync();
      } finally {
        await fh.close();
      }
    } catch (e) {
      if (!isCode(e, "EEXIST")) throw e;
      const cur = await this.readIndex(attempt_ref, revision);
      if (cur !== digest) {
        throw new ConflictError(`revision ${revision} already written with different content`);
      }
    }
    return { ref: `${REF_PREFIX}${digest}`, sha256: digest, access: "PROJECT_PRIVATE", revision };
  }

  async readManifest(attempt_ref: string, revision?: number): Promise<ManifestDoc> {
    let rev = revision;
    if (rev === undefined) {
      let names: string[];
      try {
        names = await readdir(this.manifestDir(attempt_ref));
      } catch (e) {
        if (isCode(e, "ENOENT")) throw new NotFoundError(`no manifests for ${attempt_ref}`);
        throw e;
      }
      const revs = names
        .map((n) => /^(\d+)\.json$/.exec(n)?.[1])
        .filter((x): x is string => x !== undefined)
        .map(Number);
      if (revs.length === 0) throw new NotFoundError(`no manifests for ${attempt_ref}`);
      rev = Math.max(...revs);
    }
    const digest = await this.readIndex(attempt_ref, rev);
    if (digest === null) throw new NotFoundError(`revision ${rev} not found`);
    const doc = (await this.getObject(digest)) as ManifestDoc;
    if (doc.attempt_ref !== attempt_ref || doc.revision !== rev) {
      throw new TamperError("manifest index points at a different manifest");
    }
    return doc;
  }

  async verifyManifest(digest: string): Promise<{
    ok: boolean;
    manifest_ok: boolean;
    missing: string[];
    tampered: string[];
  }> {
    assertDigest(digest);
    const missing: string[] = [];
    const tampered: string[] = [];
    let doc: ManifestDoc | null = null;
    try {
      doc = (await this.getObject(digest)) as ManifestDoc;
      if (doc?.schema !== MANIFEST_SCHEMA || !Array.isArray(doc.objects)) doc = null;
    } catch (e) {
      if (!(e instanceof TamperError || e instanceof NotFoundError)) throw e;
    }
    if (doc === null) return { ok: false, manifest_ok: false, missing, tampered };
    for (const o of doc.objects) {
      try {
        await this.getObject(o.digest);
      } catch (e) {
        if (e instanceof NotFoundError) missing.push(o.digest);
        else if (e instanceof TamperError) tampered.push(o.digest);
        else throw e;
      }
    }
    return {
      ok: missing.length === 0 && tampered.length === 0,
      manifest_ok: true,
      missing,
      tampered,
    };
  }

  async recover(): Promise<{ removed_tmp: number }> {
    const dir = join(this.root, "tmp");
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      if (isCode(e, "ENOENT")) return { removed_tmp: 0 };
      throw e;
    }
    for (const n of names) await rm(join(dir, n), { recursive: true, force: true });
    return { removed_tmp: names.length };
  }
}
