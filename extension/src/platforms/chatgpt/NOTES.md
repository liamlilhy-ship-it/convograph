# ChatGPT platform notes

## Decision: click-to-jump on long chats — "keep current" (2026-06-05)

**Behavior:** Clicking a graph node scrolls the live ChatGPT chat to that message
**only when ChatGPT has it rendered** (its recent sliding window of turns). For an
older/unrendered message, the jump does nothing — no toast, no scroll-jank. The
message's content is always readable via the graph's own preview (it comes from
the API, not the page).

**Why we can't do better (investigated live):** ChatGPT renders every turn as a
`<section data-testid="conversation-turn-N">`, but only fills in the *content* of a
~5-turn window around the current scroll position; older turns are empty sections.
That window is moved by ChatGPT's JS reacting to **real user scrolling**. None of
these programmatic levers move it:

- setting `scrollTop` / stepping the scroll container — ignored
- `scrollIntoView()` on the target `<section>` — empty section, nothing to show
- synthetic `wheel` events / long waits — no effect
- synthetic ⌘F (ChatGPT's in-chat search) — doesn't trigger; no clickable button
- React fiber probe for a `scrollToIndex`/jump API — none exposed

So an extension cannot force ChatGPT to render an off-window message. (Claude is
different — it keeps the whole thread mounted, so its scroll-search works; that's
why `dom.scrollSearch` is left enabled for Claude and set `false` here.)

**Explicitly not pursued (deferred):**
- A "hybrid" fallback that auto-opens the unreachable message in the extension's
  preview (viable, but the user chose to keep the current minimal behavior).
- Scripting ChatGPT's in-chat search or simulating sustained real-scroll (fragile,
  low confidence, likely to break on ChatGPT UI updates).

Revisit if ChatGPT exposes a message permalink/anchor or an imperative scroll API.
