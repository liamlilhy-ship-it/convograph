import type { DisplayNode } from '../tree/displayTree';

/**
 * Per-node tags, scoped per conversation. A tag is an entity ({id, name, color})
 * referenced by id from a node's assignment list, so renaming a tag propagates
 * everywhere and the same tag is never duplicated on one node.
 *
 * `color` is a PALETTE INDEX (not a hex string): the actual color is resolved at
 * render time from a CSS variable (`--cg-tag-<i>`), so light/dark theming and any
 * future palette tweak apply automatically. See tagColorVar / tokens.css.
 *
 * Pure module — no I/O, no DOM. Persistence lives in tagStore.ts; this is the
 * unit-tested core. Every reducer returns a NEW TagState (immutable).
 */

export type TagId = string;
export type Tag = { id: TagId; name: string; color: number };

/** Per-conversation tag state. `assignments` is keyed by a node's stable MESSAGE
 *  uuid (humanId for a question node, assistantId for an answer node — see
 *  nodeMsgId), NOT the synthetic DisplayNode.id. */
export type TagState = {
  tags: Record<TagId, Tag>;
  assignments: Record<string, TagId[]>; // nodeMsgId -> tagIds (insertion order)
};

export const EMPTY_TAG_STATE: TagState = { tags: {}, assignments: {} };

/** Number of palette slots; must match the `--cg-tag-0..N` vars in tokens.css. */
export const PALETTE_SIZE = 10;

const norm = (s: string): string => s.trim().toLowerCase();

/** The stable per-node key for tagging: the node's own server message uuid.
 *  Null only for a pending assistant turn (no answer message yet) — such a node
 *  isn't taggable; its question node still is (via humanId). */
export function nodeMsgId(node: DisplayNode): string | null {
  return node.role === 'human' ? node.humanId : node.assistantId;
}

/** CSS custom-property name for a palette slot, e.g. "--cg-tag-3". */
export function tagColorVar(color: number): string {
  return `--cg-tag-${((color % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE}`;
}

/** Next palette index for a new tag: the least-used slot (tie-break lowest index),
 *  so a small tag set gets distinct colors before any repeats. */
export function nextColorIndex(state: TagState): number {
  const counts = new Array<number>(PALETTE_SIZE).fill(0);
  for (const t of Object.values(state.tags)) {
    const i = ((t.color % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
    counts[i]++;
  }
  let best = 0;
  for (let i = 1; i < PALETTE_SIZE; i++) if (counts[i]! < counts[best]!) best = i;
  return best;
}

/** Find a tag by trimmed, case-insensitive name (the dedupe key). */
export function findTagByName(state: TagState, name: string): Tag | undefined {
  const n = norm(name);
  return Object.values(state.tags).find((t) => norm(t.name) === n);
}

/** Create a tag, or return the existing one if its trimmed name already exists
 *  (case-insensitive) — enforces "no duplicate-named tags". Callers pass a
 *  non-empty trimmed name (the picker guards). */
export function createTag(state: TagState, name: string): [TagState, Tag] {
  const trimmed = name.trim();
  const existing = findTagByName(state, trimmed);
  if (existing) return [state, existing];
  const tag: Tag = { id: crypto.randomUUID(), name: trimmed, color: nextColorIndex(state) };
  return [{ ...state, tags: { ...state.tags, [tag.id]: tag } }, tag];
}

/** Assign a tag to a node; no-op if already present (no duplicate tag per node). */
export function assignTag(state: TagState, msgId: string, tagId: TagId): TagState {
  const cur = state.assignments[msgId] ?? [];
  if (cur.includes(tagId)) return state;
  return { ...state, assignments: { ...state.assignments, [msgId]: [...cur, tagId] } };
}

/** Remove a tag from a node; prunes the key when its last tag is removed. */
export function unassignTag(state: TagState, msgId: string, tagId: TagId): TagState {
  const cur = state.assignments[msgId];
  if (!cur || !cur.includes(tagId)) return state;
  const next = cur.filter((id) => id !== tagId);
  const assignments = { ...state.assignments };
  if (next.length) assignments[msgId] = next;
  else delete assignments[msgId];
  return { ...state, assignments };
}

/** Rename a tag in place (id-stable, so every node/chip/legend reflects it).
 *  Rejected (state unchanged) on an empty name or a collision with ANOTHER tag. */
export function renameTag(state: TagState, tagId: TagId, name: string): TagState {
  const tag = state.tags[tagId];
  if (!tag) return state;
  const trimmed = name.trim();
  if (!trimmed) return state;
  const clash = findTagByName(state, trimmed);
  if (clash && clash.id !== tagId) return state;
  return { ...state, tags: { ...state.tags, [tagId]: { ...tag, name: trimmed } } };
}

/** Delete a tag and cascade-remove it from every node's assignment list. */
export function deleteTag(state: TagState, tagId: TagId): TagState {
  if (!state.tags[tagId]) return state;
  const tags = { ...state.tags };
  delete tags[tagId];
  const assignments: Record<string, TagId[]> = {};
  for (const [msgId, ids] of Object.entries(state.assignments)) {
    const next = ids.filter((id) => id !== tagId);
    if (next.length) assignments[msgId] = next;
  }
  return { tags, assignments };
}

/** All tags in the chat, ordered by name (stable) — for the legend + picker. */
export function listTags(state: TagState): Tag[] {
  return Object.values(state.tags).sort((a, b) => a.name.localeCompare(b.name));
}

/** Tags currently on a node, resolved from ids in assignment order. */
export function tagsForNode(state: TagState, msgId: string): Tag[] {
  const ids = state.assignments[msgId] ?? [];
  return ids.map((id) => state.tags[id]).filter((t): t is Tag => t != null);
}
