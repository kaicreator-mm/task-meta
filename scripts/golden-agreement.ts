// T19: agreement between labeler A (rule labeler v1) and labeler B (independent, blind) on the golden sample.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ActionCategory, categorizeTool } from "../src/labels/index.ts";
import type { GoldenRow } from "./golden-sample.ts";

export const CATEGORIES: readonly ActionCategory[] = [
  "IMPLEMENTATION",
  "TEST",
  "DIAGNOSIS",
  "VCS",
  "ENVIRONMENT",
  "PLANNING",
  "OTHER",
  "UNKNOWN",
];

export interface Agreement {
  n: number;
  observed: number;
  kappa: number | null;
}

/** Raw agreement and Cohen's kappa for two equally long label sequences. */
export function agreement(a: readonly string[], b: readonly string[]): Agreement {
  if (a.length !== b.length) throw new Error("label sequences differ in length");
  const n = a.length;
  if (n === 0) return { n, observed: 0, kappa: null };
  let agree = 0;
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const x = a[i] as string;
    const y = b[i] as string;
    if (x === y) agree++;
    ca.set(x, (ca.get(x) ?? 0) + 1);
    cb.set(y, (cb.get(y) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [k, v] of ca) pe += (v / n) * ((cb.get(k) ?? 0) / n);
  return { n, observed: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
}

/** matrix[i][j] = rows labelled CATEGORIES[i] by A and CATEGORIES[j] by B. */
export function confusion(a: readonly string[], b: readonly string[]): number[][] {
  const m = CATEGORIES.map(() => CATEGORIES.map(() => 0));
  a.forEach((x, i) => {
    const r = m[CATEGORIES.indexOf(x as ActionCategory)];
    const j = CATEGORIES.indexOf(b[i] as ActionCategory);
    if (r && j >= 0) r[j] = (r[j] ?? 0) + 1;
  });
  return m;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const kap = (k: number | null): string => (k === null ? "n/a" : k.toFixed(3));

export interface GoldenReport {
  agreementMd: string;
  disagreementsMd: string;
  summary: { n: number; observed: number; kappa: number | null; disagreements: number };
}

export function buildReport(
  rows: readonly GoldenRow[],
  bLabels: ReadonlyMap<string, string>,
): GoldenReport {
  const A = rows.map((r) => categorizeTool(r.tool_name, r.input_class ?? undefined) as string);
  const B = rows.map((r) => {
    const l = bLabels.get(r.id);
    if (!l) throw new Error(`labeler B has no label for ${r.id}`);
    return l;
  });
  const overall = agreement(A, B);
  const lines: string[] = [
    "# T19 golden set: labeler agreement",
    "",
    "Labeler A = rule labeler v1 (`categorizeTool`); labeler B = independent blind labeling",
    "(`labeler-b.json`, committed before this file was generated). Metadata only.",
    "",
    "## Agreement",
    "",
    "| scope | n | raw agreement | Cohen's kappa |",
    "| --- | ---: | ---: | ---: |",
    `| overall | ${overall.n} | ${pct(overall.observed)} | ${kap(overall.kappa)} |`,
  ];
  for (const agent of [...new Set(rows.map((r) => r.agent))]) {
    const idx = rows.map((r, i) => (r.agent === agent ? i : -1)).filter((i) => i >= 0);
    const g = agreement(
      idx.map((i) => A[i] as string),
      idx.map((i) => B[i] as string),
    );
    lines.push(`| ${agent} | ${g.n} | ${pct(g.observed)} | ${kap(g.kappa)} |`);
  }
  const unkA = A.filter((x) => x === "UNKNOWN").length;
  const unkB = B.filter((x) => x === "UNKNOWN").length;
  lines.push(
    "",
    "## UNKNOWN share",
    "",
    `- labeler A: ${unkA}/${rows.length} (${pct(unkA / rows.length)})`,
    `- labeler B: ${unkB}/${rows.length} (${pct(unkB / rows.length)})`,
    "",
    "## Confusion matrix (rows = A, columns = B)",
    "",
    `| A vs B | ${CATEGORIES.join(" | ")} |`,
    `| --- | ${CATEGORIES.map(() => "---:").join(" | ")} |`,
  );
  confusion(A, B).forEach((row, i) => {
    lines.push(`| ${CATEGORIES[i]} | ${row.join(" | ")} |`);
  });

  const dis: string[] = [
    "# T19 golden set: disagreements for owner adjudication",
    "",
    "Fill the `owner:` column with the adjudicated ActionCategory (or UNKNOWN when intent is unobservable).",
    "",
    "| row id | agent | tool_name | input_class | A | B | note | owner: |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  let nd = 0;
  rows.forEach((r, i) => {
    if (A[i] === B[i]) return;
    nd++;
    const note =
      A[i] === "UNKNOWN"
        ? "A has no rule for this tool/class; B maps by tool semantics"
        : B[i] === "UNKNOWN"
          ? "B cannot tell intent from metadata; A applies a rule"
          : "category conflict";
    dis.push(
      `| ${r.id} | ${r.agent} | ${r.tool_name} | ${r.input_class ?? "-"} | ${A[i]} | ${B[i]} | ${note} |  |`,
    );
  });
  lines.push("", `Disagreements: ${nd} of ${rows.length} (listed in \`disagreements.md\`).`, "");
  dis.push("");
  return {
    agreementMd: lines.join("\n"),
    disagreementsMd: dis.join("\n"),
    summary: { n: overall.n, observed: overall.observed, kappa: overall.kappa, disagreements: nd },
  };
}

function main(): void {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "v0.2", "golden");
  const rows = JSON.parse(readFileSync(join(dir, "sample.json"), "utf8")) as GoldenRow[];
  const b = JSON.parse(readFileSync(join(dir, "labeler-b.json"), "utf8")) as {
    labels: { id: string; category: string }[];
  };
  const rep = buildReport(rows, new Map(b.labels.map((l) => [l.id, l.category])));
  writeFileSync(join(dir, "agreement.md"), rep.agreementMd);
  writeFileSync(join(dir, "disagreements.md"), rep.disagreementsMd);
  console.log(JSON.stringify(rep.summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
