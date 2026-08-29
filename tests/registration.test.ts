/**
 * registerAll must be exception-safe in BOTH directions (criterion S6): it
 * runs at module evaluation on the client, so a synchronous IDL throw from
 * the browser's registerTool, an async rejection, or even a throwing
 * modelContext getter must cost at most the tools — never the page.
 */

import { TOOL_COUNT, registerAll, toolDefinitions } from '@/webmcp/tools';

type AnyDoc = { modelContext?: unknown };

const g = globalThis as { document?: AnyDoc };

describe('registerAll resilience', () => {
  afterEach(() => {
    delete g.document;
    jest.resetModules();
  });

  it('is a no-op without document', () => {
    delete g.document;
    expect(() => registerAll()).not.toThrow();
  });

  it('is a no-op when modelContext is absent', () => {
    g.document = {};
    expect(() => registerAll()).not.toThrow();
  });

  it('survives a synchronously throwing registerTool', async () => {
    // Fresh module so the `registered` latch is clear.
    jest.isolateModules(() => {
      const { registerAll: fresh } = require('@/webmcp/tools') as {
        registerAll: () => void;
      };
      g.document = {
        modelContext: {
          registerTool: () => {
            throw new TypeError('IDL says no');
          },
        },
      };
      expect(() => fresh()).not.toThrow();
    });
  });

  it('survives an async registerTool rejection', () => {
    jest.isolateModules(() => {
      const { registerAll: fresh } = require('@/webmcp/tools') as {
        registerAll: () => void;
      };
      g.document = {
        modelContext: {
          registerTool: () => Promise.reject(new Error('later failure')),
        },
      };
      expect(() => fresh()).not.toThrow();
    });
  });

  it('survives a throwing modelContext getter', () => {
    jest.isolateModules(() => {
      const { registerAll: fresh } = require('@/webmcp/tools') as {
        registerAll: () => void;
      };
      const doc = {};
      Object.defineProperty(doc, 'modelContext', {
        get() {
          throw new Error('hostile getter');
        },
      });
      g.document = doc as AnyDoc;
      expect(() => fresh()).not.toThrow();
    });
  });

  it('registers every tool with correct annotations when the API works', () => {
    jest.isolateModules(() => {
      const { registerAll: fresh } = require('@/webmcp/tools') as {
        registerAll: () => void;
      };
      const seen: Array<{
        name: string;
        inputSchema?: Record<string, unknown>;
        annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      }> = [];
      g.document = {
        modelContext: {
          registerTool: (tool: (typeof seen)[number]) => {
            seen.push(tool);
            return Promise.resolve(undefined);
          },
        },
      };
      fresh();
      expect(seen.map((t) => t.name).sort()).toEqual(
        [
          'ask_visitor',
          'compare_places',
          'compose_carnet',
          'explain_vocabulary',
          'filter_places',
          'find_events',
          'find_near',
          'find_tonight',
          'get_agent_demand',
          'get_catalog_stats',
          'get_demand_pulse',
          'get_input_result',
          'get_place',
          'get_scout_reports',
          'get_visitor_signals',
          'get_visitor_view',
          'highlight_places',
          'send_scouts',
          'set_view',
          'write_postcard',
        ].sort(),
      );
      expect(seen).toHaveLength(TOOL_COUNT);
      for (const t of seen) {
        // Derived schemas stay strict all the way to the agent.
        expect(t.inputSchema?.additionalProperties).toBe(false);
      }
      const writeTools = seen.filter((t) => t.annotations?.readOnlyHint === false);
      // ask_visitor renders UI and waits: honestly not read-only.
      expect(writeTools.map((t) => t.name).sort()).toEqual([
        'ask_visitor',
        'compose_carnet',
        'highlight_places',
        'set_view',
        'write_postcard',
      ]);
    });
  });
});

describe('toolDefinitions', () => {
  it('exposes exactly TOOL_COUNT definitions without side effects', () => {
    expect(toolDefinitions()).toHaveLength(TOOL_COUNT);
  });
});
