export type ReportProfile = "v4" | "v5";

export const ADS_V4_REVISION = "639675e96dd4c2ed123b7684a4c5d25437a13341";
export const ADS_V5_REVISION = "3041a1be3f130e5cc5e676c2e56a99882adfd97c";

export class UnrepresentableError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "UnrepresentableError";
    this.code = code;
  }
}

export interface SupersedesRef {
  revision: number;
  data_digest: string;
  comment_ref: string;
}

export interface ReportDocument {
  schema: string;
  kind: "report";
  data: Record<string, unknown>;
}

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };
