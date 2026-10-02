/**
 * ChatGPT thread lookups, in one place — chatgpt.com renames these hooks on
 * redesigns (last: the Sept 2026 shell, which dropped `data-message-id`,
 * `data-message-author-role` and `data-testid="conversation-turn-N"`).
 * Verified live 2026-10-02:
 *
 *   - The thread scroller is `.thread-scroll-container`. It is
 *     `flex-direction: column-reverse`, so scrollTop runs from a negative minimum
 *     up to 0 (= bottom): only RELATIVE `scrollTop +=` adjustments work on it.
 *   - A turn (question + its answer) is `[data-turn-key="<id>"]`, keyed by the
 *     USER message id — a node's `humanId`.
 *   - Every message wrapper, user and assistant, carries
 *     `data-chatgpt-search-message-ids="<id>"` (the assistant value repeats its
 *     id, space-separated).
 *   - The user bubble is `[data-user-message-bubble="true"]`.
 *
 * A sidebar chat switch leaves the previous chats mounted but hidden, each with
 * its own scroller and turns, in no fixed order relative to the live one — so
 * every lookup is scoped to the RENDERED thread.
 */

/** The rendered thread scroller; null before the thread mounts. */
export function liveThread(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('.thread-scroll-container')).find((el) =>
      el.checkVisibility(),
    ) ?? null
  );
}

/** All rendered user bubbles, top→bottom. */
export function userBubbles(): HTMLElement[] {
  return Array.from(
    liveThread()?.querySelectorAll<HTMLElement>('[data-user-message-bubble="true"]') ?? [],
  );
}

/** The rendered turn whose question is the user message `id`. */
export function turnEl(id: string): HTMLElement | null {
  return liveThread()?.querySelector<HTMLElement>(`[data-turn-key="${CSS.escape(id)}"]`) ?? null;
}

/** Every message id currently rendered, in document order (may repeat). */
export function renderedMessageIds(): string[] {
  const els =
    liveThread()?.querySelectorAll<HTMLElement>('[data-turn-key], [data-chatgpt-search-message-ids]') ?? [];
  return Array.from(els).flatMap((el) =>
    [
      el.getAttribute('data-turn-key'),
      ...(el.getAttribute('data-chatgpt-search-message-ids')?.split(/\s+/) ?? []),
    ].filter((id): id is string => !!id),
  );
}
