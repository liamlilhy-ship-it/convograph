/**
 * Turns a claude.ai model id into a human-readable name for display.
 *
 * claude.ai exposes only the conversation-level model id (e.g. "claude-opus-4-8");
 * there is no canonical display string in the API, so we derive one: drop the
 * `claude-` prefix and any trailing 8-digit date stamp, title-case the family
 * token(s), join the numeric tokens with a dot, and re-prefix "Claude".
 *
 *   "claude-opus-4-8"            -> "Claude Opus 4.8"
 *   "claude-sonnet-4-5-20250929" -> "Claude Sonnet 4.5"
 *   "claude-3-5-sonnet-20241022" -> "Claude Sonnet 3.5"
 *
 * The exact id is kept (e.g. in a tooltip) so nothing is lost to this heuristic.
 * Falls back to the raw id when there's nothing to format, and '' for blank input.
 */
export function formatModelName(id?: string | null): string {
  if (!id || !id.trim()) return '';
  const raw = id.trim();
  const hadClaude = /^claude-/i.test(raw);
  const tokens = raw.replace(/^claude-/i, '').split(/[-_]/).filter(Boolean);
  const names: string[] = [];
  const nums: string[] = [];
  for (const t of tokens) {
    if (/^\d{8}$/.test(t)) continue; // date stamp, e.g. 20250929
    if (/^\d+$/.test(t)) nums.push(t);
    else names.push(t.charAt(0).toUpperCase() + t.slice(1));
  }
  const parts = [...names];
  if (nums.length) parts.push(nums.join('.'));
  const label = parts.join(' ');
  if (!label) return raw;
  return hadClaude ? `Claude ${label}` : label;
}
