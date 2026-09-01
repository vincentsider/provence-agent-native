/**
 * Grounding broadening (field bug 1 Sep): a session of pins and locks must
 * count as choices. adoptChoicesIntoShortlist pulls the accepted pin and
 * every locked card into the shortlist (the single source of truth the
 * postcard footer and carnet render), never duplicating existing keeps.
 */

import { ShortlistStore } from '@/lib/shortlist';

const shortlist = new ShortlistStore();
let pinnedId: number | null = null;
let lockedIds: number[] = [];

jest.mock('@/lib/shortlist', () => {
  const actual = jest.requireActual('@/lib/shortlist') as object;
  return { ...actual, getShortlistStore: () => shortlist };
});
jest.mock('@/lib/pin', () => ({
  getPinStore: () => ({ getSnapshot: () => (pinnedId === null ? null : { id: pinnedId }) }),
}));
jest.mock('@/lib/signals', () => ({
  getSignalsLog: () => ({ lockedIds: () => lockedIds }),
}));
jest.mock('@/lib/agent-context', () => ({
  getAgentRequest: () => 'week-end romantique',
  setAgentRequest: () => undefined,
}));
jest.mock('@/lib/glyphs', () => ({ pickGlyph: () => '🏨' }));

import { adoptChoicesIntoShortlist } from '@/webmcp/tools';
import type { Store } from '@/lib/store';

const place = (id: number) => ({ id, d1: id === 3 ? '2026-09-05' : undefined });
const fakeStore = {
  getByIdOrUrl: ({ id }: { id?: number }) => (id !== undefined && id < 100 ? place(id) : null),
  toPublicShape: (p: { id: number }) => ({
    id: p.id,
    name: `Place ${p.id}`,
    town: 'Cassis',
    url: `https://www.myprovence.fr/p${p.id}`,
    image: null,
  }),
  vocab: { towns: [] },
} as unknown as Store;

describe('adoptChoicesIntoShortlist', () => {
  beforeEach(() => {
    shortlist.destroy();
    pinnedId = null;
    lockedIds = [];
  });

  it('adopts the pin (with the current request) and every lock, once each', () => {
    pinnedId = 1;
    lockedIds = [2, 3, 2];
    const selection = adoptChoicesIntoShortlist(fakeStore);
    expect(selection.map((i) => i.id).sort()).toEqual([1, 2, 3]);
    expect(selection.find((i) => i.id === 1)?.request).toBe('week-end romantique');
    expect(selection.find((i) => i.id === 3)?.d1).toBe('2026-09-05');
  });

  it('never duplicates an already-kept item and skips vanished places', () => {
    shortlist.keep({ id: 2, name: 'kept', town: 'Cassis', url: 'u', d1: null, d2: null });
    pinnedId = 2;
    lockedIds = [999]; // not in the catalogue any more
    const selection = adoptChoicesIntoShortlist(fakeStore);
    expect(selection).toHaveLength(1);
    expect(selection[0]!.name).toBe('kept'); // the visitor's own keep wins
  });

  it('returns the plain shortlist when there is nothing to adopt', () => {
    expect(adoptChoicesIntoShortlist(fakeStore)).toHaveLength(0);
  });
});
