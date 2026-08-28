/**
 * Elicitation store (issue #608): the agent asks THROUGH the page.
 *
 * ask() renders brand choice cards (via subscribers) and returns a promise
 * that resolves on the visitor's tap. The hybrid contract, from the measured
 * platform limits (Codex documents 60s default per tool call; Apps SDK staff
 * confirm a 1-minute hard limit; site tools undocumented):
 *  - internal timer at 45s: if the visitor has not tapped, the promise
 *    RESOLVES (never rejects) with {status:'pending', input_id, instruction}
 *    and the cards stay on screen; get_input_result() collects later;
 *  - dedup: re-asking a normalized-identical question while one is pending
 *    returns the SAME input_id (ChatGPT's documented duplicate-call
 *    behavior at timeout must not spawn twin cards);
 *  - AbortSignal tears the cards down and marks the input dismissed;
 *  - answer shape modeled on MCP elicitation: action accept/decline/cancel.
 *
 * Leak posture: bounded concurrent questions (oldest dismissed), bounded
 * archive, every timer stored and cleared, listeners unsubscribable,
 * destroy() idempotent. Timers are real; tests drive them with jest fake
 * timers.
 */

import { fold } from './types';

export const ELICIT_BLOCK_MS = 45_000;
const MAX_ACTIVE = 3;
const MAX_ARCHIVE = 50;

export type ElicitAction = 'accept' | 'decline' | 'cancel';

export interface ElicitResult {
  readonly status: 'answered' | 'pending' | 'dismissed';
  readonly input_id: string;
  readonly action?: ElicitAction;
  readonly choice?: string;
  readonly instruction?: string;
}

export interface ActiveQuestion {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
}

interface Entry {
  id: string;
  question: string;
  norm: string;
  options: readonly string[];
  status: 'pending' | 'answered' | 'dismissed';
  action?: ElicitAction;
  choice?: string;
  waiters: Array<(r: ElicitResult) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  abortCleanup: (() => void) | null;
  createdAt: number;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `q-${seq.toString(36)}-${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
}

export class ElicitationStore {
  #entries = new Map<string, Entry>();
  #listeners = new Set<() => void>();
  #snapshot: readonly ActiveQuestion[] = [];
  /** Notified on every answered question (feeds the visitor-signals log). */
  #onAnswer: ((id: string, question: string, choice: string) => void) | null = null;

  onAnswer(fn: (id: string, question: string, choice: string) => void): void {
    this.#onAnswer = fn;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): readonly ActiveQuestion[] => this.#snapshot;

  #publish(): void {
    this.#snapshot = [...this.#entries.values()]
      .filter((e) => e.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => ({ id: e.id, question: e.question, options: e.options }));
    for (const fn of this.#listeners) fn();
  }

  /** The agent asks. Resolves on tap, or with a pending ticket at blockMs. */
  ask(
    question: string,
    options: readonly string[],
    signal?: AbortSignal,
    blockMs: number = ELICIT_BLOCK_MS,
  ): { id: string; promise: Promise<ElicitResult> } {
    const norm = fold(question);

    // Dedup against the documented duplicate-call-at-timeout behavior.
    for (const e of this.#entries.values()) {
      if (e.status === 'pending' && e.norm === norm) {
        return { id: e.id, promise: this.#wait(e, blockMs, signal) };
      }
    }

    // Bound concurrency: the oldest pending question yields its slot.
    const pending = [...this.#entries.values()]
      .filter((e) => e.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);
    while (pending.length >= MAX_ACTIVE) {
      this.#dismiss(pending.shift()!.id, 'cancel');
    }

    const entry: Entry = {
      id: newId(),
      question,
      norm,
      options: options.slice(0, 4),
      status: 'pending',
      waiters: [],
      timer: null,
      abortCleanup: null,
      createdAt: Date.now(),
    };
    this.#entries.set(entry.id, entry);
    this.#gcArchive();
    this.#publish();
    return { id: entry.id, promise: this.#wait(entry, blockMs, signal) };
  }

  #wait(entry: Entry, blockMs: number, signal?: AbortSignal): Promise<ElicitResult> {
    return new Promise<ElicitResult>((resolve) => {
      if (entry.status !== 'pending') {
        resolve(this.result(entry.id));
        return;
      }
      let settled = false;
      const settle = (r: ElicitResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(r);
      };
      entry.waiters.push(settle);

      const timer = setTimeout(() => {
        settle({
          status: 'pending',
          input_id: entry.id,
          instruction:
            `The visitor is still deciding. Call get_input_result with input_id "${entry.id}" ` +
            'to collect their answer; keep helping meanwhile.',
        });
      }, blockMs);
      entry.timer = timer;

      if (signal) {
        const onAbort = () => this.#dismiss(entry.id, 'cancel');
        signal.addEventListener('abort', onAbort, { once: true });
        entry.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
    });
  }

  /** The visitor tapped a card. */
  answer(id: string, choice: string): void {
    const e = this.#entries.get(id);
    if (!e || e.status !== 'pending') return;
    e.status = 'answered';
    e.action = 'accept';
    e.choice = choice;
    this.#settleAll(e, { status: 'answered', input_id: id, action: 'accept', choice });
    this.#onAnswer?.(id, e.question, choice);
    this.#publish();
  }

  /** The visitor closed the cards without choosing. */
  decline(id: string): void {
    this.#dismiss(id, 'decline');
  }

  #dismiss(id: string, action: ElicitAction): void {
    const e = this.#entries.get(id);
    if (!e || e.status !== 'pending') return;
    e.status = 'dismissed';
    e.action = action;
    this.#settleAll(e, { status: 'dismissed', input_id: id, action });
    this.#publish();
  }

  #settleAll(e: Entry, r: ElicitResult): void {
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    e.abortCleanup?.();
    e.abortCleanup = null;
    const waiters = e.waiters;
    e.waiters = [];
    for (const w of waiters) w(r);
  }

  result(id: string): ElicitResult {
    const e = this.#entries.get(id);
    if (!e) return { status: 'dismissed', input_id: id, action: 'cancel' };
    if (e.status === 'answered') {
      return { status: 'answered', input_id: id, action: 'accept', choice: e.choice };
    }
    if (e.status === 'dismissed') {
      return { status: 'dismissed', input_id: id, action: e.action ?? 'cancel' };
    }
    return {
      status: 'pending',
      input_id: id,
      instruction: 'Still pending; ask again shortly or continue without it.',
    };
  }

  #gcArchive(): void {
    const settledEntries = [...this.#entries.values()]
      .filter((e) => e.status !== 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);
    while (this.#entries.size > MAX_ARCHIVE && settledEntries.length > 0) {
      this.#entries.delete(settledEntries.shift()!.id);
    }
  }

  destroy(): void {
    for (const e of this.#entries.values()) {
      if (e.status === 'pending') this.#settleAll(e, { status: 'dismissed', input_id: e.id, action: 'cancel' });
    }
    this.#entries.clear();
    this.#listeners.clear();
    this.#snapshot = [];
  }
}

let singleton: ElicitationStore | null = null;

export function getElicitationStore(): ElicitationStore {
  if (typeof window === 'undefined') throw new Error('ElicitationStore is client-only');
  if (!singleton) singleton = new ElicitationStore();
  return singleton;
}
