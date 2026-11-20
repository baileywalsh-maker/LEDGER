# Ledger — notes for Claude

Read this first in any chat about Ledger. The full handover is imported below.

## How changes ship now (replaces "deliver the zip / Netlify" in the handover)
- Hosted on GitHub Pages: https://baileywalsh-maker.github.io/LEDGER/
- Claude pushes straight to this repo (`main`). Bailey does nothing on the laptop.
- Before every push: run the tests in `_source/tests/` (see its README), and
  bump the version in `sw.js` (`ledger-vNN`).
- Commit message = the version, e.g. `v66`. Update `_source/LEDGER_handover.md`
  in the same commit.
- Rolling back = revert the last commit. Every version stays in the history.
- This repo is **public**. Never commit keys, backups, bank exports or personal
  money figures (balances, amounts paid in or out).
- **Keep Muse in step.** Muse works from the private `LEDGER-sync` repo and reads
  its `MUSE.md` (what the file holds, how Ledger counts money, how to edit it).
  Any change to the synced data (a new field, category, account type or
  investment entry kind) or to how money is counted (spending, income, You keep,
  net position) must update `LEDGER-sync/MUSE.md` in the same go, plus
  `_source/SYNC.md` and `_source/tests/synctest.js` if the file format changed.
  Every release, set MUSE.md's "Matches Ledger" line to the new version.
  Only ever touch `MUSE.md` there: `ledger-sync.json` belongs to the phone and Muse.

## Gaps to know about (Nov 2026)
- **Live version is v66.** v61–v64 are now written up in the handover; v65 was the move to GitHub Pages. v66 adds Sync with Muse — see `_source/SYNC.md`.
- **The split source (`ledger_source_v56.zip`, `src/` + `build.js`) is not in
  this repo.** Until it's found, `index.html` here is the only copy of the app.
  Edit it carefully, or rebuild the source from it.
- "Sound board 2" mentioned below was deleted in the Nov 2026 clean-up.

## Mockups and demos: one page per app
- All design ideas, mockups and demos for Ledger go on ONE artifact titled "Ledger designs".
  Update that same page every time (republish to its link). Never make a new one.
- Its link: (none yet — create it the first time a mockup is needed, then write the link here)
- Old ideas get replaced on the page, not kept. Decisions go in the handover instead.

@_source/LEDGER_handover.md
