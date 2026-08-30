/**
 * WebMCP polyfill installer (30 Aug), adapted from Trustwright's reference
 * host (github.com/vincentsider/tripwire, Apache-2.0 — our own project).
 *
 * Installed ONLY when the browser has no native document.modelContext. Two
 * consumers depend on it:
 *  - Trustwright's scanner: a headless Chromium with no WebMCP flag polls
 *    for a host the PAGE provides (window.__webmcpPolyfill marks it);
 *    without this, the audit sees zero tools and no badge can be minted.
 *  - badge.js on every human's visit: the live "tools match the audit"
 *    check reads getTools() through the same host.
 *
 * Faithful to the reference semantics (name-collision replacement,
 * AbortSignal unregistration, toolchange listeners) EXCEPT the 1500-char
 * output cap: our envelopes are bigger and truncated JSON would break any
 * consumer that actually executes a tool here (our e2e now does).
 */

interface StoredTool {
  tool: ModelContextTool;
  onAbort?: () => void;
  signal?: AbortSignal;
}

class WebMcpPolyfill {
  #tools = new Map<string, StoredTool>();
  #listeners = new Set<() => void>();

  registerTool(tool: ModelContextTool, options: ModelContextRegisterToolOptions = {}): Promise<undefined> {
    const prev = this.#tools.get(tool.name);
    if (prev?.onAbort && prev.signal) prev.signal.removeEventListener('abort', prev.onAbort);

    const stored: StoredTool = { tool };
    if (options.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        this.#emit();
        return Promise.resolve(undefined);
      }
      const onAbort = () => {
        if (this.#tools.get(tool.name) === stored) {
          this.#tools.delete(tool.name);
          this.#emit();
        }
        signal.removeEventListener('abort', onAbort);
      };
      stored.onAbort = onAbort;
      stored.signal = signal;
      signal.addEventListener('abort', onAbort, { once: true });
    }
    this.#tools.set(tool.name, stored);
    this.#emit();
    return Promise.resolve(undefined);
  }

  getTools(): Promise<RegisteredToolInfo[]> {
    return Promise.resolve(
      [...this.#tools.values()].map(({ tool }) => ({
        name: tool.name,
        ...(tool.title !== undefined ? { title: tool.title } : {}),
        description: tool.description,
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
      })),
    );
  }

  async executeTool(
    tool: RegisteredToolInfo | string,
    input?: object | string,
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    const name = typeof tool === 'string' ? tool : tool.name;
    const stored = this.#tools.get(name);
    if (!stored) throw new Error(`unknown tool: ${name}`);
    const signal = options.signal ?? new AbortController().signal;
    const result = await stored.tool.execute(input, { signal });
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  addEventListener(type: string, handler: () => void): void {
    if (type === 'toolchange') this.#listeners.add(handler);
  }

  removeEventListener(type: string, handler: () => void): void {
    if (type === 'toolchange') this.#listeners.delete(handler);
  }

  dispatchEvent(): boolean {
    return true;
  }

  #emit(): void {
    for (const fn of this.#listeners) {
      try {
        fn();
      } catch {
        /* a listener must not break the host */
      }
    }
  }
}

if (typeof document !== 'undefined') {
  try {
    if (!document.modelContext || typeof document.modelContext.registerTool !== 'function') {
      const host = new WebMcpPolyfill();
      Object.defineProperty(document, 'modelContext', {
        value: host,
        configurable: true,
      });
      (window as unknown as { __webmcpPolyfill: boolean }).__webmcpPolyfill = true;
    }
  } catch {
    /* a hostile getter or frozen document must not break the page */
  }
}

export {};
