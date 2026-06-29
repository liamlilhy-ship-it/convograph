import type { RefObject } from 'react';

export type SearchBoxProps = {
  query: string;
  onQuery: (q: string) => void;
  /** Total number of matches for the current query. */
  matchCount: number;
  /** 0-based index of the current match, or -1 when there are none. */
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  /** Clear the query and blur (Esc / ✕). */
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement>;
};

/**
 * The panel's whole-conversation search: an input plus a match counter and a
 * prev/next stepper. Stepping jumps to (and branch-switches to) each match via
 * the parent's existing node-click path. Keyboard is handled on the input so it
 * never collides with the global graph shortcuts (the input stops propagation).
 */
export function SearchBox({
  query,
  onQuery,
  matchCount,
  activeIndex,
  onPrev,
  onNext,
  onClose,
  inputRef,
}: SearchBoxProps) {
  const hasQuery = query.trim().length > 0;
  const counter = !hasQuery
    ? ''
    : matchCount === 0
      ? 'No matches'
      : `${activeIndex + 1}/${matchCount}`;

  return (
    <div className="cg-search" role="search">
      <input
        ref={inputRef}
        className="cg-search-input"
        type="text"
        value={query}
        placeholder="Search all branches…"
        aria-label="Search all branches"
        spellCheck={false}
        onChange={(e) => onQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Keep keys local to the input — the canvas/global handlers listen on
          // window and would otherwise pan or toggle the panel.
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      {hasQuery && <span className="cg-search-count">{counter}</span>}
      <button
        onClick={onPrev}
        disabled={matchCount === 0}
        data-tip="Previous match (⇧⏎)"
        aria-label="Previous match"
      >
        ◂
      </button>
      <button
        onClick={onNext}
        disabled={matchCount === 0}
        data-tip="Next match (⏎)"
        aria-label="Next match"
      >
        ▸
      </button>
      {hasQuery && (
        <button onClick={onClose} data-tip="Clear search (Esc)" aria-label="Clear search">
          ✕
        </button>
      )}
    </div>
  );
}
