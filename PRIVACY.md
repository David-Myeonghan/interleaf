# Interleaf — Privacy Policy

Last updated: 2026-09-03

## The short version

Interleaf sends nothing anywhere. There is no server, no account, and no
analytics. Everything it produces is a file on your own disk.

## What it handles

**Page content.** When you click the toolbar button, Interleaf reads the page
you are looking at and writes a copy of it — text, images, stylesheets and
fonts — into a single HTML file that you choose the location of. That copy
exists only on your computer.

**Your notes.** The notes you write are stored inside that same HTML file,
alongside the text they are attached to.

**Where to save.** Interleaf remembers the folder you picked, so later saves do
not have to ask again. The browser stores that permission locally; Interleaf
cannot read any other part of your disk.

## What it does not do

- No data leaves your computer. Interleaf makes no network requests of its own.
- No tracking, telemetry, analytics or crash reporting.
- Nothing is shared with the developer or with any third party.
- No advertising, and no selling or transferring of data. There is no data to
  sell: none of it reaches us.
- Your browsing history is not read, recorded or transmitted. Interleaf only
  looks at a page at the moment you ask it to save that page.

## Why it asks for broad site access

Saving a page as one self-contained file means fetching that page's own images,
stylesheets and fonts so they can be embedded. A script running inside a page
cannot fetch them — the browser blocks cross-origin reads — so the extension
needs access to the sites you save. Because you may save a page on any site,
that access cannot be narrowed to a fixed list in advance.

The access is used for one thing only: reading the page you asked to save, at
the moment you ask. It is never used to observe pages you did not ask about.

## Permissions, one by one

| Permission | Why |
|---|---|
| Site access (all sites) | Fetch the saved page's own images, styles and fonts so the copy stands alone |
| `scripting` | Run the capture code inside the page being saved |
| `storage` | Remember which folder you chose to save into |
| `downloads` | Hand you a copy of the file when no save location has been chosen |

## Local storage

Interleaf keeps the folder you selected, and the file it last wrote to, in the
browser's local storage for the extension. Removing the extension removes them.
Files already written to your disk are left alone.

## Source

Interleaf is free software under the AGPL-3.0. The complete source is at
https://github.com/David-Myeonghan/interleaf and can be read and rebuilt by
anyone.

## Contact

Open an issue at https://github.com/David-Myeonghan/interleaf/issues
