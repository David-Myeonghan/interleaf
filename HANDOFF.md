# Handoff

Read this first on a new machine or in a new session. It says what Interleaf
is, where it stands, and the handful of things that cost hours to learn.

## What it is

A Chrome extension that copies the page you are reading into a single
self-contained HTML file — images, stylesheets and fonts embedded — and lets you
highlight text and write notes beside the line they belong to. The notes live
inside that same file, next to an inlined viewer, so the file is the whole
document: another computer needs nothing installed to read it.

## Where it stands

Version 1.0.0. Working and used on real pages: a 744KB search result, a 2MB
internal document, a 3.9MB site, all captured whole, annotated, and saved back
to the same file without a dialog.

Three automated suites pass from a cold start (`npm run verify`): capture,
round trip through a written file, and save behaviour.

Store material is written and the upload zip has been built and loaded as a
reviewer would receive it. What remains is a developer registration (5 USD) and
the upload form — the only two steps that cannot be done from a terminal.

## Continuing on another machine

    git clone https://github.com/David-Myeonghan/interleaf.git
    cd interleaf
    npm run setup

`setup` installs, builds, and fetches Chrome for Testing (about 150MB, once per
machine) because branded Chrome dropped `--load-extension` in 137 and the
harness needs it.

**Not yet verified end to end.** The fresh-clone run was stopped during the
browser download, so `setup` has been read but not watched to completion on a
clean checkout. Do that first; if it fails it will be in the download step, and
`npm run verify` afterwards is the proof.

To use it rather than work on it: `chrome://extensions`, developer mode on,
**Load unpacked**, pick `extension/`, then open its details and turn on **Allow
access to file URLs** so saved files can be reopened and kept editable.

Two things are per-machine and cannot travel: the folder you save into, and the
write permission on it. The browser only grants those through its own picker.
One folder choice per browser profile is the whole cost — after that each saved
file finds its own by name and stamped id.

## Where things are written down

| Where | What |
|---|---|
| `README.md` | What it does, and the design decisions behind it |
| `docs/publishing.md` | Store status, and what changing it costs after release |
| `docs/store-listing.md` | Listing text, per-permission justifications, every privacy answer |
| `docs/resume-line.md` | One-line summaries and the points behind them |
| `PRIVACY.md` | The policy a reviewer asks for a URL to |
| `scripts/m4-manual.md` | The steps a person has to walk, since OS dialogs cannot be driven |
| Obsidian vault | `Todo-pernosal/사이드 프로젝트 후보.md` #6 and its plan sub-page: the full record including what was got wrong and how it was found |

## Things that cost hours

**A capture engine needs the page's own url.** Without it the base URI ends in
`undefined` and every relative link resolves against the wrong place.

**"A `file://` page cannot write to itself" was wrong.** The error said *Must be
handling a user gesture*, not that the origin was refused. Measuring it removed
a whole layer of the design: the extension is capture-only because the saved
file turned out able to save itself.

**Chrome keeps a registered MV3 service worker across restarts.** Tests passed
against code that was not on disk for several commits. `scripts/ensure-fresh.mjs`
now asks the worker which build it is running and refuses to verify on a
mismatch. Only wiping the profile reliably replaces it.

**Launching into a profile another browser holds opens a window in the old one.**
It does not start a new browser, so an edited extension goes on running as the
bytes it had. `scripts/dev-chrome.sh` kills by profile path and refuses to
launch if anything still holds it.

**CDP requests need deadlines.** A call whose reply never comes leaves a promise
pending forever, and because `waitFor` awaits its probe, the timeout it was
given cannot fire. Runs hung with no error and no last line.

**macOS grants local-network access per binary and withholds it from Chrome for
Testing.** The browser cannot reach any localhost server while `curl` on the
same machine gets 200. Fixtures are served from `file://` for that reason.

**A remembered folder holds other files, and a name is not an identity.** A
capture whose title matched an existing file would have overwritten it. Every
capture carries a `docId` and a file is only adopted when the stamped id
matches; a stranger of the same name is stepped around.

**Pages declaring `base-uri 'none'` cannot be captured at all** — embedding
their resources requires setting one. The capture probes for that refusal and
names it, rather than failing into a console error.

## If you are a new session

The project memory file
`~/.claude/projects/-Users-david-Imagoworks-dentbird-solutions/memory/project_interleaf_side_project.md`
carries the same facts in shorter form, and the vault plan carries the full
history of what was measured and what was wrong. Prefer measuring over reading
either of them: nearly every design decision here changed after being measured.
