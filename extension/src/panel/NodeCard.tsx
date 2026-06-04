import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DisplayNode } from '../tree/displayTree';
import { renderMarkdown } from './markdown';
import { formatModelName } from './modelName';
import type { ContentKind, WidgetRef, ArtifactRef, FileRef } from '../tree/contentKinds';
import type { NodePreview } from '../tree/preview';
import {
  CodeIcon,
  ImageIcon,
  AttachmentIcon,
  LinkIcon,
  FileIcon,
  UserIcon,
  ClaudeIcon,
  RegenIcon,
  ExpandIcon,
  WindowIcon,
  EditIcon,
  FollowUpIcon,
  SendIcon,
} from './icons';
import { type PreviewItem } from './HoverPreview';
import { FullPreview } from './FullPreview';
import { svgDataUri } from './widgetRender';

// Fixed markdown font size for the in-place preview (the floating window's is
// adjustable; the inline card's is intentionally fixed).
const INLINE_PREVIEW_FS = 14;

type HoverApi = {
  onPreview: (item: PreviewItem, rect: DOMRect) => void;
  onPreviewEnd: () => void;
};

/** The kind of draft a quick-action spawns. `edit`/`followup` are editable;
 *  `regenerate` is a read-only copy of the question that fires immediately. */
export type DraftKind = 'edit' | 'followup' | 'regenerate';
/** View model for the floating draft node (separate from any real DisplayNode). */
export type DraftView = {
  kind: DraftKind;
  /** Prefilled text (edit) / asked text once submitted, or read-only copy (regenerate). */
  title: string;
  editable: boolean;
  status: 'editing' | 'generating';
  /** Live-streamed answer text while generating (progressive enhancement). */
  streamText?: string;
  /** The conversation's current model id (e.g. "claude-opus-4-8"). This is what
   *  a new completion uses, so it's shown on the editable inputs and the streaming
   *  answer to tell the user which model will produce / is producing the reply. */
  model?: string | null;
};

export type NodeCardProps = HoverApi & {
  node: DisplayNode;
  jumping?: boolean;
  isPreview?: boolean;
  /** Whether clicking the card jumps to the message. False in full-screen (the
   *  native chat that a jump would scroll is hidden), making the click inert. */
  canJump?: boolean;
  /** A draft/generation is open somewhere — disable all quick-action buttons so a
   *  second completion can't fire concurrently (claude.ai rejects those). */
  locked?: boolean;
  /** Tooltip shown on the disabled action buttons explaining the lock. */
  lockReason?: string;
  onClick: (node: DisplayNode) => void;
  onOpenPreview: (node: DisplayNode) => void;
  onTogglePreview: (node: DisplayNode) => void;
  onStartEdit: (node: DisplayNode) => void;
  onStartFollowup: (node: DisplayNode) => void;
  onRegenerate: (node: DisplayNode) => void;
  style?: CSSProperties;
};

/** Whether a preview carries media (drives the footer + the height tier). */
export function hasMedia(p: NodePreview): boolean {
  return p.kinds.some(
    (k) => k.kind === 'image' || k.kind === 'widget' || k.kind === 'attachment' || k.kind === 'artifact',
  );
}

export function NodeCard({
  node,
  jumping,
  isPreview,
  canJump = true,
  locked,
  lockReason,
  onPreview,
  onPreviewEnd,
  onClick,
  onOpenPreview,
  onTogglePreview,
  onStartEdit,
  onStartFollowup,
  onRegenerate,
  style,
}: NodeCardProps) {
  const isHuman = node.role === 'human';
  const p = node.preview;
  const text = isHuman ? p.title : p.body || p.title;
  const hover: HoverApi = { onPreview, onPreviewEnd };
  const branch = node.branchKind;
  const pipTitle =
    branch === 'regenerate'
      ? 'Regenerated answer (same question)'
      : branch === 'edit'
        ? 'Edited question branch'
        : undefined;
  // A previewed card is a reader — fix the font and stop card clicks from
  // branch-jumping so text stays selectable.
  const cardStyle: CSSProperties | undefined = isPreview
    ? { ...style, ['--cg-pv-fs' as never]: `${INLINE_PREVIEW_FS}px` }
    : style;
  // Regenerate retries an existing answer — only meaningful once the turn has one.
  const canRegenerate = node.assistantId != null;

  return (
    <div
      className="cg-node"
      data-role={node.role}
      data-active={node.isOnActivePath ? 'true' : 'false'}
      data-jumping={jumping ? 'true' : 'false'}
      data-preview={isPreview ? 'true' : 'false'}
      style={cardStyle}
      onClick={isPreview || !canJump ? undefined : () => onClick(node)}
    >
      <div
        className="cg-head"
        // In preview mode the body is for reading (no card-level jump), so the
        // header row becomes the click-to-jump target instead. In full-screen
        // (!canJump) nothing jumps, so no click target / "jump" tooltip at all.
        onClick={isPreview && canJump ? () => onClick(node) : undefined}
        title={isPreview && canJump ? 'Jump to this message' : undefined}
      >
        <span className="cg-role">
          {isHuman ? <UserIcon size={12} /> : <ClaudeIcon size={12} />}
          {isHuman ? 'You' : 'Claude'}
        </span>
        {branch === 'regenerate' && (
          <span className="cg-tag-regen" title="Regenerated answer (same question)">
            <RegenIcon size={11} />
            regen
          </span>
        )}
        {branch && node.siblingCount > 1 && (
          <span className="cg-pip" title={pipTitle}>
            {node.siblingIndex + 1}/{node.siblingCount}
          </span>
        )}
        <div className="cg-head-actions">
          {isHuman ? (
            <>
              <button
                type="button"
                className="cg-pv-btn"
                // aria-disabled (not `disabled`) keeps the element hoverable so the
                // tooltip explaining the lock still shows; the click is guarded below.
                aria-disabled={locked || undefined}
                data-tip={locked ? lockReason : 'Edit question'}
                aria-label="Edit question"
                onClick={(e) => {
                  e.stopPropagation();
                  if (locked) return;
                  onStartEdit(node);
                }}
              >
                <EditIcon size={12} />
              </button>
              {canRegenerate && (
                <button
                  type="button"
                  className="cg-pv-btn"
                  aria-disabled={locked || undefined}
                  data-tip={locked ? lockReason : 'Regenerate answer'}
                  aria-label="Regenerate answer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (locked) return;
                    onRegenerate(node);
                  }}
                >
                  <RegenIcon size={12} />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="cg-pv-btn"
              aria-disabled={locked || undefined}
              data-tip={locked ? lockReason : 'Ask follow-up'}
              aria-label="Ask follow-up"
              onClick={(e) => {
                e.stopPropagation();
                if (locked) return;
                onStartFollowup(node);
              }}
            >
              <FollowUpIcon size={12} />
            </button>
          )}
          <button
            type="button"
            className="cg-pv-btn"
            data-tip="Open full preview window"
            aria-label="Open full preview window"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPreview(node);
            }}
          >
            <WindowIcon size={12} />
          </button>
          <button
            type="button"
            className="cg-pv-toggle"
            data-active={isPreview ? 'true' : 'false'}
            data-tip={isPreview ? 'Collapse preview' : 'Preview in place'}
            aria-label={isPreview ? 'Collapse preview' : 'Preview in place'}
            aria-pressed={isPreview ? 'true' : 'false'}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePreview(node);
            }}
          >
            <ExpandIcon size={12} />
          </button>
        </div>
      </div>
      {isPreview ? (
        <div className="cg-node-pv-body nowheel nopan">
          <FullPreview node={node} />
        </div>
      ) : (
        <>
          <div className="cg-body">
            <div className="cg-content">
              <div className="cg-snippet cg-text">
                {text ? renderText(text, p.highlights) : <em style={{ opacity: 0.55 }}>(empty)</em>}
              </div>
              <RichKinds preview={p} />
            </div>
          </div>
          <Footer
            files={collectFiles(p)}
            artifacts={collectArtifacts(p)}
            thumbs={collectThumbs(p)}
            hover={hover}
          />
        </>
      )}
    </div>
  );
}

/**
 * The floating draft QUESTION node — a separate human card spawned on the canvas
 * when the user starts an Edit / Follow-up / Regenerate, wired into the graph with
 * the correct parent so the original node stays in view. While editing it shows a
 * composer; once generating it shows the question read-only (the streamed answer
 * lives in a separate child answer node, `DraftAnswerCard`).
 */
export function DraftQuestionCard({
  draft,
  style,
  onCancel,
  onSubmit,
}: {
  draft: DraftView;
  style?: CSSProperties;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const generating = draft.status === 'generating';
  const showEditor = draft.editable && !generating;
  return (
    <div
      className="cg-node cg-node-draft"
      data-role="human"
      data-active="true"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cg-head">
        <span className="cg-role">
          <UserIcon size={12} />
          You
        </span>
        {/* The model that will answer this draft (the conversation's current model).
            Shown on the editable inputs (edit / follow-up) only. */}
        {showEditor && draft.model && (
          <span
            className="cg-model"
            title={`New answer will use the conversation's current model · ${draft.model}`}
          >
            {formatModelName(draft.model)}
          </span>
        )}
        {/* No "regen" tag here on purpose: the draft mirrors the original question
            while generating; the tag appears on the real branch after it lands. */}
      </div>
      {showEditor ? (
        <InlineEditor
          mode={draft.kind === 'followup' ? 'followup' : 'edit'}
          initial={draft.title}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      ) : (
        <div className="cg-draft-body nowheel nopan">
          <div className="cg-draft-q cg-draft-q-full">
            {draft.title || <em style={{ opacity: 0.55 }}>New question</em>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The floating draft ANSWER node — an assistant card, child of the draft question.
 * Defaults to the in-line-preview reader (the big scrollable markdown view), so the
 * streamed reply reads like an expanded node rather than a cramped snippet. Carries
 * a "Generating…" pill + Cancel/abort, and is replaced by the real answer node when
 * the stream finishes.
 */
export function DraftAnswerCard({
  streamText,
  model,
  style,
  onCancel,
}: {
  streamText?: string;
  /** Conversation's current model id — shown so the user knows what's generating. */
  model?: string | null;
  style?: CSSProperties;
  onCancel: () => void;
}) {
  // Match the in-place preview's fixed reader font.
  const cardStyle: CSSProperties = { ...style, ['--cg-pv-fs' as never]: `${INLINE_PREVIEW_FS}px` };
  return (
    <div
      className="cg-node cg-node-draft"
      data-role="assistant"
      data-active="true"
      data-preview="true"
      style={cardStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cg-head">
        <span className="cg-role">
          <ClaudeIcon size={12} />
          Claude
        </span>
        <span className="cg-busy">Generating…</span>
        {model && (
          <span
            className="cg-model"
            title={`Generating with the conversation's current model · ${model}`}
          >
            {formatModelName(model)}
          </span>
        )}
        <div className="cg-head-actions">
          <button type="button" className="cg-editor-btn cg-draft-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      <StreamingReader text={streamText} />
    </div>
  );
}

/**
 * Scrollable in-line-preview reader for the streaming answer. Renders the partial
 * text as markdown (matching a node's expanded preview) and keeps the newest text
 * in view — but ONLY while the user is already at the bottom. If they scroll up to
 * read earlier content, their position is left alone as more text streams in.
 */
function StreamingReader({ text }: { text?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Whether to keep pinning to the bottom as content grows. Flipped off when the
  // user scrolls away from the bottom, back on when they return to it.
  const stick = useRef(true);
  const html = useMemo(() => (text ? renderMarkdown(text) : ''), [text]);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [html]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  };
  return (
    <div className="cg-node-pv-body nowheel nopan" ref={ref} onScroll={onScroll}>
      {text ? (
        <div className="cg-pv-content">
          <div className="cg-pv-md" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : (
        <div className="cg-pv-content">
          <span className="cg-muted">Claude is responding…</span>
        </div>
      )}
    </div>
  );
}

/**
 * Inline question composer used inside a draft node. Fresh-mounts each time a
 * draft opens, so `useState(initial)` seeds it correctly — `edit` prefills the
 * question text, `followup` starts empty. ⌘/Ctrl+Enter submits, Esc cancels.
 * Clicks/keys are stopped from bubbling so they never pan the canvas.
 */
function InlineEditor({
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  mode: 'edit' | 'followup';
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Place the cursor at the end of any prefilled text.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const canSend = text.trim().length > 0;
  const submit = () => {
    if (canSend) onSubmit(text.trim());
  };
  return (
    <div className="cg-editor nowheel nopan" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="cg-editor-input"
        value={text}
        placeholder={mode === 'followup' ? 'Ask a follow-up…' : 'Edit the question…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="cg-editor-actions">
        <span className="cg-editor-hint">⌘↵ to send</span>
        <button type="button" className="cg-editor-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="cg-editor-btn cg-editor-send"
          disabled={!canSend}
          onClick={submit}
        >
          <SendIcon size={12} />
          {mode === 'followup' ? 'Send' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** Bottom footer: files (uploaded + generated) stacked above the thumbnail
 *  strip. `margin-top:auto` (CSS) pins the block to the card's bottom edge. */
function Footer({
  files,
  artifacts,
  thumbs,
  hover,
}: {
  files: FileRef[];
  artifacts: ArtifactRef[];
  thumbs: Thumb[];
  hover: HoverApi;
}) {
  if (!files.length && !artifacts.length && !thumbs.length) return null;
  return (
    <div className="cg-foot">
      <FileStrip files={files} />
      <ArtifactStrip artifacts={artifacts} />
      <ThumbStrip thumbs={thumbs} hover={hover} />
    </div>
  );
}

/** Uploaded-file rows (filename + type/size). */
function collectFiles(p: NodePreview): FileRef[] {
  for (const k of p.kinds) {
    if (k.kind === 'attachment') {
      // Generic attachment with no concrete file metadata → a single placeholder.
      if (k.files.length === 0 && k.count > 0) return [{ name: 'Attachment' }];
      return k.files.slice(0, 3);
    }
  }
  return [];
}

function FileStrip({ files }: { files: FileRef[] }) {
  if (!files.length) return null;
  return (
    <div className="cg-files">
      {files.map((f, i) => (
        <div key={i} className="cg-file" title={f.name}>
          <AttachmentIcon size={12} />
          <span className="cg-file-name">{f.name}</span>
          {fileMeta(f) && <span className="cg-muted cg-file-meta">{fileMeta(f)}</span>}
        </div>
      ))}
    </div>
  );
}

/** Flatten generated artifacts in this preview, in order. */
function collectArtifacts(p: NodePreview): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  for (const k of p.kinds) {
    if (k.kind === 'artifact') out.push(...k.items);
  }
  return out;
}

/** Static rows listing the files Claude generated (full name + type). */
function ArtifactStrip({ artifacts }: { artifacts: ArtifactRef[] }) {
  if (!artifacts.length) return null;
  return (
    <div className="cg-artifacts">
      {artifacts.map((af, i) => (
        <div key={i} className="cg-artifact" title={af.name}>
          <FileIcon size={12} />
          <span className="cg-artifact-name">{af.name}</span>
          {af.type && <span className="cg-muted cg-artifact-type">{prettyType(af.type)}</span>}
        </div>
      ))}
    </div>
  );
}

/** A single uniform tile in the bottom thumbnail strip. */
type Thumb =
  | { t: 'img'; src: string; href: string; title?: string }
  | { t: 'svg'; w: WidgetRef }
  | { t: 'wicon'; w: WidgetRef } // non-SVG widget: hoverable icon tile
  | { t: 'imgicon' }; // image block with no thumbnail URL

/** Flatten every image + widget in this preview into one ordered tile list. */
function collectThumbs(p: NodePreview): Thumb[] {
  const out: Thumb[] = [];
  for (const k of p.kinds) {
    if (k.kind === 'image') {
      if (k.images.length) {
        for (const im of k.images) {
          out.push({ t: 'img', src: im.thumbUrl, href: im.fullUrl || im.thumbUrl, title: im.name });
        }
      } else {
        out.push({ t: 'imgicon' });
      }
    } else if (k.kind === 'widget') {
      for (const w of k.widgets) out.push(w.isSvg ? { t: 'svg', w } : { t: 'wicon', w });
    }
  }
  return out;
}

const MAX_THUMBS = 3;

function ThumbStrip({ thumbs, hover }: { thumbs: Thumb[]; hover: HoverApi }) {
  if (!thumbs.length) return null;
  const shown = thumbs.slice(0, MAX_THUMBS);
  const extra = thumbs.length - shown.length;
  return (
    <div className="cg-thumbstrip">
      {shown.map((th, i) => (
        <ThumbTile key={i} thumb={th} hover={hover} />
      ))}
      {extra > 0 && <span className="cg-muted cg-thumb-more">+{extra}</span>}
    </div>
  );
}

function ThumbTile({ thumb, hover }: { thumb: Thumb; hover: HoverApi }) {
  if (thumb.t === 'img') {
    return (
      <a
        className="cg-wthumb cg-wthumb-img"
        href={thumb.href}
        target="_blank"
        rel="noreferrer"
        title={thumb.title || 'image'}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={(e) =>
          hover.onPreview(
            { kind: 'image', src: thumb.href, title: thumb.title },
            (e.currentTarget as HTMLElement).getBoundingClientRect(),
          )
        }
        onMouseLeave={hover.onPreviewEnd}
      >
        <img src={thumb.src} alt={thumb.title || ''} loading="lazy" />
      </a>
    );
  }
  if (thumb.t === 'imgicon') {
    return (
      <div className="cg-wthumb cg-wthumb-icon" title="image">
        <ImageIcon size={22} />
      </div>
    );
  }
  // svg | wicon — both hoverable widgets
  const w = thumb.w;
  return (
    <div
      className={thumb.t === 'svg' ? 'cg-wthumb' : 'cg-wthumb cg-wthumb-label'}
      title={w.title || 'visualization'}
      onMouseEnter={(e) =>
        hover.onPreview({ kind: 'widget', widget: w }, (e.currentTarget as HTMLElement).getBoundingClientRect())
      }
      onMouseLeave={hover.onPreviewEnd}
    >
      {thumb.t === 'svg' ? (
        <img src={svgDataUri(w.code)} alt={w.title || ''} loading="lazy" />
      ) : w.title ? (
        <span>{w.title.replace(/_/g, ' ')}</span>
      ) : (
        <ImageIcon size={22} />
      )}
    </div>
  );
}

/** Max number of "heavy" rich previews (code/table/list/links) rendered. */
const MAX_RICH = 2;
const RICH_ORDER: ContentKind['kind'][] = ['code', 'table', 'list', 'links'];

function RichKinds({ preview }: { preview: NodePreview }) {
  if (!preview.kinds.length) return null;
  const ordered = [...preview.kinds].sort(
    (x, y) => RICH_ORDER.indexOf(x.kind) - RICH_ORDER.indexOf(y.kind),
  );
  let heavy = 0;
  const out: ReactNode[] = [];
  for (const k of ordered) {
    // Images/widgets/artifacts/attachments live in the bottom footer, not here.
    if (k.kind === 'image' || k.kind === 'widget' || k.kind === 'artifact' || k.kind === 'attachment') {
      continue;
    }
    if (heavy >= MAX_RICH) continue;
    heavy++;
    out.push(<KindBlock key={chipKey(k)} kind={k} />);
  }
  if (!out.length) return null;
  return <div className="cg-rich">{out}</div>;
}

function chipKey(k: ContentKind): string {
  switch (k.kind) {
    case 'code':
      return `code:${k.language ?? ''}`;
    case 'list':
      return `list:${k.itemCount}`;
    case 'table':
      return `table:${k.colCount}x${k.rowCount}`;
    case 'image':
      return `image:${k.count}`;
    case 'attachment':
      return `attachment:${k.count}`;
    case 'links':
      return `links:${k.count}`;
    case 'widget':
      return `widget:${k.count}`;
    case 'artifact':
      return `artifact:${k.count}`;
  }
}

function KindBlock({ kind }: { kind: ContentKind }) {
  switch (kind.kind) {
    case 'code':
      return (
        <div className="cg-code" title="Code">
          <div className="cg-code-head">
            <CodeIcon size={12} />
            <span>{kind.language ? prettyLang(kind.language) : 'Code'}</span>
            {kind.blockCount > 1 && <span className="cg-muted">· {kind.blockCount} blocks</span>}
          </div>
          {kind.snippet && <pre className="cg-code-body">{kind.snippet}</pre>}
        </div>
      );
    case 'table':
      return (
        <div className="cg-tablep" title={`Table ${kind.colCount}×${kind.rowCount}`}>
          <div className="cg-tablep-head">
            {kind.headers.slice(0, 4).map((h, i) => (
              <span className="cg-tablep-cell" key={i}>
                {h}
              </span>
            ))}
          </div>
          <div className="cg-muted">
            {kind.colCount} cols · {kind.rowCount} rows
          </div>
        </div>
      );
    case 'list':
      return (
        <ul className="cg-listp">
          {kind.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
          {kind.itemCount > kind.items.length && (
            <li className="cg-muted">+{kind.itemCount - kind.items.length} more</li>
          )}
        </ul>
      );
    case 'links':
      return (
        <div className="cg-links">
          {kind.items.map((l, i) => (
            <div className="cg-link" key={i}>
              <LinkIcon size={12} />
              <span className="cg-link-text">{l.text}</span>
              <span className="cg-muted cg-link-host">{hostOf(l.url)}</span>
            </div>
          ))}
          {kind.count > kind.items.length && (
            <div className="cg-muted">+{kind.count - kind.items.length} more</div>
          )}
        </div>
      );
    default:
      return null;
  }
}

/** "PDF · 1.2 MB" style metadata line for a file badge. */
function fileMeta(f: { type?: string; size?: number }): string {
  const parts: string[] = [];
  if (f.type) parts.push(prettyType(f.type));
  if (typeof f.size === 'number' && f.size > 0) parts.push(humanSize(f.size));
  return parts.join(' · ');
}

function prettyType(t: string): string {
  const ext = t.includes('/') ? t.split('/').pop()! : t;
  return ext.length <= 4 ? ext.toUpperCase() : ext.charAt(0).toUpperCase() + ext.slice(1);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/\s]+)/i);
  return m?.[1]?.replace(/^www\./, '') ?? '';
}

function prettyLang(lang: string): string {
  if (lang.length <= 4) return lang.toUpperCase();
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

/**
 * Renders snippet text, wrapping any tokens listed in `highlights` in <mark>
 * for sibling-diff emphasis. Case-insensitive, whole-word only.
 */
function renderText(text: string, highlights: string[]): ReactNode {
  if (!highlights.length) return text;
  const set = new Set(highlights.map((h) => h.toLowerCase()));
  const parts = text.split(/(\b[A-Za-z][A-Za-z0-9'-]*\b)/);
  return parts.map((part, i) =>
    set.has(part.toLowerCase()) ? (
      <mark className="cg-diff" key={i}>
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
