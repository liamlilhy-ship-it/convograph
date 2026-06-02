import { useMemo } from 'react';
import type { DisplayNode } from '../tree/displayTree';
import type { ContentKind, ImageRef, WidgetRef, ArtifactRef, FileRef } from '../tree/contentKinds';
import type { NodePreview } from '../tree/preview';
import { renderMarkdown } from './markdown';
import { svgDataUri, widgetSrcDoc } from './widgetRender';
import { UserIcon, ClaudeIcon, FileIcon, AttachmentIcon, ImageIcon } from './icons';

/** Typed lookup for the (at most one) kind of a given tag in a preview. */
function kindOf<K extends ContentKind['kind']>(
  p: NodePreview,
  kind: K,
): Extract<ContentKind, { kind: K }> | undefined {
  return p.kinds.find((k) => k.kind === kind) as Extract<ContentKind, { kind: K }> | undefined;
}

/**
 * Full, scrollable rendering of a single node's content — the complete message
 * markdown plus every image, widget (MCP rendering), and a list of generated
 * artifacts. Sourced entirely from data already on the DisplayNode, so it works
 * for any node regardless of whether it's on the active branch. All text is real,
 * selectable DOM (copy-pasteable).
 */
export function FullPreview({ node }: { node: DisplayNode }) {
  const isHuman = node.role === 'human';
  const p = node.preview;

  const html = useMemo(() => (node.fullText ? renderMarkdown(node.fullText) : ''), [node.fullText]);

  const images: ImageRef[] = kindOf(p, 'image')?.images ?? [];
  const widgets: WidgetRef[] = kindOf(p, 'widget')?.widgets ?? [];
  const artifacts: ArtifactRef[] = kindOf(p, 'artifact')?.items ?? [];
  const files: FileRef[] = kindOf(p, 'attachment')?.files ?? [];

  const empty =
    !html && !images.length && !widgets.length && !artifacts.length && !files.length;

  return (
    <div className="cg-pv-content">
      <div className="cg-pv-role">
        {isHuman ? <UserIcon size={12} /> : <ClaudeIcon size={12} />}
        {isHuman ? 'You' : 'Claude'}
      </div>

      {/* On an answer, show its originating question for context. */}
      {!isHuman && node.questionText && (
        <div className="cg-pv-qcontext">
          <span className="cg-pv-qlabel">Question</span>
          <div className="cg-pv-qtext">{node.questionText}</div>
        </div>
      )}

      {html && (
        <div className="cg-pv-md" dangerouslySetInnerHTML={{ __html: html }} />
      )}

      {images.length > 0 && (
        <div className="cg-pv-images">
          {images.map((im, i) => {
            const src = im.fullUrl || im.thumbUrl;
            return (
              <a
                key={i}
                className="cg-pv-image"
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                title={im.name || 'image'}
              >
                <img src={src} alt={im.name || ''} loading="lazy" />
              </a>
            );
          })}
        </div>
      )}

      {widgets.length > 0 && (
        <div className="cg-pv-widgets">
          {widgets.map((w, i) =>
            w.isSvg ? (
              <img
                key={i}
                className="cg-pv-widget-img"
                src={svgDataUri(w.code)}
                alt={w.title || 'visualization'}
                loading="lazy"
              />
            ) : (
              <iframe
                key={i}
                className="cg-pv-widget-frame"
                sandbox="allow-scripts"
                srcDoc={widgetSrcDoc(w.code)}
                title={w.title || 'visualization'}
              />
            ),
          )}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="cg-pv-section">
          <div className="cg-pv-section-label">Generated files</div>
          <div className="cg-artifacts">
            {artifacts.map((af, i) => (
              <div key={i} className="cg-artifact" title={af.name}>
                <FileIcon size={12} />
                <span className="cg-artifact-name">{af.name}</span>
                {af.type && <span className="cg-muted cg-artifact-type">{af.type.toUpperCase()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="cg-pv-section">
          <div className="cg-pv-section-label">Attachments</div>
          <div className="cg-files">
            {files.map((f, i) => (
              <div key={i} className="cg-file" title={f.name}>
                <AttachmentIcon size={12} />
                <span className="cg-file-name">{f.name}</span>
                {f.type && <span className="cg-muted cg-file-meta">{f.type.toUpperCase()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {empty && (
        <div className="cg-pv-empty">
          <ImageIcon size={20} />
          <span>No renderable content for this message.</span>
        </div>
      )}
    </div>
  );
}
