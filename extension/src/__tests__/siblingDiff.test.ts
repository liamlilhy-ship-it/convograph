import { describe, expect, it } from 'vitest';
import { siblingHighlights } from '../tree/siblingDiff';

describe('siblingHighlights', () => {
  it('produces 1–2 unique tokens per sibling, distinct across siblings', () => {
    const texts = [
      'A vibrant warm red would brighten the room and feel inviting.',
      'A deep indigo gives the room a calm contemplative mood.',
      'Forest green would bring nature inside and feel grounding.',
    ];
    const out = siblingHighlights(texts);
    expect(out).toHaveLength(3);

    // Each sibling gets at least one highlight
    expect(out[0]!.length).toBeGreaterThan(0);
    expect(out[1]!.length).toBeGreaterThan(0);
    expect(out[2]!.length).toBeGreaterThan(0);

    // No highlight token may appear in any OTHER sibling's full text — that's
    // the contract of sibling diff: each card's highlight is unique to it.
    for (let i = 0; i < texts.length; i++) {
      for (const tok of out[i]!) {
        for (let j = 0; j < texts.length; j++) {
          if (i === j) continue;
          expect(texts[j]!.toLowerCase()).not.toContain(tok);
        }
      }
    }
  });

  it('returns empty arrays for a single-element input', () => {
    expect(siblingHighlights(['anything'])).toEqual([[]]);
  });

  it('excludes stopwords', () => {
    const texts = ['the the the cats', 'the the the dogs'];
    const out = siblingHighlights(texts);
    expect(out[0]).toContain('cats');
    expect(out[1]).toContain('dogs');
    for (const h of out.flat()) {
      expect(['the', 'a', 'and', 'of']).not.toContain(h);
    }
  });

  it('returns at most 2 highlights per card', () => {
    const texts = [
      'apple banana cherry durian elderberry',
      'foxglove gourd hibiscus iris juniper',
    ];
    const out = siblingHighlights(texts);
    expect(out[0]!.length).toBeLessThanOrEqual(2);
    expect(out[1]!.length).toBeLessThanOrEqual(2);
  });
});
