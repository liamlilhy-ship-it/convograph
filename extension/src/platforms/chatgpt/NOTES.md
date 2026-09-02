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

## Decision: in-place branch switch removed (2026-09-02)

**What changed on chatgpt.com (verified live, en UI):** the inline `< n/m >`
version pager is gone — no counters, no `svg[data-rtl-flip]` arrow buttons in any
turn (`data-rtl-flip` now only appears on unrelated chrome: sidebar toggle, link
chips, the "Thought for Ns" chevron). A user message that has any variant below
it — an edited sibling AND/OR a regenerated answer — instead shows a clock button
`data-testid="variants-turn-action-button"` ("See versions"), rendered before the
Edit pencil. It opens a read-only "Variants" overlay (not `role=dialog`; header
"Version N" / "Current version"; Prev/Next carry `data-rtl-flip`) that flattens
edits × regenerates into one oldest-first list. A non-current version shows only
that user message + its reply with a single action, **"Branch to a new chat"**,
which forks a NEW conversation; the current version shows "Return to current
version". Closing changes nothing. The answer "More actions" menu has "Open new
branch" (also a new chat). Server `current_node` still moves only on a real send.

**So:** ChatGPT has no way to make an older branch the active one in place.
Driving the old arrows (`branchSwitch.ts`) had degraded to a silent false success
(control never found → "already correct" → App re-highlights, `detectActiveLeaf`
snaps it back). Removed entirely; `serverBranchSwitch: false`.

**Behavior now:**
- Clicking an off-active-path node expands it in place on the canvas (click
  again to collapse) — the "hybrid" preview fallback deferred above, adopted
  because it is the only way to read that branch. Active-path clicks scroll as
  before. Off-path cards are NOT dimmed here (`.cg-panel[data-branch-switch=
  "false"]` in panel.css): every branch is equally readable, so the current
  branch is marked by a stronger accent ring + tint and its accent edges.
- Edit / regenerate / follow-up only work on the branch shown in the chat; their
  buttons render disabled with a tooltip on off-branch nodes
  (`PlatformUI.writesRequireActivePath`), and writes.ts throws an honest error as
  the backstop.
- The native "Branch to a new chat" / "Open new branch" actions are NOT used
  (they leave the conversation). Revisit if ChatGPT restores an in-place switch.
