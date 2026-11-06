/**
 * Shared error type for the Host half of dsh-skill-curator.
 *
 * Codes are stable, value-free identifiers that the Client localizes; the HTTP
 * layer returns only the code, never `message`, because a message could contain
 * a user-supplied path or file content.
 */
export class CuratorError extends Error {
  /**
   * @param {string} code stable error code (see README)
   * @param {number} [status] HTTP status
   * @param {{details?: unknown}} [options] value-free extra payload for the Client
   */
  constructor(code, status = 400, options = undefined) {
    super(code);
    this.name = 'CuratorError';
    this.code = code;
    this.status = status;
    if (options !== undefined && options !== null && options.details !== undefined) {
      this.details = options.details;
    }
  }
}

/** Throw a CuratorError. */
export function fail(code, status = 400) {
  throw new CuratorError(code, status);
}
