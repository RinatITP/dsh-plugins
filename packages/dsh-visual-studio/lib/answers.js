/**
 * Answered-widget records for the turn tail.
 *
 * The Chat hides tool-call bodies once a Turn completes, so an answered widget
 * cannot be reopened from its own row. The Client therefore also renders a
 * compact card in `conversation.chat.turnTail`, which stays visible: this store
 * keeps one small record per answered widget, addressed by Session and Turn.
 *
 * Only answer metadata is kept (title, number of changes, chosen labels), never
 * the widget markup. The file lives under `<dshHome>/visual-studio/answers.json`
 * and is written atomically behind one queue.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_RECORDS = 1000;
const SESSION_PATTERN = /^[A-Za-z0-9._-]{4,96}$/;

export class AnswersError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AnswersError';
    this.code = code;
  }
}

/**
 * @param {{answersFile: string}} paths
 */
export function createAnswersStore(paths) {
  let loaded = false;
  let loadPromise = null;
  let records = [];
  let queue = Promise.resolve();

  async function ensureLoaded() {
    if (loaded) return;
    if (loadPromise === null) {
      loadPromise = (async () => {
        try {
          const raw = await readFile(paths.answersFile, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.answers)) {
            records = parsed.answers.filter((record) => record !== null
              && typeof record === 'object'
              && typeof record.sessionId === 'string'
              && Number.isInteger(record.turn)
              && Array.isArray(record.selections));
          }
        } catch {
          records = [];
        }
        loaded = true;
      })();
    }
    return loadPromise;
  }

  function serialize(task) {
    const run = queue.then(async () => {
      await ensureLoaded();
      return task();
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function persist() {
    await mkdir(dirname(paths.answersFile), { recursive: true, mode: 0o700 });
    const payload = `${JSON.stringify({ version: 1, answers: records }, null, 2)}\n`;
    const temporary = `${paths.answersFile}.tmp`;
    await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, paths.answersFile);
  }

  /**
   * Save one answered widget. Writing is serialized and trimmed to the newest
   * records; callers treat failures as diagnostics only.
   */
  async function record(input) {
    if (typeof input?.sessionId !== 'string' || !SESSION_PATTERN.test(input.sessionId)) {
      throw new AnswersError('INVALID_SESSION', 'session id is not safe');
    }
    if (!Number.isInteger(input.turn) || input.turn <= 0) {
      throw new AnswersError('INVALID_TURN', 'turn must be a positive integer');
    }
    if (typeof input.callId !== 'string' || input.callId === '') {
      throw new AnswersError('INVALID_CALL', 'call id is required');
    }
    return serialize(async () => {
      const record = {
        sessionId: input.sessionId,
        turn: input.turn,
        callId: input.callId,
        title: typeof input.title === 'string' ? input.title.slice(0, 160) : '',
        submitted: input.submitted === true,
        changed: Number.isInteger(input.changed) ? input.changed : 0,
        selections: (Array.isArray(input.selections) ? input.selections : []).slice(0, 20).map((selection) => ({
          title: String(selection?.title ?? '').slice(0, 160),
          label: String(selection?.label ?? '').slice(0, 80),
          changed: selection?.changed === true,
        })),
        at: new Date().toISOString(),
      };
      records = records.filter((candidate) => !(candidate.sessionId === record.sessionId && candidate.callId === record.callId));
      records.push(record);
      if (records.length > MAX_RECORDS) records = records.slice(records.length - MAX_RECORDS);
      await persist();
      return record;
    });
  }

  /** Answers recorded for one Turn of one Session, in call order. */
  async function list({ sessionId, turn }) {
    if (typeof sessionId !== 'string' || !SESSION_PATTERN.test(sessionId)) {
      throw new AnswersError('INVALID_SESSION', 'session id is not safe');
    }
    if (!Number.isInteger(turn) || turn <= 0) {
      throw new AnswersError('INVALID_TURN', 'turn must be a positive integer');
    }
    await ensureLoaded();
    return records.filter((record) => record.sessionId === sessionId && record.turn === turn);
  }

  return { record, list, ensureLoaded };
}
