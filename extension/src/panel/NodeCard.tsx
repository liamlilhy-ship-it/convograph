import type { CSSProperties, ReactNode } from 'react';
import type { DisplayNode } from '../tree/displayTree';
import type { ContentKind, WidgetRef, ArtifactRef } from '../tree/contentKinds';
import type { NodePreview } from '../tree/preview';
import { CodeIcon, ImageIcon, AttachmentIcon, LinkIcon, FileIcon } from './icons';
import { svgDataUri, type PreviewItem } from './HoverPreview';

type HoverApi = {
  onPreview: (item: PreviewItem, rect: DOMRect) => void;
  onPreviewEnd: () => void;
};

export type NodeCardProps = HoverApi & {
  node: DisplayNode;
  jumping?: boolean;
  onClick: (node: DisplayNode) => void;
  style?: CSSProperties;
};

export function NodeCard({ node, jumping, onPreview, onPreviewEnd, onClick, style }: NodeCardProps) {
  const pending = node.assistantId == null;
  const a = node.assistantPreview;
  const aText = a.body || a.title;
  const hover: HoverApi = { onPreview, onPreviewEnd };
  return (
    <div
      className="cg-node"
      data-active={node.isOnActivePath ? 'true' : 'false'}
      data-pending={pending ? 'true' : 'false'}
      data-jumping={jumping ? 'true' : 'false'}
      style={style}
      onClick={() => onClick(node)}
    >
      <div className="cg-half cg-half-q">
        <div className="cg-row">
          <span className="cg-tag cg-tag-q">You</span>
          {node.siblingCount > 1 && (
            <span
              className="cg-pip"
              title={node.shareQWithSiblings ? 'Regenerated answer variants' : 'Edited question branches'}
            >
              {node.siblingIndex + 1}/{node.siblingCount}
            </span>
          )}
        </div>
        <div className="cg-snippet cg-title" data-shared={node.shareQWithSiblings ? 'true' : 'false'}>
          {node.humanPreview.title || <em style={{ opacity: 0.55 }}>(empty)</em>}
        </div>
        <RichKinds preview={node.humanPreview} />
      </div>
      <div className="cg-divider" />
      <div className="cg-half cg-half-a">
        <div className="cg-row">
          <span className="cg-tag cg-tag-a">Claude</span>
        </div>
        <div className="cg-snippet cg-body">
          {pending ? (
            <em style={{ opacity: 0.55 }}>awaiting response…</em>
          ) : aText ? (
            renderText(aText, a.highlights)
          ) : (
            <em style={{ opacity: 0.55 }}>(empty)</em>
          )}
        </div>
        <RichKinds preview={a} />
      </div>
      <Footer
        artifacts={collectArtifacts(a)}
        thumbs={collectThumbs(node.humanPreview, a)}
        hover={hover}
      />
    </div>
  );
}

/** Bottom footer: generated-artifact rows stacked above the thumbnail strip.
 *  `margin-top:auto` (in CSS) pins the whole block to the card's bottom edge. */
function Footer({
  artifacts,
  thumbs,
  hover,
}: {
  artifacts: ArtifactRef[];
  thumbs: Thumb[];
  hover: HoverApi;
}) {
  if (!artifacts.length && !thumbs.length) return null;
  return (
    <div className="cg-foot">
      <ArtifactStrip artifacts={artifacts} />
      <ThumbStrip thumbs={thumbs} hover={hover} />
    </div>
  );
}

/** Flatten generated artifacts across previews, in order. */
function collectArtifacts(...previews: NodePreview[]): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  for (const p of previews) {
    for (const k of p.kinds) {
      if (k.kind === 'artifact') out.push(...k.items);
    }
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
  | { t: 'wicon'; w: WidgetRef }   // non-SVG widget: hoverable icon tile
  | { t: 'imgicon' };              // image block with no thumbnail URL

/** Flatten every image + widget across both halves into one ordered tile list. */
function collectThumbs(...previews: NodePreview[]): Thumb[] {
  const out: Thumb[] = [];
  for (const p of previews) {
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

/** Max number of "heavy" rich previews (code/table/list/links) rendered per half. */
const MAX_RICH = 2;
const RICH_ORDER: ContentKind['kind'][] = ['widget', 'image', 'code', 'table', 'list', 'links', 'attachment'];

function RichKinds({ preview }: { preview: NodePreview }) {
  if (!preview.kinds.length) return null;
  const ordered = [...preview.kinds].sort(
    (x, y) => RICH_ORDER.indexOf(x.kind) - RICH_ORDER.indexOf(y.kind),
  );
  let heavy = 0;
  const out: ReactNode[] = [];
  for (const k of ordered) {
    // Images/widgets render in the thumbnail strip; artifacts in their own
    // strip — both live in the bottom footer, not here.
    if (k.kind === 'image' || k.kind === 'widget' || k.kind === 'artifact') continue;
    const isHeavy = k.kind === 'code' || k.kind === 'table' || k.kind === 'list' || k.kind === 'links';
    if (isHeavy) {
      if (heavy >= MAX_RICH) continue;
      heavy++;
    }
    out.push(<KindBlock key={chipKey(k)} kind={k} />);
  }
  if (!out.length) return null;
  return <div className="cg-rich">{out}</div>;
}

function chipKey(k: ContentKind): string {
  switch (k.kind) {
    case 'code': return `code:${k.language ?? ''}`;
    case 'list': return `list:${k.itemCount}`;
    case 'table': return `table:${k.colCount}x${k.rowCount}`;
    case 'image': return `image:${k.count}`;
    case 'attachment': return `attachment:${k.count}`;
    case 'links': return `links:${k.count}`;
    case 'widget': return `widget:${k.count}`;
    case 'artifact': return `artifact:${k.count}`;
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
              <span className="cg-tablep-cell" key={i}>{h}</span>
            ))}
          </div>
          <div className="cg-muted">{kind.colCount} cols · {kind.rowCount} rows</div>
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
    case 'attachment':
      if (kind.files.length === 0) {
        return (
          <div className="cg-badge" title="Contains an attachment">
            <AttachmentIcon size={12} />
            <span>Attachment</span>
          </div>
        );
      }
      return (
        <div className="cg-files">
          {kind.files.slice(0, 3).map((f, i) => {
            const inner = (
              <>
                <AttachmentIcon size={12} />
                <span className="cg-file-name">{f.name}</span>
                {fileMeta(f) && <span className="cg-muted cg-file-meta">{fileMeta(f)}</span>}
              </>
            );
            return (
              <div key={i} className="cg-file" title={f.name}>
                {inner}
              </div>
            );
          })}
          {kind.count > kind.files.length && (
            <span className="cg-muted">+{kind.count - kind.files.length} more</span>
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
      <mark className="cg-diff" key={i}>{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
