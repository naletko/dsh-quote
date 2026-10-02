# Quote for DeepSeek Harness

Select text in the conversation and put it into the composer as a markdown block quote — like Codex does, and without touching the draft you already typed.

A small, quiet **Quote** button appears next to the selection. Click it, or press `Ctrl+Shift+.` (`Cmd+Shift+.` on macOS), and the selection lands in the composer as:

```
> first line of the quoted text
> second line of the quoted text
```

One blank line separates the quote from whatever you had already written. The quote is *appended* to your draft, never substituted for it.

---

## ✨ Features

- **Quote the selection.** Assistant and user messages alike — anything selectable in the transcript.
- **Never loses your draft.** Insertion goes through the composer's own `captureInsertion()` / `insertText()`, which inserts one undoable edit at the caret. If that path is unavailable the draft is read back from the composer and the quote is appended to it — the plugin never overwrites what you typed.
- **Keyboard first.** `Ctrl+Shift+.` on Windows and Linux, `Cmd+Shift+.` on macOS, and the chord can be re-recorded in the settings.
- **Disappears when it should.** Collapsed selection, a click in empty space, `Esc`, a scroll, a resize, a tab switch or a session change all remove the button.
- **No false positives.** Selections inside `input`, `textarea` or `contenteditable` surfaces — including the composer itself — are ignored.
- **Tidy text.** The selection is trimmed, `CRLF` is normalized, runs of blank lines collapse into a single quoting line, and the quote is capped at a configurable length.
- **Theme-native.** Every colour is a DSH token (`--dsw-alias-*`) with a fallback, so the button and the settings card look right in the dark and the light theme. It honours `prefers-reduced-motion`, carries an `aria-label` and shows a focus ring.
- **English and Russian.** The UI follows `document.documentElement.lang` (`ru*` → Russian, otherwise English).
- **No dependencies, no build step.** One host file, one browser file.

---

## 📦 Installation

Pick whichever route matches how you use DSH.

### From the Desktop app

1. Open **Plugins**.
2. Choose **Add plugin** and enter `dsh-quote` — or the absolute path to this folder when you are installing a local checkout.
3. Enable the bundle if it arrives disabled. The settings card appears on the plugin's own page.

### From the CLI

```bash
dsh plugin --profile web add dsh-quote
```

To install a local checkout instead of the published package, pass its absolute path:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-quote
```

### From source

Nothing needs to be built or installed:

```bash
git clone https://github.com/naletko/dsh-quote.git
cd dsh-quote
node test/metadata-check.mjs
node test/quote-logic-check.mjs
```

---

## 🚀 Usage

1. **Select** some text in the conversation — part of a message, a whole paragraph, several paragraphs.
2. Click **Quote** beside the selection, or press the hotkey.
3. The block quote is **added to the composer**, after a blank line, leaving the rest of your draft alone.

Typical use: select the paragraph of an answer you disagree with, quote it, and type your follow-up underneath.

---

## ⌨️ Keyboard shortcut

| Platform | Default |
| --- | --- |
| Windows, Linux | `Ctrl+Shift+.` |
| macOS | `Cmd+Shift+.` |

The setting is stored as the portable chord `Mod+Shift+.`, where `Mod` resolves to `Ctrl` on Windows and Linux and to `Cmd` on macOS. Any chord with at least one modifier can be recorded in the settings card; the plugin matches letter keys by physical key code, so the shortcut keeps working on a non-Latin keyboard layout.

---

## ⚙️ Settings

The card lives on the plugin's page in **Plugins** and behind the row's **Configure** control.

| Setting | Default | What it does |
| --- | --- | --- |
| **Enable quoting** | on | Turns the button and the hotkey off without uninstalling the plugin. |
| **Add an attribution line** | off | Closes the quote with one extra line, `> — quote` (Russian: `> — цитата`). |
| **Maximum quote length** | `4000` | Characters kept from the selection; accepts `200`–`20000`. Longer selections are cut on a character boundary. |
| **Keyboard shortcut** | `Mod+Shift+.` | Click the field and press the combination you want. `Restore default` puts the default back. |

The card shows a live preview of exactly what will be inserted.

Settings are read and written through the plugin's own route, `GET`/`POST /api/dsh-quote/config`, and stored as `dsh-quote-config.json` in the DSH home directory — `$DSH_HOME` when that variable is set, otherwise `~/.dsh`. The browser keeps a copy in `localStorage` purely so the composer knows your settings on the first paint.

---

## 🔒 Privacy

- **No network access.** The plugin's host half serves one local route and nothing else; it never calls out to any service.
- **No secrets, no telemetry, no analytics.** There is nothing to configure but four display preferences.
- **Local files only.** The only file written is `dsh-quote-config.json` under `$DSH_HOME`.
- **Local requests only.** `/api/dsh-quote/config` refuses any request that does not clearly originate from loopback, and rejects bodies above 16 KiB.
- **Nothing leaves the page.** The selected text is formatted in the browser and inserted into the composer; it is never uploaded, logged or persisted by this plugin.

---

## 🔄 Updating

The plugin updates itself: **Settings → Plugins → Quote** carries an **Updates** section that asks GitHub for the
branch revision, shows the version installed next to the version on `main`, lists what changed, and hands the pinned
commit to the harness plugin manager in one click. Reload the page afterwards; if the version has not changed, restart
the application — the host half only loads at boot.

A deployment without a plugin manager prints the manual spec instead, for **Plugins → Add plugin**:
`github:naletko/dsh-quote`.

---

## 🧩 Requirements and compatibility

- **DeepSeek Harness core `0.2.0-rc.2`** (the web client of the Desktop app or a browser session).
- Uses the `conversation.input.right` slot (a **list** seat — the single `conversation.input.activity` seat is deliberately left free, because occupying it evicts the voice plugin's microphone), plus `plugins.bundle.config` and `plugins.row.config`, and the composer's `captureInsertion()` / `insertText()` / `setDraft()` actions.
- **Windows, macOS and Linux.** Paths are built with `node:path`, the hotkey understands `metaKey`, and no platform-only API is used.
- No npm dependencies, no bundler, no build step.

---

## 🧪 Tests

```bash
node --check index.js client.js
node test/metadata-check.mjs      # exports map, icon, locales, slot registrations
node test/quote-logic-check.mjs   # quoting rules, hotkeys, settings, placement
```

`client.js` is not a module — it registers itself with DSH's browser module loader — so both tests load it through a fake `window.__ModuleLoader__`, exactly as the browser does, and drive the plugin's own functions through the `__test` hook it exposes. The host half is a real ES module and is imported directly.

---

## 📄 License

[MIT](./LICENSE) © 2026 Alex Naletko
