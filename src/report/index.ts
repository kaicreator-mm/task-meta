export { type BuildOptions, buildReportDocument } from "./build.ts";
export {
  type ParseResult,
  parseReportComment,
  REPORT_MARKER,
  renderReportComment,
  reportDataDigest,
} from "./comment.ts";
export {
  type Adoption,
  type AdoptionEntry,
  CANDIDATE_PIN,
  QUALIFIED_V416_MAIN_SHA,
  type E2eTestSubject,
  gitBlobSha1,
  loadAdoption,
  type OwnerAuthorizedEntry,
  type ProfileResolution,
  resolveProfile,
  VENDORED_V416_SCHEMA_BLOB,
  vendoredV416SchemaBlob,
} from "./pin.ts";
export {
  ADS_V4_REVISION,
  ADS_V5_REVISION,
  type ReportDocument,
  type ReportProfile,
  type SupersedesRef,
  UnrepresentableError,
  type ValidationResult,
} from "./types.ts";
export { validateReportDocument } from "./validate.ts";
