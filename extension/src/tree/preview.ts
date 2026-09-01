import type { ApiContentBlock } from '../platforms/model';
import { pickTitle, pickBody, pickBodyMd, wordCountOf } from './snippet';
import { detectKinds, type ContentKind, type MediaRefs } from './contentKinds';

export type NodePreview = {
  /** Short, single-line label (used for the question half). */
  title: string;
  /** Longer multi-sentence excerpt (used for the answer half). */
  body: string;
  /** Markdown-preserving excerpt for the folded card — keeps newlines and
   *  inline markup so the snippet renders like the expanded reader. */
  bodyMd: string;
  kinds: ContentKind[];
  wordCount: number;
  /** Tokens the renderer should visually highlight. Set by sibling diff. */
  highlights: string[];
};

export function computeNodePreview(
  text: string,
  blocks: ApiContentBlock[],
  role: 'human' | 'assistant',
  media?: MediaRefs,
): NodePreview {
  // Show the message from its actual beginning — no filler / leading-sentence
  // skipping. (Per user preference: don't drop the first words.)
  const kinds = detectKinds(text, blocks, media);
  const code = kinds.find((k) => k.kind === 'code');

  // When code dominates, override the title with a "<Language> code" label
  // (or a synthetic title pulled from the first non-comment / non-import line
  // of the code body).
  let title = pickTitle(role, text);
  if (code && code.kind === 'code' && code.dominant) {
    title = synthesizeCodeTitle(text, code.language) ?? title;
  }

  return {
    title,
    body: pickBody(text),
    // Questions clamp tighter (compact card); answers get the taller card.
    bodyMd: pickBodyMd(text, role === 'human' ? 240 : 520),
    kinds,
    wordCount: wordCountOf(text),
    highlights: [],
  };
}

function synthesizeCodeTitle(text: string, language: string | undefined): string | null {
  // Pull first code body
  const m = text.match(/```[a-zA-Z0-9_+\-]*\n([\s\S]*?)```/);
  const body = m?.[1]?.trim();
  if (!body) return language ? `${prettyLang(language)} code` : 'Code';

  // First meaningful line: skip comments / imports / blank
  const lines = body.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(#|\/\/|\/\*|\*|--)/.test(line)) continue;
    if (/^(import|from|using|require|include|package|use)\b/.test(line)) continue;
    return language ? `${prettyLang(language)}: ${truncate(line, 90)}` : truncate(line, 100);
  }
  return language ? `${prettyLang(language)} code` : 'Code';
}

function prettyLang(lang: string): string {
  const map: Record<string, string> = {
    js: 'JavaScript',
    javascript: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    py: 'Python',
    python: 'Python',
    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    rb: 'Ruby',
    ruby: 'Ruby',
    rs: 'Rust',
    rust: 'Rust',
    go: 'Go',
    java: 'Java',
    kt: 'Kotlin',
    kotlin: 'Kotlin',
    swift: 'Swift',
    c: 'C',
    cpp: 'C++',
    'c++': 'C++',
    cs: 'C#',
    csharp: 'C#',
    sql: 'SQL',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    md: 'Markdown',
    markdown: 'Markdown',
    tsx: 'TypeScript',
    jsx: 'JavaScript',
  };
  return map[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
