import type { CSSProperties, ReactNode } from 'react';
import type { DisplayNode } from '../tree/displayTree';
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
} from './icons';
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

/** Whether a preview carries media (drives the footer + the height tier). */
export function hasMedia(p: NodePreview): boolean {
  return p.kinds.some(
    (k) => k.kind === 'image' || k.kind === 'widget' || k.kind === 'attachment' || k.kind === 'artifact',
  );
}

export function NodeCard({ node, jumping, onPreview, onPreviewEnd, onClick, style }: NodeCardProps) {
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

  return (
    <div
      className="cg-node"
      data-role={node.role}
      data-active={node.isOnActivePath ? 'true' : 'false'}
      data-jumping={jumping ? 'true' : 'false'}
      style={style}
      onClick={() => onClick(node)}
    >
      <div className="cg-head">
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
      </div>
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
