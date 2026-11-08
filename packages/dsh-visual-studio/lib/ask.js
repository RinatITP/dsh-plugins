/**
 * Pending `visual_ask` widgets.
 *
 * A tool call blocks while the user works the inline widget; the Client posts
 * the answer to the plugin route, which resolves the matching promise by the
 * call id. The call id comes from the Host tool execution context, so one
 * registry serves every session in the process. Timers and abort listeners are
 * always cleared, and plugin disposal resolves every waiter as aborted rather
 * than leaving a tool call hanging.
 */

export const DEFAULT_ASK_TIMEOUT_MS = 20 * 60 * 1000;

export function createAskRegistry({ timeoutMs = DEFAULT_ASK_TIMEOUT_MS } = {}) {
  /** @type {Map<string, {spec: object, at: number, resolve: (value: object) => void, timer: ReturnType<typeof setTimeout>|undefined, signal?: AbortSignal, onAbort?: () => void}>} */
  const pending = new Map();

  function settle(callId, value) {
    const entry = pending.get(callId);
    if (entry === undefined) return false;
    pending.delete(callId);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.signal !== undefined && entry.onAbort !== undefined) {
      try {
        entry.signal.removeEventListener('abort', entry.onAbort);
      } catch {
        // Signals without removeEventListener are tolerated.
      }
    }
    entry.resolve(value);
    return true;
  }

  /**
   * Register a pending widget and wait for the answer.
   * @param {{callId: string, spec: object, signal?: AbortSignal, timeout?: number}} input
   * @returns {Promise<object>} answer payload with `submitted` discriminator
   */
  function open({ callId, spec, signal, timeout }) {
    if (typeof callId !== 'string' || callId === '') throw new TypeError('callId must be a non-empty string');
    if (pending.has(callId)) throw new Error('a widget with this call id is already pending');
    return new Promise((resolve) => {
      const limit = Number.isFinite(timeout) && Number(timeout) > 0 ? Number(timeout) : timeoutMs;
      const entry = { spec, at: Date.now(), resolve, timer: undefined, signal: undefined, onAbort: undefined };
      entry.timer = setTimeout(() => {
        settle(callId, { submitted: false, callId, timedOut: true });
      }, limit);
      const abort = () => {
        settle(callId, { submitted: false, callId, aborted: true });
      };
      if (signal !== undefined && signal !== null) {
        if (signal.aborted === true) {
          settle(callId, { submitted: false, callId, aborted: true });
          return;
        }
        if (typeof signal.addEventListener === 'function') {
          entry.signal = signal;
          entry.onAbort = abort;
          signal.addEventListener('abort', abort, { once: true });
        }
      }
      pending.set(callId, entry);
    });
  }

  /**
   * Resolve a pending widget with the user's answer.
   * @returns {boolean} false when the call id is unknown or already settled
   */
  function submit(callId, payload) {
    return settle(callId, { submitted: true, callId, ...payload });
  }

  /** Describe a pending widget (used to restore a widget after reload). */
  function pendingFor(callId) {
    const entry = pending.get(callId);
    return entry === undefined ? undefined : { spec: entry.spec, at: entry.at };
  }

  /** Resolve every waiter as aborted; safe to call more than once. */
  function dispose() {
    for (const callId of [...pending.keys()]) {
      settle(callId, { submitted: false, callId, aborted: true });
    }
  }

  return {
    open,
    submit,
    pendingFor,
    dispose,
    get size() {
      return pending.size;
    },
  };
}
