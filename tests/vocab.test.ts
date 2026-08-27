/**
 * Vocabulary listing: alias twins hidden, populations honest, search works.
 */

import { aliasIds, listVocabulary } from '@/lib/vocab';
import type { Vocab } from '@/lib/types';

const vocab: Vocab = {
  version: 1,
  towns: [],
  tags: {
    '463': {
      label: 'Animaux acceptés',
      n: 869, // union population, as the ingest now computes it
      slug: 'animaux-acceptes',
      source: 'facet',
      aliases: [20813],
    },
    '20813': { label: 'Acceptés', n: 869, slug: 'acceptes', source: 'detail' },
    '469': { label: 'Parking', n: 1362, slug: 'parking', source: 'facet' },
    '465': {
      label: 'Piscine',
      n: 505,
      slug: 'piscine',
      source: 'facet',
      aliases: [21060],
    },
    '21060': { label: 'Piscine', n: 504, slug: 'piscine-21060', source: 'detail' },
  },
};

describe('aliasIds', () => {
  it('collects every alias id', () => {
    expect([...aliasIds(vocab)].sort()).toEqual([20813, 21060]);
  });
});

describe('listVocabulary', () => {
  it('hides alias twins from the listing', () => {
    const { items } = listVocabulary(vocab, undefined, 50);
    const slugs = items.map((t) => t.slug);
    expect(slugs).toContain('animaux-acceptes');
    expect(slugs).toContain('piscine');
    expect(slugs).not.toContain('acceptes');
    expect(slugs).not.toContain('piscine-21060');
  });

  it('sorts by population descending', () => {
    const { items } = listVocabulary(vocab, undefined, 50);
    expect(items[0]?.slug).toBe('parking');
  });

  it('searches labels accent-insensitively', () => {
    const { items, total } = listVocabulary(vocab, 'ANIMAUX', 50);
    expect(total).toBe(1);
    expect(items[0]?.slug).toBe('animaux-acceptes');
  });

  it('respects the limit and reports the true total', () => {
    const { items, total } = listVocabulary(vocab, undefined, 1);
    expect(items).toHaveLength(1);
    expect(total).toBe(3);
  });
});
