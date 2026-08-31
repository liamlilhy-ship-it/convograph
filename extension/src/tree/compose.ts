import type { ApiContentBlock } from '../platforms/model';

/**
 * Composed-message drafts (emails etc.) both platforms generate outside the
 * plain message text, normalized to one shape:
 *  - claude.ai emits a `message_compose_v1` tool_use whose input carries
 *    `{ kind: "email", summary_title, variants: [{ label, subject, body }] }`
 *    (the A/B tabs of the native compose card are the variants).
 *  - chatgpt.com embeds a `:::writing{variant="email" subject="…"} … :::`
 *    directive fence inline in the text; its adapter rewrites that fence into a
 *    synthetic tool_use of the SAME name, so the whole tree layer (text, body
 *    blocks, kinds, search) handles both platforms through this module alone.
 */
export const COMPOSE_TOOL = 'message_compose_v1';

export type ComposeVariant = { label?: string; subject?: string; body: string };

export function isComposeBlock(c: ApiContentBlock): boolean {
  return c.type === 'tool_use' && c.name === COMPOSE_TOOL;
}

/** The draft variants of a compose block (empty for a malformed block). */
export function composeVariantsOf(c: ApiContentBlock): ComposeVariant[] {
  const raw = c.input?.variants;
  if (!Array.isArray(raw)) return [];
  const out: ComposeVariant[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const body = typeof (v as ComposeVariant).body === 'string' ? (v as ComposeVariant).body : '';
    if (!body.trim()) continue;
    const label = typeof (v as ComposeVariant).label === 'string' ? (v as ComposeVariant).label : undefined;
    const subject = typeof (v as ComposeVariant).subject === 'string' ? (v as ComposeVariant).subject : undefined;
    out.push({ label, subject, body });
  }
  return out;
}

/** Display label for a compose kind ("email" → "Email"; anything else Title-cased). */
export function composeKindLabel(kind?: string): string {
  if (!kind) return 'Message';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Renders a compose block as plain markdown — a bolded heading per variant
 * (with its A/B label when present), a Subject line, then the body verbatim —
 * so previews, the expanded reader, and search all see the draft as ordinary
 * message text.
 */
export function composeMarkdownOf(c: ApiContentBlock): string {
  const variants = composeVariantsOf(c);
  if (!variants.length) return '';
  const label = composeKindLabel(typeof c.input?.kind === 'string' ? c.input.kind : undefined);
  return variants
    .map((v) => {
      const parts = [`**${label}${v.label ? ` — ${v.label}` : ''}**`];
      if (v.subject) parts.push(`Subject: ${v.subject}`);
      parts.push(v.body.trim());
      return parts.join('\n\n');
    })
    .join('\n\n');
}
