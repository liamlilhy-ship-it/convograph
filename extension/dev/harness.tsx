/**
 * Standalone canvas harness: mounts the real GraphCanvas on a synthetic
 * conversation, with toolbar toggles that mimic the two panel-level actions
 * under test — full-screen (container resize) and layout direction — plus the
 * node's own expand button for in-place previews. Lets us observe viewport
 * behavior live without loading the extension into a browser.
 */
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import reactFlowCss from '@xyflow/react/dist/style.css?raw';
import panelCss from '../src/styles/panel.css?raw';
import tokensCss from '../src/platforms/claude/tokens.css?raw';
import { GraphCanvas } from '../src/panel/GraphCanvas';
import { buildTree } from '../src/tree/buildTree';
import { buildDisplayTree, type DisplayNode } from '../src/tree/displayTree';
import type { ApiConversation, ApiMessage } from '../src/platforms/model';
import type { LayoutDirection } from '../src/tree/layout';

// The shadow-root token sheet targets :host — retarget to :root for a plain page.
const style = document.createElement('style');
style.textContent = [reactFlowCss, tokensCss.replaceAll(':host', ':root'), panelCss].join('\n');
document.head.appendChild(style);

const LONG =
  'This is a reasonably long answer paragraph so the card preview has realistic text to clamp. ' +
  'It explains the topic across a few sentences, mentions trade-offs, and closes with a recommendation ' +
  'so the expanded reader has something to scroll.';

const msgs: ApiMessage[] = [];
for (let i = 0; i < 6; i++) {
  msgs.push({
    uuid: `u${i}`,
    parent_message_uuid: i ? `a${i - 1}` : null,
    sender: 'human',
    created_at: new Date(1700000000000 + i * 120000).toISOString(),
    content: [{ type: 'text', text: `Question ${i}: how does part ${i} of the system work in detail?` }],
  });
  msgs.push({
    uuid: `a${i}`,
    parent_message_uuid: `u${i}`,
    sender: 'assistant',
    created_at: new Date(1700000000000 + i * 120000 + 60000).toISOString(),
    content: [{ type: 'text', text: `Answer ${i}: ${LONG} ${LONG}` }],
  });
}
const CONV: ApiConversation = {
  uuid: 'harness',
  name: 'Harness',
  current_leaf_message_uuid: 'a5',
  chat_messages: msgs,
};

function Harness() {
  const tree = useMemo(() => buildDisplayTree(buildTree(CONV)), []);
  const [direction, setDirection] = useState<LayoutDirection>('TB');
  const [full, setFull] = useState(false);
  const [previewIds, setPreviewIds] = useState<Set<string>>(new Set());
  const togglePreview = (n: DisplayNode) =>
    setPreviewIds((prev) => {
      const s = new Set(prev);
      if (s.has(n.id)) s.delete(n.id);
      else s.add(n.id);
      return s;
    });
  const noop = () => {};
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#e8e6df', display: 'flex' }}>
      <div style={{ flex: 1, padding: 12, fontSize: 13 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button id="dir-toggle" onClick={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}>
            direction: {direction}
          </button>
          <button id="fs-toggle" onClick={() => setFull((f) => !f)}>
            fullscreen: {String(full)}
          </button>
        </div>
        <p>Fake page content (hidden when "fullscreen").</p>
      </div>
      <div
        id="panel"
        style={{
          width: full ? '100%' : 520,
          position: full ? 'fixed' : 'relative',
          inset: full ? 0 : undefined,
          display: 'flex',
          flexDirection: 'column',
          background: '#faf9f5',
          borderLeft: '1px solid #ccc',
          zIndex: full ? 10 : undefined,
        }}
      >
        <div style={{ padding: 4, fontSize: 11, borderBottom: '1px solid #ddd' }}>
          panel {full ? '(fullscreen)' : '(side)'}
        </div>
        <GraphCanvas
          tree={tree}
          direction={direction}
          onNodeClick={noop}
          onOpenPreview={togglePreview}
          onOpenMedia={noop}
          previewIds={previewIds}
          onToggleInlinePreview={togglePreview}
          draft={null}
          locked={false}
          onStartEdit={noop}
          onStartFollowup={noop}
          onRegenerate={noop}
          onCancelDraft={noop}
          onSubmitDraft={noop}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
