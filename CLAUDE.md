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

## Gaps to know about (Nov 2026)
- **Live version is v65**, but the handover below only covers up to v60.
  What changed in v61–v65 isn't written down here yet.
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
