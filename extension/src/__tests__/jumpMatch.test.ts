import { describe, expect, it } from 'vitest';
import { stripMarkdown, matchKey } from '../navigation/jumpToNode';

describe('stripMarkdown', () => {
  it('drops ordered list markers so API text matches rendered DOM (newline form)', () => {
    // API text has "1." which claude.ai renders as an <ol> marker (not in textContent).
    const api = stripMarkdown('I want you to:\n1. Give a real world example of MAPI');
    const rendered = stripMarkdown('I want you to:\nGive a real world example of MAPI');
    expect(api).toBe(rendered);
  });

  it('drops inline list markers after a colon/semicolon (pasted-prompt form)', () => {
    const api = stripMarkdown('Do not just show the call; 1. Show how protobuf compiles');
    const rendered = stripMarkdown('Do not just show the call; Show how protobuf compiles');
    expect(api).toBe(rendered);
  });

  it('drops bullet markers and headings', () => {
    expect(stripMarkdown('- alpha\n- beta')).toBe('alpha beta');
    expect(stripMarkdown('# Title\nbody text')).toBe('title body text');
  });

  it('keeps inline-code CONTENT, drops only the backticks (DOM renders the code)', () => {
    // The exact failing case: API "`.proto `" renders as ".proto" in the DOM.
    expect(stripMarkdown('Where does the `.proto ` file live')).toBe(
      'where does the .proto file live',
    );
    expect(stripMarkdown('use `npm install` here')).toBe('use npm install here');
  });

  it('keeps fenced-code content, drops the fence/language delimiters', () => {
    // The DOM shows the code text, so it must survive normalization.
    expect(stripMarkdown('run ```js\nconsole.log(1)\n``` now')).toBe('run console.log(1) now');
  });

  it('keeps link text, drops the url', () => {
    expect(stripMarkdown('see [the docs](https://x.example) please')).toBe('see the docs please');
  });

  it('collapses whitespace and lowercases', () => {
    expect(stripMarkdown('Hello   World\n\nFoo')).toBe('hello world foo');
  });
});

describe('matchKey', () => {
  it('returns short text unchanged', () => {
    expect(matchKey('short question')).toBe('short question');
  });

  it('takes a mid-slice that disambiguates sibling questions diverging within the window', () => {
    // Two edit-branches sharing an opening but diverging inside the ~88-char key
    // window (the real-world case — verified live: a mid-slice matched uniquely).
    const a = stripMarkdown(
      'I want you to:\n1. Give a real world example of creating campaigns using MAPI from TikTok, Meta and Google',
    );
    const b = stripMarkdown(
      'I want you to:\n1. Show the architecture design for Meta and Google and TikTok ads, then add pros and cons',
    );
    const ka = matchKey(a);
    const kb = matchKey(b);
    expect(ka).not.toBe(kb);
    expect(a).toContain(ka);
    expect(b).toContain(kb);
  });

  it('produces an identical key for API text and the marker-free DOM render', () => {
    const apiKey = matchKey(stripMarkdown('I want you to:\n1. Give a real world example of MAPI calls and protobuf'));
    const renderedKey = matchKey(stripMarkdown('I want you to:\nGive a real world example of MAPI calls and protobuf'));
    expect(apiKey).toBe(renderedKey);
  });
});
