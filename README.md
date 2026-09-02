# Interleaf

Save a web page as **one self-contained HTML file**, then write notes in its margin.
The notes live inside that same file. No server, no account, no database.

Old books were sometimes bound with blank pages slipped between the printed ones,
so a reader could write alongside the text. Those were called *interleaved* copies.
This does that to a web page.

## How it works

Click the toolbar button and the page you are reading is copied into a single HTML
file — images, stylesheets and fonts inlined, so it renders with the network gone.
The copy opens in a new tab. Drag over any text and a note box appears beside that
line. Notes are stored in a JSON block at the bottom of the file and drawn back on
open, so the file is the whole document: hand it to another machine and the notes
travel with it.

## Design

**The saved file does almost everything.** Viewing, highlighting, editing and saving
all run from script inlined in the file itself. A `file://` page can write to its own
file after one click, and can keep writing with no further clicks.

**The extension exists for capture only.** Inlining a page's images and stylesheets
means fetching them, and a script running in the page is blocked by CORS. Crossing
that needs an extension's `host_permissions`. That is the one thing the file cannot
do for itself.

**Note positions are never stored** — only the anchor text. Cards are laid out fresh
on every open and on every resize, which keeps overlapping notes a layout problem
rather than a data problem. The captured DOM is never modified, so turning notes off
shows the original page exactly as it was.

## Measurements

Against Chrome 152 (`m0/results.json`):

- Capturing a 222KB page: **382ms**
- A `file://` page can pick a save target and then write to it from a timer with no
  user gesture
- A directory handle lets later captures write with **no dialog at all**
- Both handles survive a browser restart, costing one permission click per browser
  session

## Layout

```
extension/    the Chrome extension (MV3)
src/          capture entry point, bundled into extension/sf-bundle.js
scripts/      CDP-driven verification harness
probe/        the throwaway extension used to measure the unknowns up front
m0/           what those measurements found
test/         fixture site with external assets, for offline verification
```

`npm run build` produces `extension/sf-bundle.js`. Load `extension/` through
**Load unpacked** in `chrome://extensions` — branded Chrome dropped
`--load-extension` in 137, so the verification harness runs on Chrome for Testing.

## License

AGPL-3.0-or-later. Interleaf bundles [single-file-core](https://github.com/gildas-lormeau/single-file-core)
for page capture; see [NOTICE](NOTICE).
