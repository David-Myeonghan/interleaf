# M4 — what a person has to check

The OS file and folder pickers are native windows, so CDP cannot drive them.
Everything reachable without one is covered by `scripts/m4-verify.mjs`; the
steps below are what remains.

Load `extension/` through **Load unpacked** in `chrome://extensions` first, and
run `npm run build` before that so `viewer-runtime.js` is current.

## 1. First save remembers the folder

1. Open any article, click the Interleaf icon, then **이 페이지 저장**.
2. Drag over a sentence, type a note.
3. Click **이 파일에 저장**. The panel appears with **다음에도 여기에 저장**
   already ticked. Click **위치 고르기** and pick a folder.

**Expect** the toolbar to show `→ <folder>/<page>.html` and `저장됨 <time>`, and
that file to exist on disk with the note in it.

## 2. Later notes save themselves

4. Type more into the note and stop.

**Expect** `저장 중…` then `저장됨 <time>` within about two seconds, with no
dialog and no click. The file's modification time moves; no second file appears.

## 3. The second capture asks nothing

5. Capture a different page and add a note.

**Expect** the toolbar to already read `→ <folder>/<something>.html` with no
panel, and the note to save itself. Two files now sit in that folder.

## 4. A neighbour of the same name is not overwritten

6. In that folder, create `collide.html` by hand with some text of your own.
7. Capture a page whose title makes Interleaf want that same name — or rename one
   of its saved files to `collide.html` and capture that page again.

**Expect** Interleaf to write `collide (2).html` and leave your `collide.html`
byte for byte as it was. This is checked automatically against a stubbed folder
too, but it is worth seeing on real disk once.

## 5. Reopening a saved file needs one click at most

8. Quit Chrome entirely (⌘Q), reopen it, and open one of the saved files from
   disk — no extension involved in the page.

**Expect** the highlights and notes to be there, and the button to read
**저장 허용**. Click it once, then type into a note.

**Expect** `저장됨` and the same file to change on disk — no new file, no picker,
because the remembered folder plus this file's own name is this same file.

## 6. Turning the memory off

9. Click **기억 해제**.

**Expect** the location line to clear and the next save to bring the panel back.
The files already on disk are untouched.

## 7. Nowhere to write

10. On a fresh capture, click **이 파일에 저장** and dismiss the panel with 취소.

**Expect** a copy to land in the downloads folder rather than the notes being
stranded.

## What to report back

For each step: what the toolbar said, whether a dialog appeared, and whether the
file on disk changed. A step that needed more clicks than stated is the finding
worth writing down.
