/**
 * Demand Mirror gating (field bug, 30 Aug): read_visitor_wish returned
 * total=0 (nothing kept yet) and the mirror showed "Demande sans réponse"
 * right after the agent had found an answer. Only catalogue searches may
 * record a numeric total; state-reading tools record null.
 */

const record = jest.fn();

jest.mock('@/lib/demand', () => ({
  getDemandLog: () => ({ record }),
}));

jest.mock('@/lib/store', () => ({
  getStore: () => ({ ready: Promise.resolve(), isReady: true }),
}));

import { makeExecute } from '@/webmcp/tools';
import { z } from 'zod';

const emptySchema = z.object({}).strict();

function run(name: string, total: number) {
  return makeExecute(name, emptySchema, () => ({ data: {}, total }))({});
}

describe('demand gating in makeExecute', () => {
  beforeEach(() => record.mockClear());

  it('records the numeric total for catalogue searches', async () => {
    await run('filter_places', 0);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![2]).toBe(0);
  });

  it.each(['send_scouts', 'find_near', 'find_events', 'find_tonight'])(
    '%s counts as a catalogue search',
    async (name) => {
      await run(name, 7);
      expect(record.mock.calls[0]![2]).toBe(7);
    },
  );

  it.each(['read_visitor_wish', 'get_scout_reports', 'get_visitor_signals', 'get_input_result'])(
    '%s records null: its zero is state, not a missing offer',
    async (name) => {
      await run(name, 0);
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]![2]).toBeNull();
    },
  );
});
