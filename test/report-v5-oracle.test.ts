import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateReportDocument } from "../src/report/index.ts";

const read = (p: string): any => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

const bases: Record<string, any> = {
  summary: read("./fixtures/report/v5-base-summary.json"),
  correction: read("./fixtures/report/v5-base-correction.json"),
  feedback: read("./fixtures/report/v5-base-feedback.json"),
  associated: read("./fixtures/report/v5-base-associated.json"),
};

interface Action {
  path: string;
  value?: unknown;
  remove?: boolean;
}

/** Mirror of mutate() in test_v416_t01_report_schema.py: dot paths, remove or set. */
function mutate(obj: unknown, actions: Action[]): any {
  const x: any = structuredClone(obj);
  for (const item of actions) {
    const parts = item.path.split(".");
    let parent = x;
    for (const p of parts.slice(0, -1)) parent = parent[p];
    const last = parts[parts.length - 1] as string;
    if (item.remove) delete parent[last];
    else parent[last] = item.value;
  }
  return x;
}

describe("v5 oracle: t01-scenarios.json", () => {
  const fx = read("../vendor/ads/v4.16/t01-scenarios.json");
  let executed = 0;

  it("scenario file shape", () => {
    assert.equal(fx.schema, "ads/v416-t01-fixtures/v1");
    assert.equal(fx.cases.length, 30);
  });

  for (const c of fx.cases) {
    it(c.id, () => {
      const base = bases[c.base];
      assert.ok(base, `unknown base ${c.base}`);
      const res = validateReportDocument(mutate(base, c.mutations), "v5");
      executed++;
      assert.equal(
        res.valid,
        c.valid,
        res.valid ? "expected invalid, got valid" : res.errors.slice(0, 4).join("; "),
      );
    });
  }

  it("all 30 cases executed (none skipped; the python script skips none)", () => {
    assert.equal(executed, 30);
  });
});
