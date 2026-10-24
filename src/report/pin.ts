import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ADS_V4_REVISION, ADS_V5_REVISION, type ReportProfile } from "./types.ts";

export interface AdoptionEntry {
  ads_version: string;
  main_sha: string;
  report_schema_blob: string;
  profile: "v5";
}

export interface E2eTestSubject {
  repository: string;
  ads_pin: string;
  profile: "v5";
  report_schema_blob: string;
  note?: string;
}

/** Historical v0.2 candidate authorization: retained for audit, NEVER a v0.3 ordinary-publication capability. */
export interface OwnerAuthorizedEntry {
  ads_version: string;
  ads_pin: string;
  report_schema_blob: string;
  profile: "v5";
  /** "all" or the list of repositories (owner/name) the authorization covers. */
  scope: "all" | string[];
  authorization_ref: string;
  authorized_on: string;
  note?: string;
}

export interface Adoption {
  note?: string;
  adopted: AdoptionEntry[];
  e2e_test_subjects?: E2eTestSubject[];
  owner_authorized?: OwnerAuthorizedEntry[];
}

/** Git blob sha1 of the vendored version/v4.16 report.schema.json. */
export const VENDORED_V416_SCHEMA_BLOB = "7478313cc006162432649d734e59c5cd77db5106";

/** version/v4.16 candidate: CANDIDATE_ONLY, never publishable. */
export const CANDIDATE_PIN = ADS_V5_REVISION;
/** Source-qualified ADS v4.16 main commit; changing it requires ADS pin requalification. */
export const QUALIFIED_V416_MAIN_SHA = "718fb02e33b31f568736447b2b905883cc6fcc3a";

export function gitBlobSha1(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

export function vendoredV416SchemaBlob(): string {
  const url = new URL("../../vendor/ads/v4.16/report.schema.json", import.meta.url);
  return gitBlobSha1(readFileSync(url));
}

export function loadAdoption(): Adoption {
  const url = new URL("../../config/ads-adoption.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Adoption;
}

export type ProfileMode =
  | "ADOPTED"
  | "CANDIDATE"
  | "E2E_TEST_SUBJECT"
  | "OWNER_AUTHORIZED"
  | "V4_DEFAULT";

export type ProfileResolution =
  | { ok: true; profile: ReportProfile; mode: ProfileMode; adsRevision: string }
  | { ok: false; code: string; message: string };

export interface ResolveInput {
  profile?: ReportProfile;
  adsPin?: string;
  publish: boolean;
  /** Target repository (owner/name); needed to match an e2e_test_subjects entry. */
  repository?: string;
  /** Explicit, repository-allowlisted candidate-only test purpose; never a normal publication. */
  e2eTestOnly?: boolean;
  adoption: Adoption;
}

function fail(code: string, message: string): ProfileResolution {
  return { ok: false, code, message };
}

/** Profile/pin guard (ADS §16.7): v5 is never automatic and the candidate is never publishable. */
export function resolveProfile(input: ResolveInput): ProfileResolution {
  const entries = input.adoption.adopted.filter((e) => e.profile === "v5");
  let profile = input.profile;
  let pin = input.adsPin;
  if (profile === undefined) {
    const first = entries[0];
    if (!first) {
      // Historical owner_authorized candidate entries grant NO ordinary v5
      // publication. Fail closed rather than silently downcast their old default
      // to v4 and claiming a successful v5 report.
      if (input.publish && (input.adoption.owner_authorized ?? []).length > 0) {
        return fail(
          "UNQUALIFIED_CANDIDATE_DEFAULT",
          "legacy owner-authorized candidate has no qualified ADS main adoption; held without POST",
        );
      }
      return { ok: true, profile: "v4", mode: "V4_DEFAULT", adsRevision: ADS_V4_REVISION };
    }
    profile = "v5";
    pin ??= first.main_sha;
  }
  if (profile === "v4") {
    return { ok: true, profile: "v4", mode: "V4_DEFAULT", adsRevision: ADS_V4_REVISION };
  }
  if (pin === undefined) {
    return fail("ADS_PIN_REQUIRED", "--profile v5 requires --ads-pin <sha>");
  }
  if (pin === CANDIDATE_PIN) {
    if (input.publish) {
      if (input.e2eTestOnly !== true) {
        return fail(
          "CANDIDATE_TEST_PURPOSE_REQUIRED",
          "candidate publication requires explicit isolated E2E test purpose",
        );
      }
      const subject = (input.adoption.e2e_test_subjects ?? []).find(
        (e) =>
          e.profile === "v5" && e.repository === input.repository && e.ads_pin === CANDIDATE_PIN,
      );
      if (subject) {
        if (subject.report_schema_blob !== VENDORED_V416_SCHEMA_BLOB) {
          return fail(
            "SCHEMA_BLOB_MISMATCH",
            `e2e test subject report_schema_blob ${subject.report_schema_blob} differs from the vendored v4.16 schema`,
          );
        }
        return { ok: true, profile: "v5", mode: "E2E_TEST_SUBJECT", adsRevision: pin };
      }
      return fail(
        "CANDIDATE_NOT_PUBLISHABLE",
        "version/v4.16 candidate pin is CANDIDATE_ONLY; publishing needs a qualified main adoption SHA",
      );
    }
    return { ok: true, profile: "v5", mode: "CANDIDATE", adsRevision: pin };
  }
  const entry = entries.find((e) => e.main_sha === pin);
  if (!entry) {
    return fail(
      "UNKNOWN_ADS_PIN",
      `ads pin ${pin} is neither the candidate nor an adopted main SHA`,
    );
  }
  if (entry.main_sha !== QUALIFIED_V416_MAIN_SHA || entry.ads_version !== "4.16.0") {
    return fail(
      "UNQUALIFIED_MAIN_PIN",
      "normal v5 requires the exact qualified ADS v4.16 main SHA",
    );
  }
  if (entry.report_schema_blob !== VENDORED_V416_SCHEMA_BLOB) {
    return fail(
      "SCHEMA_BLOB_MISMATCH",
      `adopted report_schema_blob ${entry.report_schema_blob} differs from the vendored v4.16 schema`,
    );
  }
  if (input.publish && vendoredV416SchemaBlob() !== VENDORED_V416_SCHEMA_BLOB) {
    return fail(
      "VENDORED_SCHEMA_BLOB_MISMATCH",
      "actual vendored v5 schema bytes differ from the qualified ADS schema",
    );
  }
  return { ok: true, profile: "v5", mode: "ADOPTED", adsRevision: entry.main_sha };
}
