import dagre from 'dagre';
import type { TreeNode } from './buildTree';

export type LaidOutNode = TreeNode & { x: number; y: number };

export type LayoutDirection = 'TB' | 'LR';

export type LayoutOptions = {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
};

export function layoutTree(
  nodes: TreeNode[],
  opts: LayoutOptions = {},
): { nodes: LaidOutNode[]; edges: Array<{ id: string; source: string; target: string }> } {
  const {
    direction = 'TB',
    nodeWidth = 260,
    nodeHeight = 130,
    rankSep = 70,
    nodeSep = 40,
  } = opts;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: nodeWidth, height: nodeHeight });
  }
  const edges: Array<{ id: string; source: string; target: string }> = [];
  for (const n of nodes) {
    if (n.parentId) {
      g.setEdge(n.parentId, n.id);
      edges.push({ id: `${n.parentId}->${n.id}`, source: n.parentId, target: n.id });
    }
  }

  dagre.layout(g);

  const laid: LaidOutNode[] = nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 };
  });

  return { nodes: laid, edges };
}
