import dagre from 'dagre';

export type Layoutable = {
  id: string;
  parentId: string | null;
  /** Optional per-node size; falls back to the nodeWidth/nodeHeight options. */
  width?: number;
  height?: number;
};
export type LayoutDirection = 'TB' | 'LR';

export type LayoutOptions = {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
};

export function layoutTree<T extends Layoutable>(
  nodes: T[],
  opts: LayoutOptions = {},
): {
  nodes: Array<T & { x: number; y: number }>;
  edges: Array<{ id: string; source: string; target: string }>;
} {
  const {
    direction = 'TB',
    nodeWidth = 300,
    nodeHeight = 300,
    rankSep = 48,
    nodeSep = 32,
  } = opts;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: n.width ?? nodeWidth, height: n.height ?? nodeHeight });
  }
  const edges: Array<{ id: string; source: string; target: string }> = [];
  for (const n of nodes) {
    if (n.parentId) {
      g.setEdge(n.parentId, n.id);
      edges.push({ id: `${n.parentId}->${n.id}`, source: n.parentId, target: n.id });
    }
  }

  dagre.layout(g);

  const laid = nodes.map((n) => {
    const pos = g.node(n.id);
    const w = n.width ?? nodeWidth;
    const h = n.height ?? nodeHeight;
    return { ...n, x: pos.x - w / 2, y: pos.y - h / 2 };
  });

  return { nodes: laid, edges };
}
