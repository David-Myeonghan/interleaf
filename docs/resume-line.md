# For a CV

Pick one. Each is one line, and each states something a reader can check by
opening the listing or the repo.

**Shortest**

> **Interleaf** — Chrome extension (published): saves a web page as one
> self-contained HTML file you can annotate in the margin. No server.
> AGPL-3.0, ~2k lines. github.com/David-Myeonghan/interleaf

**With the engineering point**

> **Interleaf** — published Chrome extension that saves a page as a single
> self-contained HTML file and lets you write notes in its margin. The saved
> file carries its own viewer, so it needs no extension to be read or edited.
> Verified end to end over CDP, including anchor recovery when stored offsets
> go stale.

**If the interview is about testing**

> **Interleaf** — published Chrome extension (page capture + margin
> annotation). Built a CDP harness that refuses to run against stale extension
> bytes; it caught a data-loss bug where a capture could overwrite an unrelated
> file of the same name, and a race where concurrent saves wrote three times.

## Talking points, if asked

- **The file is the whole document.** Notes live in a JSON block inside the
  captured HTML, and the viewer that draws them is inlined next to it. Hand the
  file to another machine and the notes travel with it; no extension needed to
  read or keep editing it.
- **Anchoring.** A note stores the quoted text with 32 characters of context on
  each side plus the character offsets, the way the W3C annotation selectors
  do. Resolution tries the offset and accepts it only if the text there still
  matches; otherwise it scores every occurrence of the quote on how much
  recorded context it reproduces. That is what makes a phrase appearing twice
  land in two different places.
- **Never reflowing the capture.** Reserving width can break a captured layout
  outright, and the only way back from that is to hide the notes. Overlaying
  merely occludes, which folding undoes. The recoverable loss wins.
- **Measurement over reading.** "A `file://` page cannot write to itself" was
  wrong: the error said *Must be handling a user gesture*, not that the origin
  was refused. Measuring it removed a whole layer of the design — the extension
  is capture-only because the saved file turned out able to save itself.
- **A harness that cannot lie.** Chrome keeps a registered service worker
  across restarts, so tests were passing against code that was not on disk. The
  worker now reports the build it is running and verification refuses to
  proceed when it disagrees with the checkout.

## Numbers worth quoting

- 222KB page captured in 382ms; a 2MB internal document and a 3.9MB site also
  captured whole
- Five notes on five adjacent lines: no card overlaps, worst drift 191px, which
  is why the active note draws a leader line
- Three automated suites: capture, round trip through a written file, and save
  behaviour — including a page that forbids `base-uri` and therefore cannot be
  captured at all
