// v0.4 A1 (#66) — read-only repo Doctor and single typed diagnostic catalog.
// The catalog here is the SOLE rule owner (severity + Skill id derived once);
// outcome/classification VALUES are T0-owned vocabulary consumed through
// source fixtures. Doctor never repairs, installs, follows symlinks out of the
// repo, reads credentials, or performs any network/file write. Hook-error
// classes come only from a trusted witnessed source as bounded tokens; raw
// log content is structurally redacted. Missing evidence stays UNKNOWN.
import {
  assessPostEffect,
  type Epistemic,
  type MissingReason,
  type PostEffect,
  type PrivatePublicationStatus,
} from "../model.ts";

export type Severity = "INFO" | "WARN" | "BLOCKER";

/** Sole Doctor rule owner; skill ids are derived, never hand-duplicated. */
export interface DiagnosticRule {
  code: string;
  severity: Severity;
  skill_id: string;
  summary: string;
  /** Read-only advice. Doctor never executes a remedy. */
  remedy_hint: string | null;
}

function mkRule(
  code: string,
  severity: Severity,
  summary: string,
  remedy_hint: string | null,
): DiagnosticRule {
  return {
    code,
    severity,
    skill_id: `task-meta-doctor/${code.toLowerCase()}`,
    summary,
    remedy_hint,
  };
}

export const DIAGNOSTIC_CATALOG: readonly DiagnosticRule[] = [
  mkRule(
    "SPOOL_CORRUPT_LINE",
    "WARN",
    "spool line failed source-schema parse",
    "inspect the spool with the capture plugin; doctor does not rewrite spool files",
  ),
  mkRule(
    "HOOK_ERROR_CLASSIFIED",
    "WARN",
    "trusted witness emitted a bounded hook-error class",
    "consult the class in the capture plugin docs",
  ),
  mkRule(
    "HOOK_ERROR_SOURCE_UNTRUSTED",
    "WARN",
    "hook error evidence came from an untrusted raw log; class unknown",
    "re-run with the trusted capture witness; raw log content is not diagnostic evidence",
  ),
  mkRule(
    "SECRET_MATERIAL_DETECTED",
    "BLOCKER",
    "apparent secret material inside a scanned source fixture",
    "remove the secret from the repo; doctor never stores or echoes the material",
  ),
  mkRule(
    "SYMLINK_ESCAPE_REFUSED",
    "BLOCKER",
    "symlink target leaves the repo root; doctor refuses to follow",
    "resolve the link target inside the repo before re-running",
  ),
  mkRule(
    "UNSUPPORTED_CLIENT",
    "INFO",
    "client is not on the safe manifest allowlist",
    "no install/repair command is guessed; record NOT_RUN instead",
  ),
  mkRule(
    "STATUS_UNKNOWN",
    "INFO",
    "T0 private publication status UNKNOWN",
    "uncertain effect: reconciliation-only, never a retry command",
  ),
  mkRule(
    "STATUS_HELD",
    "INFO",
    "T0 private publication status HELD (fail-closed clearance)",
    "publication intentionally withheld without clearance",
  ),
  mkRule(
    "STATUS_JOURNAL_INCOMPLETE",
    "WARN",
    "T0 journal-integrity evidence; runtime handling is B2-owned",
    "B2 owns persisted conservative projection; doctor never repairs journals",
  ),
  mkRule(
    "STATUS_TERMINAL",
    "INFO",
    "T0 terminal publication status observed",
    "terminal states need no doctor action",
  ),
  mkRule(
    "POST_EFFECT_CLASSIFIED",
    "INFO",
    "T0 PostEffect classified via the shared pure classifier",
    "classification is evidence, never a transport grant",
  ),
] as const;

const RULE_BY_CODE = new Map(DIAGNOSTIC_CATALOG.map((r) => [r.code, r]));

export interface SpoolSample {
  path: string;
  /** Raw line contents never leave this function; only parse verdicts do. */
  parse_ok: boolean;
}

export interface HookErrorSample {
  source: "TRUSTED_WITNESS" | "RAW_LOG";
  /** Pre-classified bounded token; null when the source is untrusted. */
  error_class: string | null;
}

export interface PathCheck {
  path: string;
  is_symlink: boolean;
  /** null when the target could not be resolved; outside-root targets are refused. */
  target_inside_repo: boolean | null;
}

export interface CredentialSample {
  /** Name/path only. Doctor never reads or echoes credential contents. */
  name: string;
  looks_like_secret: boolean;
}

export interface CliCheck {
  client: string;
  help_output_available: boolean;
}

export interface PublicationStatusSample {
  status: PrivatePublicationStatus;
  target_ref: string;
}

export interface PostEffectSample {
  effect: PostEffect;
  target_ref: string;
}

export interface DoctorInput {
  repo_root: string;
  spool: SpoolSample[];
  hook_errors: HookErrorSample[];
  paths: PathCheck[];
  credentials: CredentialSample[];
  clients: CliCheck[];
  publication_statuses: PublicationStatusSample[];
  post_effects: PostEffectSample[];
}

export interface DoctorFinding {
  rule: DiagnosticRule;
  target_ref: string;
  epistemic: Epistemic;
  missing_reason: MissingReason | null;
  limits: string[];
}

export interface DoctorReport {
  repo_root: string;
  findings: DoctorFinding[];
  /** Structural guarantees of the read-only doctor. */
  network_used: false;
  writes_performed: [];
  repairs_performed: [];
}

function finding(
  code: string,
  targetRef: string,
  over: Partial<DoctorFinding> = {},
): DoctorFinding {
  const rule = RULE_BY_CODE.get(code);
  if (!rule) throw new Error(`unknown doctor rule ${code}`);
  return {
    rule,
    target_ref: targetRef,
    epistemic: "OBSERVED",
    missing_reason: null,
    limits: [],
    ...over,
  };
}

const TERMINAL: ReadonlySet<PrivatePublicationStatus> = new Set([
  "PUBLISHED",
  "ALREADY_PUBLISHED",
  "DENIED",
  "CONFLICT",
  "FAILED_PROVEN_PRE_SEND",
] as const);

/** Pure read-only scan over source fixtures. No I/O, no network, no writes. */
export function runDoctor(input: DoctorInput): DoctorReport {
  const findings: DoctorFinding[] = [];

  for (const s of input.spool) {
    if (!s.parse_ok) {
      findings.push(finding("SPOOL_CORRUPT_LINE", s.path));
    }
  }

  for (const h of input.hook_errors) {
    if (h.source === "TRUSTED_WITNESS" && h.error_class !== null) {
      findings.push(
        finding("HOOK_ERROR_CLASSIFIED", `hook-error:${h.error_class}`, {
          limits: ["class token from trusted witness only; raw content never recorded"],
        }),
      );
    } else {
      findings.push(
        finding("HOOK_ERROR_SOURCE_UNTRUSTED", "hook-error:redacted", {
          epistemic: "UNKNOWN",
          missing_reason: "UNKNOWN",
          limits: ["raw _errors.log text is not diagnostic evidence and stays redacted"],
        }),
      );
    }
  }

  for (const p of input.paths) {
    if (p.is_symlink && p.target_inside_repo !== true) {
      findings.push(
        finding("SYMLINK_ESCAPE_REFUSED", p.path, {
          epistemic: p.target_inside_repo === null ? "UNKNOWN" : "OBSERVED",
          missing_reason: p.target_inside_repo === null ? "UNKNOWN" : null,
          limits: ["doctor never follows a symlink that leaves the repo root"],
        }),
      );
    }
  }

  for (const c of input.credentials) {
    if (c.looks_like_secret) {
      findings.push(
        finding("SECRET_MATERIAL_DETECTED", c.name, {
          limits: ["content neither read nor echoed; name/path recorded only"],
        }),
      );
    }
  }

  for (const cli of input.clients) {
    if (!["zcode", "claude", "codex"].includes(cli.client) || !cli.help_output_available) {
      findings.push(
        finding("UNSUPPORTED_CLIENT", `client:${cli.client}`, {
          epistemic: "UNKNOWN",
          missing_reason: cli.help_output_available ? "OUT_OF_SCOPE" : "NOT_INSTRUMENTED",
          limits: ["no install command is guessed for an unsupported client"],
        }),
      );
    }
  }

  for (const s of input.publication_statuses) {
    if (s.status === "UNKNOWN") {
      findings.push(
        finding("STATUS_UNKNOWN", s.target_ref, {
          epistemic: "UNKNOWN",
          missing_reason: "UNKNOWN",
        }),
      );
    } else if (s.status === "HELD") {
      findings.push(finding("STATUS_HELD", s.target_ref));
    } else if (s.status === "JOURNAL_INCOMPLETE") {
      findings.push(
        finding("STATUS_JOURNAL_INCOMPLETE", s.target_ref, {
          limits: ["B2 exclusively owns persisted journal handling; no repair here"],
        }),
      );
    } else if (TERMINAL.has(s.status)) {
      findings.push(finding("STATUS_TERMINAL", s.target_ref, { limits: [`status=${s.status}`] }));
    } else {
      findings.push(
        finding("STATUS_UNKNOWN", s.target_ref, {
          epistemic: "UNKNOWN",
          missing_reason: "UNKNOWN",
          limits: [`status=${s.status} is not terminal`],
        }),
      );
    }
  }

  for (const e of input.post_effects) {
    const assessment = assessPostEffect(e.effect);
    findings.push(
      finding("POST_EFFECT_CLASSIFIED", e.target_ref, {
        limits: [
          `effect=${e.effect}`,
          `status=${assessment.status}`,
          `reconciliation_only=${assessment.reconciliation_only}`,
        ],
      }),
    );
  }

  return {
    repo_root: input.repo_root,
    findings,
    network_used: false,
    writes_performed: [],
    repairs_performed: [],
  };
}
