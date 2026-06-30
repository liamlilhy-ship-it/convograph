# Convograph (Conversation Graph)

> See any **claude.ai** or **ChatGPT** conversation as a branch graph — hover to preview, click to jump, and branch without losing your place.

## Summary

Convograph is a Chrome extension that turns a linear AI chat into an interactive **node graph** of every branch and alternate response. Each message becomes a node, the branch you're currently on is highlighted, and the rest of the tree stays visible and muted — so you always see *where you are* and how you got there.

Open it from the **Convograph** pill next to the chat composer, or press **⌘/Ctrl + Shift + G**. (In Chrome's extensions list it appears under its formal name, *Conversation Graph*.)

## Features

**Visualize**
- Your whole conversation rendered as a node graph, branch points and all.
- Active path highlighted in your platform's accent color; other branches muted.
- Minimap overview, top‑to‑bottom ↔ left‑to‑right layout toggle, resizable side panel, and a full‑screen mode.
- Automatically follows the site's **dark / light** appearance.

**Navigate**
- Click a node's role chip — *You* / *Claude* / *ChatGPT* — to switch to that branch and scroll the native chat to that message.

**Search every branch** *(claude.ai)*
- Open the search bar with the **magnifier icon** (top‑right) or **⌘/Ctrl + F**; close it with the icon, **✕**, or **Esc**.
- Searches the **whole conversation — every branch**, including hidden ones the native chat can't show — across message text, code, generated artifacts, uploaded‑file contents, and widget source.
- Counts **every occurrence**, not just every message; step through them with the **◂ ▸** arrows (or **Enter** / **Shift + Enter**).
- Matches stand out in the graph in a color distinct from the active path; stepping opens the node's inline reader and scrolls to and highlights each hit in turn — all on the graph, without disturbing the native chat.

**Read in place**
- Double‑click a node for an inline reader.
- Pop out draggable, resizable floating preview windows (open several at once; font size is shared across them).
- Hover image/widget thumbnails for an enlarged preview.
- Click footer attachments — generated documents, images, interactive widgets, uploaded files — to open them.

**Branch & generate**
- Edit a message, ask a follow‑up, or regenerate an answer right from the graph.
- Responses stream in live, with the conversation's model shown on the draft.

## Supported platforms

| Platform | Hosts | Notes |
| --- | --- | --- |
| **claude.ai** | `claude.ai` | Full support. Branch switching persists server‑side, jump‑to‑message works for any message in the thread, and whole‑conversation search spans every branch. |
| **ChatGPT** | `chatgpt.com`, `chat.openai.com` | Visualize, branch‑switch, and edit / follow‑up / regenerate via ChatGPT's native UI. Branch selection is local and re‑applied on reload. Click‑to‑jump only reaches messages currently loaded in the chat — scroll older ones into view first. (Cross‑branch search is claude.ai‑only for now.) |

## Installation

Convograph is **not on the Chrome Web Store yet**, so you install it by building from source. It takes a couple of minutes.

### Prerequisites
- **Node.js 18+** (recommended) and **npm**
- **Google Chrome** (or any Chromium browser with `chrome://extensions`)

### Option A — Manual install

```bash
git clone https://github.com/liamlilhy-ship-it/convograph.git
cd convograph/extension
npm install
npm run build
```

Then load it into Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top‑right toggle).
3. Click **Load unpacked**.
4. Select the `convograph/extension/dist` folder.

The extension appears as **"Conversation Graph."** Open claude.ai or ChatGPT, then click the **Convograph** pill near the composer (or press **⌘/Ctrl + Shift + G**).

### Option B — Install with a coding agent

Prefer to let an AI coding agent (Claude Code, Cursor, etc.) handle the build? Paste it this prompt:

> Clone https://github.com/liamlilhy-ship-it/convograph. In the `extension/` directory, run `npm install` then `npm run build`. When it finishes, tell me the absolute path to `extension/dist` and walk me through loading it as an unpacked extension at `chrome://extensions`.

The agent can clone and build for you, but **you** still load the unpacked `dist/` folder — agents can't toggle Chrome's developer‑mode UI.

## License

[MIT](./LICENSE) © 2026 Liam (liamlilhy-ship-it)
