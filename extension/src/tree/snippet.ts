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
 * Selects the best title from a (cleaned) chunk of text.
 *   1. First markdown heading takes precedence (both roles).
 *   2. Human: keep the full question text (all its sentences/points) up to
 *      MAX_TITLE_HUMAN chars, truncating only when it's genuinely too long —
 *      so multi-sentence questions keep their context instead of being cut to
 *      the first sentence.
 *   3. Assistant: first informative sentence (≥4 words), skipping "OK."/"Sure!".
 *   4. Fallback: clamp the cleaned text.
 */
export function pickTitle(role: 'human' | 'assistant', text: string): string {
  if (!text) return '';
  const head = text.slice(0, 800);

  // 1. Markdown heading
  const headingMatch = head.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)\s*$/m);
  if (headingMatch && headingMatch[2]) {
    return clamp(collapseWhitespace(headingMatch[2]), MAX_TITLE);
  }

  // 2. Human: preserve full question context, truncate only when needed.
  if (role === 'human') {
    return clampAtSentence(collapseWhitespace(text).trim(), MAX_TITLE_HUMAN);
  }

  // 3. Assistant: first sentence of ≥ 4 words.
  const sentenceMatches = head.split(/(?<=[.?!])\s+(?=[A-Z0-9"'(\[])/);
  for (const s of sentenceMatches) {
    const clean = collapseWhitespace(s).trim();
    if (wordCount(clean) >= 4) return clamp(clean, MAX_TITLE);
  }

  // 4. Char fallback
  return clamp(collapseWhitespace(text), MAX_TITLE);
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
  const cleaned = collapseWhitespace(stripFences(text)).trim();
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

function clamp(s: string, limit: number = MAX_TITLE): string {
  return s.length <= limit ? s : s.slice(0, limit - 1) + '…';
}
