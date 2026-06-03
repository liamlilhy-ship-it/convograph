import { describe, expect, it } from 'vitest';
import { formatModelName } from '../panel/modelName';

describe('formatModelName', () => {
  it('formats current opus ids', () => {
    expect(formatModelName('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(formatModelName('claude-opus-4-7')).toBe('Claude Opus 4.7');
  });

  it('drops the trailing date stamp on dated ids', () => {
    expect(formatModelName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    expect(formatModelName('claude-3-5-sonnet-20241022')).toBe('Claude Sonnet 3.5');
  });

  it('falls back to the raw id when there is nothing to format', () => {
    expect(formatModelName('claude-')).toBe('claude-');
  });

  it('returns empty string for nullish or blank input', () => {
    expect(formatModelName(undefined)).toBe('');
    expect(formatModelName(null)).toBe('');
    expect(formatModelName('   ')).toBe('');
  });
});
