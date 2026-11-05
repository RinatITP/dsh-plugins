/**
 * Shared error type for the Host half of dsh-mcp-guard.
 *
 * Codes are stable, value-free identifiers that the Client localizes; the
 * HTTP layer only ever returns the code, never `message`, because a message
 * could contain a user-supplied command, argument or secret.
 */
export class ManagerError extends Error {
  /**
   * @param {string} code stable error code (see docs/API-CONTRACT.md)
   * @param {number} [status] HTTP status
   */
  constructor(code, status = 400) {
    super(code);
    this.name = 'ManagerError';
    this.code = code;
    this.status = status;
  }
}

/** Throw a ManagerError. */
export function fail(code, status = 400) {
  throw new ManagerError(code, status);
}
