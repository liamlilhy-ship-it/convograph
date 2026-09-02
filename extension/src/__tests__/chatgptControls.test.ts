import { describe, it, expect } from 'vitest';
import { pickEdit, pickRegenTrigger, pickEditSend, isTryAgain, type BtnInfo } from '../platforms/chatgpt/controls';

// BtnInfo labels/text are pre-normalized (lower-cased, trimmed) by the DOM layer,
// so tests pass them already normalized.
const btn = (o: Partial<BtnInfo>): BtnInfo => ({
  testid: null,
  rtlFlip: false,
  haspopup: null,
  label: '',
  text: '',
  disabled: false,
  ...o,
});

// Toolbars modeled on the live DOM (verified en + zh). The pre-Sept-2026 shape,
// with the branch ‹ › arrows — still exercises the rtlFlip exclusion.
const userToolbar = (edit: string, copy = 'copy message', prev = 'previous response', next = 'next response'): BtnInfo[] => [
  btn({ testid: 'copy-turn-action-button', label: copy }),
  btn({ label: edit }),
  btn({ rtlFlip: true, label: prev }),
  btn({ rtlFlip: true, label: next }),
];

// The Sept 2026 shape (verified live): the arrows are gone and a forked message
// gets a "See versions" button (with a testid) BEFORE the pencil.
const userToolbar2026 = (edit: string, versions = 'see versions'): BtnInfo[] => [
  btn({ testid: 'variants-turn-action-button', label: versions }),
  btn({ testid: 'copy-turn-action-button', label: 'copy message' }),
  btn({ testid: 'share-prompt-link-turn-action-button', label: 'share prompt' }),
  btn({ label: edit }),
];

const answerToolbar = (sw: string, more = 'more actions'): BtnInfo[] => [
  btn({ testid: 'copy-turn-action-button', label: 'copy response' }),
  btn({ testid: 'good-response-turn-action-button', label: 'good response' }),
  btn({ testid: 'bad-response-turn-action-button', label: 'bad response' }),
  btn({ label: 'share' }),
  btn({ haspopup: 'menu', label: sw }),
  btn({ haspopup: 'menu', label: more }),
];

describe('pickEdit', () => {
  it('finds the pencil structurally (English) — no testid/rtl/haspopup', () => {
    expect(pickEdit(userToolbar('edit message'))).toBe(1);
  });
  it('finds it structurally on a Chinese UI (label is irrelevant to the rule)', () => {
    expect(pickEdit(userToolbar('编辑消息', '复制消息', '上一回复', '下一回复'))).toBe(1);
  });
  it('skips the "See versions" button on a forked message (Sept 2026 toolbar)', () => {
    expect(pickEdit(userToolbar2026('edit message'))).toBe(3);
    expect(pickEdit(userToolbar2026('编辑消息', '查看版本'))).toBe(3);
  });
  it('works with no branch arrows (single-branch message)', () => {
    expect(pickEdit([btn({ testid: 'copy-turn-action-button' }), btn({ label: '编辑消息' })])).toBe(1);
  });
  it('falls back to the label set if structure cannot pin it', () => {
    // hypothetical future where edit also gains a testid → structural rule yields -1
    const btns = [btn({ testid: 'copy-turn-action-button' }), btn({ testid: 'edit-x', label: '编辑消息' })];
    expect(pickEdit(btns)).toBe(1);
  });
});

describe('pickRegenTrigger', () => {
  it('picks Switch model by label (English)', () => {
    expect(pickRegenTrigger(answerToolbar('switch model'))).toBe(4);
  });
  it('picks it by label on a Chinese UI', () => {
    expect(pickRegenTrigger(answerToolbar('切换模型', '更多操作'))).toBe(4);
  });
  it('falls back to the first menu trigger when the language is unknown (overflow is last)', () => {
    expect(pickRegenTrigger(answerToolbar('xx', 'yy'))).toBe(4);
  });
  it('returns the only menu trigger when there is just one', () => {
    const btns = [btn({ testid: 'copy-turn-action-button' }), btn({ haspopup: 'menu', label: 'xx' })];
    expect(pickRegenTrigger(btns)).toBe(1);
  });
});

describe('pickEditSend', () => {
  it('picks Send by label (English)', () => {
    expect(pickEditSend([btn({ label: 'cancel' }), btn({ label: 'send' })])).toBe(1);
  });
  it('picks Send by label on a Chinese UI', () => {
    expect(pickEditSend([btn({ label: '取消' }), btn({ label: '发送' })])).toBe(1);
  });
  it('ignores the disabled Send until it enables', () => {
    expect(pickEditSend([btn({ label: 'cancel' }), btn({ label: 'send', disabled: true })])).toBe(-1);
  });
  it('falls back to the last enabled non-testid, non-Cancel button for unknown languages', () => {
    expect(pickEditSend([btn({ label: 'cancelx' }), btn({ label: 'sendx' })])).toBe(1);
  });
});

describe('isTryAgain', () => {
  it('matches English at the start of the item text', () => {
    expect(isTryAgain('', 'Try again with GPT-4o')).toBe(true);
  });
  it('matches the Chinese 重试 anywhere in the item', () => {
    expect(isTryAgain('', '用 GPT-4o 重试')).toBe(true);
    expect(isTryAgain('重试', '')).toBe(true);
  });
  it('does not match a model name', () => {
    expect(isTryAgain('', 'GPT-4o')).toBe(false);
  });
});
