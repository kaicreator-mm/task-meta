// v0.4 I (#73) — source-only integration of A1's read-only Doctor CLI.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../../src/cli.ts";

async function invoke(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr };
}

test("I: central doctor --catalog exposes only A1 typed rule source (no I/O)", async () => {
  const r = await invoke(["doctor", "--catalog"]);
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(doc.mode, "CATALOG_ONLY");
  assert.equal(doc.evidence, "NOT_RUN");
  assert.equal(doc.network_used, false);
  assert.deepEqual(doc.writes_performed, []);
  assert.deepEqual(doc.repairs_performed, []);
  const rules = doc.catalog as Array<{ code: string; skill_id: string }>;
  assert.ok(rules.some((rule) => rule.code === "STATUS_JOURNAL_INCOMPLETE"));
  assert.ok(rules.every((rule) => rule.skill_id === `task-meta-doctor/${rule.code.toLowerCase()}`));
});

test("I: supplied preclassified evidence is diagnosed, identifiers redacted, no live scan claimed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tm-i-doctor-"));
  try {
    const source = join(dir, "safe.json");
    const sentinel = "SENTINEL-RAW-PROMPT-SHOULD-NOT-ECHO";
    await writeFile(
      source,
      JSON.stringify({
        spool: [{ path: `C:\\Users\\private\\${sentinel}`, parse_ok: false }],
        hook_errors: [
          { source: "RAW_LOG", error_class: sentinel },
          { source: "TRUSTED_WITNESS", error_class: "SPOOL_WRITE_FAILED" },
          { source: "TRUSTED_WITNESS", error_class: sentinel },
        ],
        paths: [{ path: `/home/user/${sentinel}`, is_symlink: true, target_inside_repo: false }],
        credentials: [{ name: sentinel, looks_like_secret: true }],
        clients: [
          { client: "zcode", help_output_available: true },
          { client: sentinel, help_output_available: false },
        ],
        publication_statuses: [{ status: "UNKNOWN", target_ref: sentinel }],
        post_effects: [{ effect: "SENT_OR_MAY_HAVE_SENT", target_ref: sentinel }],
      }),
      "utf8",
    );
    const r = await invoke(["doctor", "--input", source]);
    assert.equal(r.code, 0, r.stderr);
    const doc = JSON.parse(r.stdout) as {
      evidence: string;
      mode: string;
      repo_root: string;
      findings: Array<{ rule: { code: string }; target_ref: string }>;
      network_used: boolean;
      writes_performed: unknown[];
      repairs_performed: unknown[];
    };
    assert.equal(doc.mode, "PRECLASSIFIED_EVIDENCE_ONLY");
    assert.equal(doc.evidence, "SOURCE_ONLY");
    assert.equal(doc.repo_root, "repo:redacted");
    assert.equal(doc.network_used, false);
    assert.deepEqual(doc.writes_performed, []);
    assert.deepEqual(doc.repairs_performed, []);
    assert.ok(doc.findings.some((f) => f.rule.code === "SPOOL_CORRUPT_LINE"));
    assert.ok(doc.findings.some((f) => f.rule.code === "STATUS_UNKNOWN"));
    assert.ok(doc.findings.some((f) => f.rule.code === "HOOK_ERROR_SOURCE_UNTRUSTED"));
    assert.ok(!doc.findings.some((f) => f.rule.code === "HOOK_ERROR_CLASSIFIED"));
    assert.ok(doc.findings.some((f) => f.rule.code === "POST_EFFECT_CLASSIFIED"));
    assert.equal(r.stdout.includes(sentinel), false, "private source text must never escape");
    assert.equal(r.stdout.includes(dir), false, "private host path must never escape");
    assert.equal(r.stdout.includes("C:\\Users"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("I: malformed doctor inputs and conflicting flags fail closed without sensitive echo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tm-i-doctor-bad-"));
  try {
    const file = join(dir, "input.json");
    await writeFile(file, JSON.stringify({ credentials: "SENTINEL-SECRET" }));
    const invalid = await invoke(["doctor", "--input", file]);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.stdout, "");
    assert.ok(!invalid.stderr.includes("SENTINEL"));
    assert.ok(!invalid.stderr.includes(dir));
    const flags = await invoke(["doctor", "--catalog", "--input", file]);
    assert.equal(flags.code, 2);
    const unknown = await invoke(["doctor", "--publish"]);
    assert.equal(unknown.code, 2);
    assert.equal(unknown.stdout, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("I: legacy central CLI command parsing remains separate", async () => {
  const r = await invoke(["collect", "--unexpected"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.includes("error:"));
});

test("I R1 P1: uppercase private class is never reflected even when JSON claims trusted witness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tm-i-hook-privacy-"));
  try {
    const file = join(dir, "input.json");
    for (const value of ["PRIVATE_CUSTOMER_ID_123", "SPOOL_WRITE_FAILED"]) {
      await writeFile(
        file,
        JSON.stringify({ hook_errors: [{ source: "TRUSTED_WITNESS", error_class: value }] }),
        "utf8",
      );
      const result = await invoke(["doctor", "--input", file]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.includes(value), false);
      assert.equal(result.stderr.includes(value), false);
      const report = JSON.parse(result.stdout) as {
        findings: Array<{ rule: { code: string }; target_ref: string }>;
      };
      assert.ok(report.findings.some((f) => f.rule.code === "HOOK_ERROR_SOURCE_UNTRUSTED"));
      assert.ok(report.findings.every((f) => f.target_ref === "hook-error:redacted"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("I R1 P2: every nested evidence array rejects extra fields and malformed types without echo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tm-i-nested-"));
  const sentinel = "PRIVATE_CUSTOMER_ID_123";
  const samples = [
    ["spool", { path: "private", parse_ok: true }],
    ["hook_errors", { source: "TRUSTED_WITNESS", error_class: "SPOOL_WRITE_FAILED" }],
    ["paths", { path: "private", is_symlink: true, target_inside_repo: true }],
    ["credentials", { name: "private", looks_like_secret: true }],
    ["clients", { client: "zcode", help_output_available: true }],
    ["publication_statuses", { status: "HELD", target_ref: "private" }],
    ["post_effects", { effect: "PROVEN_NOT_SENT", target_ref: "private" }],
  ] as const;
  try {
    const file = join(dir, "input.json");
    for (const [field, item] of samples) {
      await writeFile(file, JSON.stringify({ [field]: [{ ...item, raw_prompt: sentinel }] }));
      const unknown = await invoke(["doctor", "--input", file]);
      assert.equal(unknown.code, 2, `unknown nested key must refuse: ${field}`);
      assert.equal(unknown.stdout, "");
      assert.equal(unknown.stderr.includes(sentinel), false);
      assert.equal(unknown.stderr.includes(dir), false);
      const missing = { ...item } as Record<string, unknown>;
      delete missing[Object.keys(missing)[0] as string];
      await writeFile(file, JSON.stringify({ [field]: [missing] }));
      const absent = await invoke(["doctor", "--input", file]);
      assert.equal(absent.code, 2, `missing nested field must refuse: ${field}`);
    }
    for (const [field, item] of samples) {
      const bad = { ...item } as Record<string, unknown>;
      const typeKey: Record<string, string> = {
        spool: "parse_ok",
        hook_errors: "error_class",
        paths: "target_inside_repo",
        credentials: "looks_like_secret",
        clients: "client",
        publication_statuses: "status",
        post_effects: "effect",
      };
      const key = typeKey[field] as string;
      bad[key] = { raw_prompt: sentinel };
      await writeFile(file, JSON.stringify({ [field]: [bad] }));
      const invalid = await invoke(["doctor", "--input", file]);
      assert.equal(invalid.code, 2, `wrong nested type must refuse: ${field}`);
      assert.equal(invalid.stdout, "");
      assert.equal(invalid.stderr.includes(sentinel), false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
