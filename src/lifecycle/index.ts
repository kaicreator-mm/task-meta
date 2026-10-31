// v0.4 A2 (#67) — source-qualified Agent Hook lifecycle witness.
// Consumes ONLY the T0 private vocabulary (DiagnosticFact, MissingReason,
// EvidenceLevel, Epistemic). Never fabricates: an absent host event projects
// UNKNOWN or NOT_INSTRUMENTED with the exact client profile; repeated Stop
// deliveries and session-id mismatches are witnessed facts, not inventions;
// Hook-error classes are accepted only from a trusted witnessed source as
// bounded class tokens, never raw log/prompt text. A fixture-derived witness
// never qualifies a real Agent CLI run.
import type {
  DiagnosticFact,
  Epistemic,
  EvidenceLevel,
  MissingReason,
  PrivateDiagnosticVersion,
} from "../model.ts";

const SCHEMA: PrivateDiagnosticVersion = "task-meta/private-diagnostics/v1";

export type LifecycleStep = "SESSION_START" | "STOP" | "SESSION_END" | "HOOK_ERROR";
export type AgentId = "zcode" | "claude" | "codex";

/** Per-client hook surface profile, grounded in the adapter source (JIT read). */
export interface LifecycleClientProfile {
  agent: AgentId;
  /** False when the client's hook surface has no SessionEnd event at all. */
  session_end_instrumented: boolean;
  /** Why SessionEnd is absent for this client when it is not instrumented. */
  session_end_absent_reason: MissingReason;
  profile_source_ref: string;
}

export const CLIENT_PROFILES: Record<AgentId, LifecycleClientProfile> = {
  // src/adapters/zcode/hooks.ts HookEvent union has no SessionEnd.
  zcode: {
    agent: "zcode",
    session_end_instrumented: false,
    session_end_absent_reason: "NOT_INSTRUMENTED",
    profile_source_ref: "src/adapters/zcode/hooks.ts",
  },
  claude: {
    agent: "claude",
    session_end_instrumented: true,
    session_end_absent_reason: "UNKNOWN",
    profile_source_ref: "src/adapters/claude/hooks.ts",
  },
  codex: {
    agent: "codex",
    session_end_instrumented: true,
    // An actually missing Codex SessionEnd has an unproven Host-side cause.
    session_end_absent_reason: "UNKNOWN",
    profile_source_ref: "src/adapters/codex/hooks.ts",
  },
};

/** A single source-qualified hook event observation. */
export interface HookEventObservation {
  /** Stable event identity: identical ids de-duplicate (transport replays). */
  event_id: string;
  session_ref: string;
  /** Alternate session id carried by the same payload (sessionId vs session_id). */
  alt_session_ref: string | null;
  step: LifecycleStep;
  evidence_level: EvidenceLevel;
  epistemic: Epistemic;
  missing_reason: MissingReason | null;
  /** Already-classified error token for HOOK_ERROR; never raw text. */
  error_class: string | null;
  observed_at_ms: number | null;
  source_ref: string;
}

export interface SessionLifecycleAssessment {
  schema: PrivateDiagnosticVersion;
  session_ref: string;
  agent: AgentId;
  witnessed_steps: LifecycleStep[];
  /** Witnessed terminal end; STOP and SESSION_END stay semantically distinct. */
  terminal_step: "STOP" | "SESSION_END" | null;
  terminal_epistemic: Epistemic;
  /** Why SESSION_END is absent, per the client profile; null when witnessed. */
  session_end_missing_reason: MissingReason | null;
  /** Distinct physical Stop deliveries beyond the first (witnessed, deduped). */
  repeated_stop_deliveries: number;
  /** Primary vs alternate session id disagree on at least one event. */
  session_id_mismatch: boolean;
  /** Trusted witnessed Hook-error class tokens only. */
  /** Events excluded from facts: foreign session or identity-doubtful attribution. */
  quarantined_foreign_events: number;
  hook_error_classes: string[];
  facts: DiagnosticFact[];
  /** A fixture-backed witness never qualifies a real Agent CLI run. */
  real_agent_cli_qualified: false;
  limits: string[];
}

const SAFE_CLASS_TOKEN = /^[A-Z][A-Z0-9_]*$/;

/** Facts inherit the assessed client profile's agent; no silent prefix fallback. */
function factFor(e: HookEventObservation, agent: AgentId): DiagnosticFact {
  return {
    schema: SCHEMA,
    source_ref: e.source_ref,
    source_revision: 1,
    agent,
    plugin_version: null,
    host_class: null,
    evidence_level: e.evidence_level,
    epistemic: e.epistemic,
    missing_reason: e.missing_reason,
    clock: { domain: "source", precision: "ms", synchronized: null },
  };
}

/**
 * Assess one session's Hook lifecycle from source-qualified observations.
 * Pure projection: no network, no filesystem, no inference beyond the witness.
 */
export function assessSessionLifecycle(
  sessionRef: string,
  profile: LifecycleClientProfile,
  events: HookEventObservation[],
): SessionLifecycleAssessment {
  // De-duplicate transport replays by event identity, keep arrival order.
  const byId = new Map<string, HookEventObservation>();
  for (const e of events) {
    if (!byId.has(e.event_id)) byId.set(e.event_id, e);
  }
  const unique = [...byId.values()];

  const witnessed = new Set<LifecycleStep>();
  const errorClasses = new Set<string>();
  let idMismatch = false;
  for (const e of unique) {
    if (e.epistemic !== "OBSERVED" || e.missing_reason !== null) continue;
    if (e.alt_session_ref !== null && e.alt_session_ref !== e.session_ref) {
      // Identity-doubtful event: report the mismatch, but never attribute its
      // facts to the session it claims.
      idMismatch = true;
      continue;
    }
    if (e.session_ref !== sessionRef) continue;
    witnessed.add(e.step);
    if (e.step === "HOOK_ERROR" && e.error_class !== null && SAFE_CLASS_TOKEN.test(e.error_class)) {
      errorClasses.add(e.error_class);
    }
  }

  // Repeated-Stop counting uses the SAME proof bar as step witnessing: an event
  // must be OBSERVED with no missing_reason, and its session attribution must be
  // trusted. An event whose alternate session id disagrees belongs to a
  // different session's facts — it never inflates this session's delivery
  // count (the mismatch itself is still reported above).
  const trustedForSession = (e: HookEventObservation): boolean =>
    e.session_ref === sessionRef &&
    e.epistemic === "OBSERVED" &&
    e.missing_reason === null &&
    !(e.alt_session_ref !== null && e.alt_session_ref !== e.session_ref);
  const stops = unique.filter((e) => e.step === "STOP" && trustedForSession(e));
  const hasSessionEnd = witnessed.has("SESSION_END");
  const terminal: "STOP" | "SESSION_END" | null = hasSessionEnd
    ? "SESSION_END"
    : witnessed.has("STOP")
      ? "STOP"
      : null;

  const limits: string[] = [
    `client_profile=${profile.agent}@${profile.profile_source_ref}`,
    "source-level witness only: no real Agent CLI qualification is claimed from fixtures",
  ];
  if (!profile.session_end_instrumented) {
    limits.push("SessionEnd is not part of this client's hook surface (NOT_INSTRUMENTED)");
  } else if (!hasSessionEnd && terminal === "STOP") {
    limits.push(
      "SessionEnd expected by profile but not observed: cause UNKNOWN (Host-side, scoped test only)",
    );
  }
  if (idMismatch) limits.push("session id mismatch witnessed: identity attribution is not trusted");

  // R2 P1-02: returned facts carry ONLY observations attributed to this session
  // with trusted identity. Foreign-session events and identity-doubtful events
  // (disagreeing alt_session_ref) are quarantined out of facts — counted, never
  // projected as this session's evidence. The mismatch signal stays above.
  const attributed = unique.filter(
    (e) =>
      e.session_ref === sessionRef &&
      !(e.alt_session_ref !== null && e.alt_session_ref !== e.session_ref),
  );
  const quarantined = unique.length - attributed.length;
  if (quarantined > 0) {
    limits.push(
      `quarantined_foreign_events=${quarantined} (foreign session or identity-doubtful; excluded from facts)`,
    );
  }

  return {
    schema: SCHEMA,
    session_ref: sessionRef,
    agent: profile.agent,
    witnessed_steps: [...witnessed],
    terminal_step: terminal,
    terminal_epistemic: terminal === null ? "UNKNOWN" : "OBSERVED",
    session_end_missing_reason: hasSessionEnd ? null : profile.session_end_absent_reason,
    repeated_stop_deliveries: Math.max(0, stops.length - 1),
    session_id_mismatch: idMismatch,
    quarantined_foreign_events: quarantined,
    hook_error_classes: [...errorClasses],
    facts: attributed.map((e) => factFor(e, profile.agent)),
    real_agent_cli_qualified: false,
    limits,
  };
}
