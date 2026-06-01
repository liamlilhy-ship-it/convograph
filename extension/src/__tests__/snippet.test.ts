import { describe, expect, it } from 'vitest';
import { stripFiller, pickTitle, pickBody } from '../tree/snippet';

describe('stripFiller', () => {
  it('removes leading "Sure!" prefix from assistant text', () => {
    const out = stripFiller('assistant', 'Sure! Here is what you asked about quantum mechanics.');
    expect(out.startsWith('Here is')).toBe(true);
  });

  it('removes "Of course," prefix', () => {
    const out = stripFiller('assistant', 'Of course, that makes sense in context.');
    expect(out).toBe('that makes sense in context.');
  });

  it('keeps original when remainder is too short to be informative', () => {
    const out = stripFiller('assistant', 'Sure!');
    expect(out).toBe('Sure!'); // remainder would be empty → keep original
  });

  it('does not strip from human text', () => {
    const input = 'Sure, can you tell me about cats?';
    expect(stripFiller('human', input)).toBe(input);
  });

  it('does not strip a word that merely starts with a filler ("Surely")', () => {
    const input = 'Surely this is not a filler prefix';
    expect(stripFiller('assistant', input)).toBe(input);
  });

  it('strips the longest matching prefix', () => {
    const input = "I'd be happy to help — just give me a moment to think.";
    const out = stripFiller('assistant', input);
    expect(out.toLowerCase().startsWith("i'd be happy")).toBe(false);
    expect(out).toContain('just give me');
  });
});

describe('pickTitle', () => {
  it('prefers a markdown heading when present', () => {
    const text = '## Bridge Construction\nHere are the key principles...';
    expect(pickTitle('assistant', text)).toBe('Bridge Construction');
  });

  it('prefers the question for human text', () => {
    const text = 'Hey Claude, can you summarize the report I uploaded?';
    expect(pickTitle('human', text)).toContain('summarize the report');
    expect(pickTitle('human', text).endsWith('?')).toBe(true);
  });

  it('picks the first sentence of 4+ words otherwise', () => {
    const text = 'OK. Here are the three main reasons we should rebuild it.';
    const out = pickTitle('assistant', text);
    expect(out).toBe('Here are the three main reasons we should rebuild it.');
  });

  it('falls back to a char clamp for one giant unsegmented blob', () => {
    const text = 'word '.repeat(60);
    const out = pickTitle('assistant', text);
    expect(out.length).toBeLessThanOrEqual(140);
  });

  it('keeps full context for a short multi-sentence question', () => {
    const text = 'I need help with my taxes. Can you explain deductions? I am self-employed.';
    const out = pickTitle('human', text);
    // all three sentences preserved — not cut to just the first
    expect(out).toContain('taxes');
    expect(out).toContain('deductions');
    expect(out).toContain('self-employed');
  });

  it('truncates an over-long question at a sentence boundary', () => {
    const text =
      'First point about the architecture and how it should scale across regions. ' +
      'Second point about the database and the indexes we will need for reads. ' +
      'Third point that pushes well beyond the limit and should be dropped entirely.';
    const out = pickTitle('human', text);
    expect(out.length).toBeLessThanOrEqual(182);
    // truncation lands on a sentence boundary (ends with terminal punctuation)
    expect(/[.?!]$/.test(out.trim())).toBe(true);
  });
});

describe('pickBody', () => {
  it('returns multiple sentences, longer than a single-line title', () => {
    const text =
      'The bridge uses a suspension design. Cables carry the deck load to two towers. ' +
      'Each tower is anchored deep into bedrock for stability.';
    const body = pickBody(text);
    expect(body).toContain('suspension design');
    expect(body).toContain('anchored deep');
  });

  it('strips fenced code so prose body stays readable', () => {
    const text = 'Here is the plan.\n```python\nprint("x")\n```\nIt runs in O(n) time.';
    const body = pickBody(text);
    expect(body).not.toContain('print(');
    expect(body).toContain('plan');
    expect(body).toContain('O(n)');
  });

  it('clamps very long text near the limit at a sentence boundary', () => {
    const text = ('This is a sentence. ').repeat(50);
    const body = pickBody(text, 120);
    expect(body.length).toBeLessThanOrEqual(122);
    expect(body.trim().endsWith('.')).toBe(true);
  });
});
