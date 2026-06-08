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
| **claude.ai** | `claude.ai` | Full support. Branch switching persists server‑side, and jump‑to‑message works for any message in the thread. |
| **ChatGPT** | `chatgpt.com`, `chat.openai.com` | Visualize, branch‑switch, and edit / follow‑up / regenerate via ChatGPT's native UI. Branch selection is local and re‑applied on reload. Click‑to‑jump only reaches messages currently loaded in the chat — scroll older ones into view first. |

## Installation

Convograph is **not on the Chrome Web Store yet**, so you install it by building from source. It takes a couple of minutes.

### Prerequisites
- **Node.js 18+** (recommended) and **npm**
- **Google Chrome** (or any Chromium browser with `chrome://extensions`)

### Option A — Manual install

```bash
git clone https://github.com/liamlilhy-ship-it/chat-tree.git
cd chat-tree/extension
npm install
npm run build
```

Then load it into Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top‑right toggle).
3. Click **Load unpacked**.
4. Select the `chat-tree/extension/dist` folder.

The extension appears as **"Conversation Graph."** Open claude.ai or ChatGPT, then click the **Convograph** pill near the composer (or press **⌘/Ctrl + Shift + G**).

### Option B — Install with a coding agent

Prefer to let an AI coding agent (Claude Code, Cursor, etc.) handle the build? Paste it this prompt:

> Clone https://github.com/liamlilhy-ship-it/chat-tree. In the `extension/` directory, run `npm install` then `npm run build`. When it finishes, tell me the absolute path to `extension/dist` and walk me through loading it as an unpacked extension at `chrome://extensions`.

The agent can clone and build for you, but **you** still load the unpacked `dist/` folder — agents can't toggle Chrome's developer‑mode UI.

## Updating

```bash
git pull
cd extension
npm run build
```

Then click **Reload** on the extension's card in `chrome://extensions`. The loaded `dist/` folder is a build artifact (gitignored), so a `git pull` alone won't refresh what Chrome is running — you need to rebuild and reload.

## Development

From the `extension/` directory:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type‑check and bundle (`tsc --noEmit && vite build`). |
| `npm test` | Run the test suite once (`vitest run`). |
| `npm run test:watch` | Run tests in watch mode. |

The shared panel UI lives in `src/panel`; per‑site adapters live in `src/platforms/{claude,chatgpt}`.

## License

[MIT](./LICENSE) © 2026 Liam (liamlilhy-ship-it)
