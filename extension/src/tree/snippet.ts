/**
 * Heuristic snippet/title extraction. Pure, no I/O.
 *
 * Goal: turn raw message text into a short, scannable title. The current
 * baseline (first 120 chars) wastes too many characters on filler phrases
 * like "Sure!" or "Great question — happy to help with that…".
 */

const MAX_TITLE = 140;
/** Questions keep more context than a one-line title before truncating. */
const MAX_TITLE_HUMAN = 180;
const MAX_BODY = 320;

/**
 * Common assistant opener phrases that carry no information. Stripped once
 * from the front if the remainder is still substantive (≥ 4 words). Order
 * matters: longer phrases first so they take precedence over their prefixes.
 */
const FILLER_PREFIXES = [
  "i'd be happy to help",
  "i'd be happy to",
  "happy to help",
  "great question",
  "of course",
  "i can help",
  "i can definitely",
  "absolutely",
  "certainly",
  "sure thing",
  "here is",
  "here's",
  "let me",
  "i'll",
  "i will",
  "sure",
];

/** Tokens we treat as boundary punctuation right after a filler prefix. */
const FILLER_BOUNDARY = /[\s,!.\-—:;]+/;

/**
 * Strips one leading filler prefix from assistant text. Returns the original
 * text unchanged when the role is human, no prefix matches, or the stripped
 * remainder collapses to fewer than 4 words (in which case the filler IS the
 * content — preserve it).
 */
export function stripFiller(role: 'human' | 'assistant', text: string): string {
  if (role !== 'assistant') return text;
  const trimmed = text.replace(/^\s+/, '');
  const lower = trimmed.toLowerCase();
  for (const prefix of FILLER_PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    // The character right after the prefix must be a boundary (otherwise
    // we'd strip "Surely…" thinking it's "Sure" + "ly").
    const afterIdx = prefix.length;
    const after = trimmed.charAt(afterIdx);
    if (after && !FILLER_BOUNDARY.test(after)) continue;
    const rest = trimmed.slice(afterIdx).replace(/^[\s,!.\-—:;]+/, '');
    if (wordCount(rest) >= 4) return rest;
    return trimmed; // remainder too short → keep original
  }
  return trimmed;
}

/**
 * Title = the message from its ACTUAL beginning, clamped at a sentence boundary.
 * We never skip leading words/sentences (per user preference); the only thing
 * removed is a single leading block marker (`#`, `-`, `*`, `1.`) so the snippet
 * doesn't open with a stray markdown symbol. Humans keep more context
 * (MAX_TITLE_HUMAN) than assistants (MAX_TITLE) before truncating.
 */
export function pickTitle(role: 'human' | 'assistant', text: string): string {
  if (!text) return '';
  const limit = role === 'human' ? MAX_TITLE_HUMAN : MAX_TITLE;
  const cleaned = stripLeadingMarker(collapseWhitespace(text).trim());
  return clampAtSentence(cleaned, limit);
}

/** Drops a single leading block marker (heading / bullet / ordered) — keeps all words. */
function stripLeadingMarker(s: string): string {
  return s.replace(/^(?:#{1,6}|[-*+]|\d+\.)\s+/, '');
}

/**
 * Returns `s` unchanged when within `limit`; otherwise truncates at the last
 * sentence boundary past the halfway mark, falling back to a word-boundary
 * ellipsis. Keeps as much context as fits without cutting mid-sentence.
 */
function clampAtSentence(s: string, limit: number): string {
  if (s.length <= limit) return s;
  const slice = s.slice(0, limit);
  const lastStop = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
  );
  if (lastStop >= limit * 0.5) return slice.slice(0, lastStop + 1).trim();
  return slice.replace(/\s+\S*$/, '') + '…';
}

/**
 * Builds a longer, multi-sentence excerpt for the answer half of a card.
 * Fenced code is removed first (it's surfaced separately as a code preview),
 * whitespace is collapsed, and the result is clamped to ~MAX_BODY chars at a
 * sentence boundary when one falls reasonably close to the limit.
 */
export function pickBody(text: string, maxChars = MAX_BODY): string {
  const cleaned = stripLeadingMarker(collapseWhitespace(stripFences(text)).trim());
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, maxChars);
  const lastStop = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (lastStop >= maxChars * 0.5) return slice.slice(0, lastStop + 1);
  return slice.replace(/\s+\S*$/, '') + '…';
}

/**
 * Markdown-preserving excerpt for the folded card: keeps newlines and inline
 * markup (bold / lists) so the snippet renders with the same treatment as the
 * expanded reader. Code fences are stripped (the code chip summarizes them).
 * Clamped near maxChars at a paragraph or sentence boundary.
 */
export function pickBodyMd(text: string, maxChars: number): string {
  // Fences and tables are summarized by their own kind blocks (code / table
  // chips) — keep them out of the snippet so they aren't shown twice.
  const cleaned = stripFences(text)
    .split('\n')
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l))
    .join('\n')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, maxChars);
  const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
  if (lastBreak >= maxChars * 0.5) return slice.slice(0, lastBreak + 1);
  return slice.replace(/\s+\S*$/, '') + '…';
}

export function wordCountOf(text: string): number {
  return wordCount(text);
}

/** Removes fenced code blocks so prose excerpts don't dump raw code. */
function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z0-9_+\-]*\n[\s\S]*?```/g, ' ');
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ');
}
