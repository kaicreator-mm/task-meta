/** Stored bytes do not hash to their address (or an index disagrees with its target). */
export class TamperError extends Error {
  override name = "TamperError";
}
/** An immutable slot (manifest revision) already holds different content. */
export class ConflictError extends Error {
  override name = "ConflictError";
}
/** Manifest revision/predecessor chain is inconsistent. */
export class LineageError extends Error {
  override name = "LineageError";
}
/** A referenced object or manifest does not exist. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
