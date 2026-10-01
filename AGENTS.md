# Agent installation guide

Use this guide when someone asks you to install, update, verify, or remove `dsh-quote` in a DeepSeek Harness profile.
Current release: **dsh-quote@1.0.0**, qualified against DSH cores **0.2.0-rc.2**, **0.2.0-rc.1** and **0.1.7-rc.2**.

## Safety

- Confirm the target installation and the profile before touching anything.
- Install the exact requested version; never a moving branch.
- The plugin stores no secrets: never ask for a key, and never move one into its settings file.
- Preserve conversations, attachments, other plugins, settings, and credentials.
- Do not start, stop, or restart the harness without permission.

## Install

**Plugins page (works while the application is running, and the only path for the `desktop` profile):**

1. Open **Plugins → Add plugin**.
2. Paste one of these and install:
   ```text
   dsh-quote
   github:naletko/dsh-quote
   /absolute/path/to/dsh-quote
   ```
3. Restart the harness only if the page asks for it.

**Terminal (profile not owned by the desktop app, or after the app is fully quit):**

```sh
dsh plugin --profile web add dsh-quote
dsh plugin --profile desktop add dsh-quote   # only with DSH Desktop fully closed
dsh --profile web --dump-config               # compose the tree without booting
```

The `desktop` profile is managed exclusively by the Electron application: while the app runs, `dsh plugin --profile
desktop …` is refused. Use the Plugins page there.

## How it behaves

Selecting text in the conversation shows a small **Quote** control beside the selection; pressing it inserts a markdown
block quote (`> …`) into the composer without touching what is already typed. The keyboard shortcut is
`Ctrl+Shift+.` on Windows and Linux, `Cmd+Shift+.` on macOS, and both are configurable on the plugin's card in
**Settings → Plugins**. The control hides on Escape, on scroll, on a collapsed selection, and on a click elsewhere, and
it never reacts to a selection inside the composer itself.

## Verify

```sh
node --check index.js && node --check client.js
node test/metadata-check.mjs
node test/quote-logic-check.mjs
```

In a live session, with permission:

1. Ask for **Plugins → Add plugin** with the folder path.
2. Select a paragraph of a reply and confirm the control appears beside it; press it and confirm the composer now holds
   a `> ` block plus whatever was already there.
3. Press the shortcut with a selection and confirm the same result.
4. Open the plugin's card in **Settings → Plugins** and confirm the toggles save and reload.

## Update

There is no automatic update. Uninstall and install again, or install a newer spec:

```sh
dsh plugin --profile web remove dsh-quote
dsh plugin --profile web add dsh-quote@1.1.0
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-quote
```

Removing the plugin must preserve the composer's own behaviour, sessions, settings, and other plugins. The plugin's
small settings file under `$DSH_HOME/dsh-quote` may be deleted with it, but only when the person asks.

## Failure handling

Keep the causes separate, and report which one you proved:

- **The plugin loaded but nothing happens on selection** — the browser half did not apply: check the client console for
  `dsh-quote`. The `conversation.input.activity` seat it occupies is session-scoped, so a page without a conversation
  (the blank New Session view) shows nothing by design.
- **No floating control** — the composer's row is a containment context, and the control is drawn through a portal into
  `document.body`; if `react-dom` cannot be resolved the plugin falls back to inline fixed rendering, which can be
  clipped by an ancestor with `overflow: hidden`. Read the console warning rather than guessing.
- **The quote replaced the draft instead of appending** — the insertion path fell through to `setDraft`. Report the DSH
  core version; that path exists only for cores whose composer has no insertion span.
- **Nothing was inserted at all** — the composer may have been busy or unfocused; the control is a no-op rather than a
  silent partial write.

Do not patch files inside an installed DSH, disable browser security, or edit the person's conversations to reproduce a
problem.
