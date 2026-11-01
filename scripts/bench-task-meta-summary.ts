/** Pure C2 aggregation; importing this module never runs the physical benchmark. */
export interface BenchmarkRecord {
  kind: string;
  hook_wall_ms: number;
  exit_code: number | null;
  stop_to_outbox_ms?: number | null;
  spool_bytes?: number | null;
  outbox?: { state?: string | null } | null;
  absence_witnessed?: boolean;
}

export function resolveSourceSha(explicit: string | undefined, fallback: () => string): string {
  return explicit ?? fallback();
}

export function summarize(records: readonly BenchmarkRecord[], kind: "ON" | "OFF") {
  const rs = records.filter((r) => r.kind === kind);
  const walls = rs.map((r) => r.hook_wall_ms).sort((a, b) => a - b);
  const s2o = rs
    .map((r) => r.stop_to_outbox_ms)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const pick = (a: number[]) => {
    if (a.length === 0) return { n: 0 };
    const middle = Math.floor(a.length / 2);
    // Both indices exist for nonempty even-N arrays; odd-N needs only middle.
    const upper = a[middle] as number;
    const median = a.length % 2 === 0 ? ((a[middle - 1] as number) + upper) / 2 : upper;
    return { n: a.length, min: a[0], median, max: a[a.length - 1] };
  };
  return {
    runs: rs.length,
    exits: rs.map((r) => r.exit_code),
    hook_wall_ms: pick(walls),
    stop_to_outbox_ms: kind === "ON" ? pick(s2o) : undefined,
    spool_bytes: kind === "ON" ? rs.map((r) => r.spool_bytes) : undefined,
    outbox_states: kind === "ON" ? rs.map((r) => r.outbox?.state ?? "MISSING") : undefined,
    absence_witnessed: kind === "OFF" ? rs.every((r) => r.absence_witnessed === true) : undefined,
  };
}
