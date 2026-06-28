/**
 * Locale-independent locators for ChatGPT's turn controls.
 *
 * ChatGPT localizes every `aria-label` and button label (zh: 编辑消息 / 切换模型 / 发送 /
 * 重试), so matching English strings — as this code used to — fails for non-English
 * users (the "Couldn't find ChatGPT's edit control" report came from a Chinese UI).
 * We match on LANGUAGE-INDEPENDENT signals instead, verified live across en/zh:
 *   - `data-testid`            — copy/like/dislike (stable, semantic hooks)
 *   - `svg[data-rtl-flip]`     — only the branch ‹ › arrows carry this
 *   - `aria-haspopup="menu"`   — only the menu triggers (Switch model, More actions)
 * The sprite-icon `#fragment` is language-independent too, but its ids are opaque
 * hashes that change on deploy, so we deliberately don't key on them.
 *
 * Only where structure can't disambiguate (Switch model vs the More-actions overflow,
 * the Try-again menu item, the edit Send button) do we fall back to a small
 * multilingual label set — easy to extend, English + Chinese verified.
 *
 * The element-facing helpers are thin; the picking logic is pure (operates on
 * `BtnInfo` descriptors) and unit-tested in controls.test.ts.
 */

/** A button reduced to the signals the locator reasons about. */
export type BtnInfo = {
  testid: string | null;
  /** A branch ‹/› arrow — its icon `<svg>` carries `data-rtl-flip`. */
  rtlFlip: boolean;
  /** `aria-haspopup` value (e.g. "menu" for the Switch-model / More-actions triggers). */
  haspopup: string | null;
  /** Normalized (trimmed, lower-cased) aria-label. */
  label: string;
  /** Normalized (trimmed, lower-cased) text content. */
  text: string;
  disabled: boolean;
};

// Verified labels (en + zh simplified/traditional). Extend per language as needed;
// the structural rules above already cover most controls without any label.
const LABELS = {
  edit: ['edit message', '编辑消息', '編輯訊息'],
  switchModel: ['switch model', '切换模型', '切換模型'],
  send: ['send', '发送', '發送', '傳送'],
  cancel: ['cancel', '取消'],
};

const matchesLabel = (b: BtnInfo, set: readonly string[]): boolean =>
  set.includes(b.label) || set.includes(b.text);

// ---- pure picking core (unit-tested) --------------------------------------

/**
 * Index of the "Edit message" pencil in a user turn's toolbar, or -1. Generic: the
 * one action button that is NOT the copy button (testid), NOT a branch arrow
 * (rtl-flip), and NOT a menu trigger (haspopup). Falls back to the label set.
 */
export function pickEdit(btns: BtnInfo[]): number {
  const structural = btns.findIndex((b) => !b.testid && !b.rtlFlip && !b.haspopup);
  if (structural >= 0) return structural;
  return btns.findIndex((b) => matchesLabel(b, LABELS.edit));
}

/**
 * Index of the regenerate trigger ("Switch model" dropdown) in an answer turn, or -1.
 * Generic: among the menu triggers (`aria-haspopup="menu"`), prefer the known label;
 * else the first trigger — the "More actions" overflow is rendered last.
 */
export function pickRegenTrigger(btns: BtnInfo[]): number {
  const triggers = btns.map((b, i) => ({ b, i })).filter((x) => x.b.haspopup === 'menu');
  if (!triggers.length) return btns.findIndex((b) => matchesLabel(b, LABELS.switchModel));
  const byLabel = triggers.find((x) => matchesLabel(x.b, LABELS.switchModel));
  return (byLabel ?? triggers[0]!).i;
}

/**
 * Index of the Send button in the inline edit editor, or -1. Generic: the known label;
 * else the last enabled plain button (no testid) that isn't Cancel.
 */
export function pickEditSend(btns: BtnInfo[]): number {
  const enabled = btns.map((b, i) => ({ b, i })).filter((x) => !x.b.disabled);
  const byLabel = enabled.find((x) => matchesLabel(x.b, LABELS.send));
  if (byLabel) return byLabel.i;
  const candidates = enabled.filter((x) => !x.b.testid && !matchesLabel(x.b, LABELS.cancel));
  return candidates.length ? candidates[candidates.length - 1]!.i : -1;
}

/** Whether a menu item is the "Try again" / 重试 regenerate option. */
export function isTryAgain(label: string, text: string): boolean {
  const n = (s: string) => s.trim().toLowerCase();
  const L = n(label);
  const T = n(text);
  if (/^try again\b/.test(L) || /^try again\b/.test(T)) return true;
  return ['重试', '重試'].some((k) => L.includes(k) || T.includes(k));
}

// ---- element-facing helpers (thin DOM glue) -------------------------------

const norm = (s: string | null | undefined): string => (s || '').trim().toLowerCase();

function infoOf(b: HTMLButtonElement): BtnInfo {
  return {
    testid: b.getAttribute('data-testid'),
    rtlFlip: !!b.querySelector('svg[data-rtl-flip]'),
    haspopup: b.getAttribute('aria-haspopup'),
    label: norm(b.getAttribute('aria-label')),
    text: norm(b.textContent),
    disabled: b.disabled,
  };
}

/** Some turn-toolbar buttons mount only on pointer-over — nudge them in. */
function hover(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
}

function buttonsIn(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
}

export function findEditButton(turn: HTMLElement): HTMLButtonElement | null {
  hover(turn);
  const btns = buttonsIn(turn);
  const i = pickEdit(btns.map(infoOf));
  return i >= 0 ? btns[i]! : null;
}

export function findRegenTrigger(answerTurn: HTMLElement): HTMLButtonElement | null {
  hover(answerTurn);
  const btns = buttonsIn(answerTurn);
  const i = pickRegenTrigger(btns.map(infoOf));
  return i >= 0 ? btns[i]! : null;
}

export function findEditSendButton(editor: HTMLElement): HTMLButtonElement | null {
  const btns = buttonsIn(editor);
  const i = pickEditSend(btns.map(infoOf));
  return i >= 0 ? btns[i]! : null;
}

/** The "Try again" item inside the open Switch-model popover. */
export function findTryAgainItem(): HTMLElement | null {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"],[role="option"],button,a'),
  );
  return items.find((e) => isTryAgain(e.getAttribute('aria-label') || '', e.textContent || '')) ?? null;
}

/** A branch ‹/› arrow — identified by the `data-rtl-flip` marker on its icon. */
export function isBranchArrow(b: Element): boolean {
  return !!b.querySelector('svg[data-rtl-flip]');
}

/** Branch arrows within `container`, in DOM order — [prev, next]. */
export function navArrowsIn(container: HTMLElement): HTMLButtonElement[] {
  return buttonsIn(container).filter(isBranchArrow);
}
