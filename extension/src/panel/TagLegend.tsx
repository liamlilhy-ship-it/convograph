import { useState } from 'react';
import { tagColorVar, type Tag } from '../tags/tags';

/**
 * Toolbar legend listing every tag in the chat. Clicking a tag highlights all the
 * nodes carrying it (click again clears). Also the home for tag-level rename and
 * delete. Mutations go through callbacks; App owns the state.
 */

export type TagLegendProps = {
  tags: Tag[];
  activeTagId: string | null;
  onToggle: (tagId: string) => void;
  onRename: (tagId: string, name: string) => void;
  onDelete: (tagId: string) => void;
};

export function TagLegend({ tags, activeTagId, onToggle, onRename, onDelete }: TagLegendProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [value, setValue] = useState('');

  if (tags.length === 0) return null;

  const startRename = (t: Tag) => {
    setRenamingId(t.id);
    setValue(t.name);
  };
  const commit = (t: Tag) => {
    const v = value.trim();
    if (v && v !== t.name) onRename(t.id, v);
    setRenamingId(null);
  };

  return (
    <div className="cg-tag-legend" role="group" aria-label="Tags">
      {tags.map((t) => {
        if (renamingId === t.id) {
          return (
            <span key={t.id} className="cg-tag-legend-item cg-tag-legend-renaming">
              <span className="cg-tag-swatch" style={{ background: `var(${tagColorVar(t.color)})` }} />
              <input
                className="cg-tag-rename-input"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commit(t);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingId(null);
                  }
                }}
                onBlur={() => commit(t)}
              />
            </span>
          );
        }
        return (
          <span key={t.id} className="cg-tag-legend-item" data-active={activeTagId === t.id ? 'true' : undefined}>
            <button
              type="button"
              className="cg-tag-legend-toggle"
              aria-pressed={activeTagId === t.id}
              data-tip="Highlight tagged nodes"
              onClick={() => onToggle(t.id)}
            >
              <span className="cg-tag-swatch" style={{ background: `var(${tagColorVar(t.color)})` }} />
              <span className="cg-tag-legend-name">{t.name}</span>
            </button>
            <button type="button" className="cg-tag-legend-act" aria-label={`Rename ${t.name}`} data-tip="Rename" onClick={() => startRename(t)}>
              ✎
            </button>
            <button type="button" className="cg-tag-legend-act" aria-label={`Delete ${t.name}`} data-tip="Delete tag" onClick={() => onDelete(t.id)}>
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}
