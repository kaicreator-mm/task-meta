import { isAlias, parseAllDocuments, stringify, visit } from "yaml";
import { canonicalDigest } from "../canonical.ts";
import type { ReportDocument, ReportProfile } from "./types.ts";
import { validateReportDocument } from "./validate.ts";

export const REPORT_MARKER = "<!-- ads:github -->";

export function reportDataDigest(data: unknown): string {
  return canonicalDigest(data);
}

function profileOf(doc: unknown): ReportProfile | null {
  const schema = (doc as { schema?: unknown } | null)?.schema;
  if (schema === "ads/github/v4") return "v4";
  if (schema === "ads/github/v5") return "v5";
  return null;
}

/** Render the public comment body. Validates first; throws when the document is invalid. */
export function renderReportComment(
  doc: ReportDocument,
  opts: { humanSummary?: string } = {},
): string {
  const profile = profileOf(doc);
  if (profile === null) throw new Error("report: unknown schema marker");
  const res = validateReportDocument(doc, profile);
  if (!res.valid) throw new Error(`report: invalid document: ${res.errors.join("; ")}`);
  const yamlText = stringify(
    { schema: doc.schema, kind: doc.kind, data: doc.data },
    { aliasDuplicateObjects: false, sortMapEntries: false, lineWidth: 0 },
  );
  let body = `${REPORT_MARKER}\n\`\`\`yaml\n${yamlText}\`\`\`\n`;
  if (opts.humanSummary) body += `\n${opts.humanSummary}\n`;
  return body;
}

export type ParseResult =
  | { ok: true; doc: ReportDocument; profile: ReportProfile; dataDigest: string }
  | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

export function parseReportComment(body: string): ParseResult {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== REPORT_MARKER) return fail("first line must be the ads:github marker");
  if (body.split(REPORT_MARKER).length !== 2) return fail("exactly one marker allowed");
  if (lines[1] !== "```yaml") return fail("marker must be followed immediately by a ```yaml fence");
  const end = lines.indexOf("```", 2);
  if (end === -1) return fail("unterminated yaml fence");
  const text = lines.slice(2, end).join("\n");

  const docs = parseAllDocuments(text, { uniqueKeys: true, version: "1.2" });
  if (docs.length !== 1) return fail("exactly one YAML document required");
  const ydoc = docs[0];
  if (!ydoc) return fail("empty YAML");
  if (ydoc.errors.length > 0) return fail(`yaml error: ${ydoc.errors[0]?.message}`);
  if (ydoc.warnings.length > 0) return fail(`yaml warning: ${ydoc.warnings[0]?.message}`);
  let forbidden: string | null = null;
  visit(ydoc, {
    Node(_key, node) {
      if (isAlias(node)) forbidden = "yaml alias";
      else if (node.anchor) forbidden = "yaml anchor";
      else if (node.tag) forbidden = `explicit yaml tag ${node.tag}`;
      return forbidden ? visit.BREAK : undefined;
    },
  });
  if (forbidden) return fail(`${forbidden} not allowed`);
  const value: unknown = ydoc.toJS({ maxAliasCount: 0 });
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("top level must be a mapping");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "data,kind,schema") {
    return fail("top-level keys must be exactly schema, kind, data");
  }
  const profile = profileOf(value);
  if (profile === null) return fail("unknown schema marker");
  const res = validateReportDocument(value, profile);
  if (!res.valid) return fail(`schema validation failed: ${res.errors.join("; ")}`);
  const doc = value as ReportDocument;
  return { ok: true, doc, profile, dataDigest: reportDataDigest(doc.data) };
}
