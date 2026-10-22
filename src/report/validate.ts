import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import type { ReportProfile, ValidationResult } from "./types.ts";

const SCHEMA_FILES: Record<ReportProfile, string> = {
  v4: "../../vendor/ads/v4.15/report.schema.json",
  v5: "../../vendor/ads/v4.16/report.schema.json",
};

type ValidateFn = ((doc: unknown) => boolean) & {
  errors?: { instancePath: string; message?: string }[] | null;
};
const cache = new Map<ReportProfile, ValidateFn>();

function compiled(profile: ReportProfile): ValidateFn {
  const hit = cache.get(profile);
  if (hit) return hit;
  const schema = JSON.parse(readFileSync(new URL(SCHEMA_FILES[profile], import.meta.url), "utf8"));
  // strict:true with two documented relaxations, both forced by the vendored schemas:
  //  - allowUnionTypes: they use `"type": ["string","null"]` unions.
  //  - strictTypes:false: their `if` conditions (e.g. allOf/*/if/properties/learning) use
  //    `properties` without `"type": "object"`, which strictTypes rejects. All other strict
  //    checks (unknown keywords/formats, strictRequired, strictTuples) stay on.
  const ajv = new Ajv2020.default({
    strict: true,
    strictTypes: false,
    allowUnionTypes: true,
    allErrors: true,
  });
  const fn = ajv.compile(schema) as ValidateFn;
  cache.set(profile, fn);
  return fn;
}

/** Validate an envelope against the vendored schema of the given profile. */
export function validateReportDocument(doc: unknown, profile: ReportProfile): ValidationResult {
  const validate = compiled(profile);
  if (validate(doc)) return { valid: true };
  const errors = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`);
  return { valid: false, errors: errors.length > 0 ? errors : ["invalid"] };
}
