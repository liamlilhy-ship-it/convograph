import { useEffect, useMemo, useRef, useState } from 'react';
import { tagColorVar, type Tag } from '../tags/tags';

/**
 * Per-node multi-select tag combobox (presentational). All mutations go through
 * callbacks — App owns the tag state and persistence. The picker only renders the
 * current options and reports intent.
 *
 *   - select / deselect an existing tag (toggle assignment for this node)
 *   - create a new tag by typing a name (shown only when no exact name match)
 *   - rename an existing tag inline (propagates everywhere via the tag id)
 */

export type TagPickerProps = {
  nodeTags: Tag[]; // tags currently on this node (the selected set)
  allTags: Tag[]; // every tag in the chat (the options)
  onSelectExisting: (tagId: string) => void;
  onCreate: (name: string) => void;
  onRemoveFromNode: (tagId: string) => void;
  onRename: (tagId: string, name: string) => void;
  onClose: () => void;
};

const swatch = (color: number) => ({ background: `var(${tagColorVar(color)})` });

export function TagPicker(props: TagPickerProps) {
  const { nodeTags, allTags, onSelectExisting, onCreate, onRemoveFromNode, onRename, onClose } = props;
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => new Set(nodeTags.map((t) => t.id)), [nodeTags]);
  const q = query.trim();
  const qlc = q.toLowerCase();
  const filtered = useMemo(
    () => (qlc ? allTags.filter((t) => t.name.toLowerCase().includes(qlc)) : allTags),
    [allTags, qlc],
  );
  const exactMatch = useMemo(
    () => allTags.find((t) => t.name.trim().toLowerCase() === qlc),
    [allTags, qlc],
  );
  const canCreate = q.length > 0 && !exactMatch;

  // Autofocus the input on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click (shadow-DOM aware) and on Escape.
  useEffect(() => {
    const onDown = (e: Event) => {
      const root = rootRef.current;
      if (root && !e.composedPath().includes(root)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const toggle = (tag: Tag) => {
    if (selected.has(tag.id)) onRemoveFromNode(tag.id);
    else onSelectExisting(tag.id);
  };

  const commitInput = () => {
    if (exactMatch) {
      if (!selected.has(exactMatch.id)) onSelectExisting(exactMatch.id);
      setQuery('');
    } else if (canCreate) {
      onCreate(q);
      setQuery('');
    }
  };

  const startRename = (tag: Tag) => {
    setRenamingId(tag.id);
    setRenameValue(tag.name);
  };
  const commitRename = (tag: Tag) => {
    const v = renameValue.trim();
    if (v && v !== tag.name) onRename(tag.id, v);
    setRenamingId(null);
  };

  return (
    <div
      ref={rootRef}
      className="cg-tag-picker nowheel nopan"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* selected chips */}
      {nodeTags.length > 0 && (
        <div className="cg-tag-picker-selected">
          {nodeTags.map((t) => (
            <span key={t.id} className="cg-tag-chip" style={{ ['--cg-tag' as never]: `var(${tagColorVar(t.color)})` }}>
              {t.name}
              <button
                type="button"
                className="cg-tag-chip-x"
                aria-label={`Remove ${t.name}`}
                onClick={() => onRemoveFromNode(t.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        className="cg-tag-picker-input"
        type="text"
        placeholder="Add or create a tag…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commitInput();
          }
        }}
      />

      <div className="cg-tag-picker-list">
        {filtered.map((t) => {
          const isSel = selected.has(t.id);
          if (renamingId === t.id) {
            return (
              <div key={t.id} className="cg-tag-opt cg-tag-opt-renaming">
                <span className="cg-tag-swatch" style={swatch(t.color)} />
                <input
                  className="cg-tag-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(t);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setRenamingId(null);
                    }
                  }}
                  onBlur={() => commitRename(t)}
                />
              </div>
            );
          }
          return (
            <div key={t.id} className="cg-tag-opt" data-selected={isSel ? 'true' : undefined}>
              <button type="button" className="cg-tag-opt-main" onClick={() => toggle(t)}>
                <span className="cg-tag-swatch" style={swatch(t.color)} />
                <span className="cg-tag-opt-name">{t.name}</span>
                {isSel && <span className="cg-tag-check">✓</span>}
              </button>
              <button
                type="button"
                className="cg-tag-opt-edit"
                aria-label={`Rename ${t.name}`}
                data-tip="Rename"
                onClick={() => startRename(t)}
              >
                ✎
              </button>
            </div>
          );
        })}

        {canCreate && (
          <button type="button" className="cg-tag-opt cg-tag-create" onClick={commitInput}>
            Create “{q}”
          </button>
        )}

        {filtered.length === 0 && !canCreate && <div className="cg-tag-empty">No tags yet</div>}
      </div>
    </div>
  );
}
