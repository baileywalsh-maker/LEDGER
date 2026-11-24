# Ledger — notes for Claude

Read this first in any chat about Ledger. The full handover is imported below.

## The setup (Bailey's rules, same as Jot; Nov 2026)
1. **This repo IS the app.** GitHub Pages serves `main` at
   https://baileywalsh-maker.github.io/LEDGER/. No zips, no uploads, no Netlify.
2. **Claude pushes straight to `main`.** Bailey never touches the laptop; he opens the app
   on his phone and it updates.
3. **Before any change: pull the latest and read the recent commits** (`git log`, plus the
   diffs of any not made by Claude). **Muse** (Bailey's other assistant) runs Ledger day to
   day through the private `LEDGER-sync` repo and **can also change this code**. Never assume
   the code is where you left it. Build on what's live, keep Muse's changes, and mention them
   to Bailey in one line. If one clashes with the plan, ask him first.
4. **Pull again right before pushing**, so nothing Muse did in the meantime is lost.
5. **Every update:** run all the tests (below), add tests for anything new, bump `sw.js`
   (`ledger-vNN`), and never wipe or break data saved on his phone (new fields additive only).
   Commit message = the version, e.g. `v67`; add a short section to
   `_source/LEDGER_handover.md` in the same commit.
6. **Keep this file current** whenever the rules or how the app works change.
7. **Mockups and demos:** one page only, "Ledger designs" (see below). Update it each time,
   showing the real app (screenshots of the real build), not a drawing.
8. **What Bailey gets back:** a short summary of the changes, plus a picture if something
   visual changed. No zips. No handover docs unless he asks, or the chat is getting too full.
9. **This repo is PUBLIC.** Never commit personal data, keys, backups, bank exports, real
   names, employers, places or money figures. Test data must be made up ("Test Person").
   `node _source/tests/privacytest.js` must say "Safe to push" before every push.

## Editing the app (source split, v69)
- **Edit `_source/src/`, never `index.html` directly.** Parts are listed in order in
  `_source/src/parts.txt` (html/, css/, js/). Then `node _source/build.js` writes `index.html`
  (it refuses if the script has an error).
- **First, every time:** `node _source/build.js --check`. If it says index.html does NOT match
  src/, someone (Muse) edited `index.html` directly: run `python3 _source/split.py index.html
  _source/src`, rename `_source/src/order.txt` to `parts.txt`, and keep those changes.
- Parts added since the split: `js/12b-real-sounds.js` (v70), `js/32b-cloud-backup.js`,
  `js/37b-payday-calendar-pots.js` (v69), `js/37c-pull-refresh.js` (v72: holds `APP_VERSION`,
  which must match `sw.js` or build.js refuses).

## Running the tests
- Layout the browser tests expect (outside the repo): `app/` = this build, `app-previous/` =
  the live build before your change, `shots/`, and a copy of `_source/tests/` as `tests/`.
  Run each from `tests/`: `NODE_PATH=$(npm root -g) CHROME=/usr/bin/google-chrome node functest.js`
  (and soundtest, citest, montest, memotest, settingstest, frtest, movetest). functest checks
  saved data is identical before/after the update.
- `synctest.js` runs from inside the repo (it loads the repo's `index.html`).
- `privacytest.js` runs from anywhere.
- Also `compacttest.js` (v68) and `featuretest.js` (v69) in the same layout. `cloudtest.js` runs
  from inside the repo like synctest.
- `pulltest.js` (v72) in the browser layout.
- v72 baseline: 194 browser checks (incl. 16 pull) + 39 sync + 20 cloud backup + 8 privacy, all passing.

## Keep Muse in step (APPS project rule: every change is expressed in the sync repo)
- **Every change to the app must show up in the private `LEDGER-sync` repo so Muse connects
  fully.** Data the app keeps goes in `ledger-sync.json` (sync code in `js/10-start.js`, merge
  by id, tests in synctest.js). What changed and how it works goes in `MUSE.md`'s "What's
  changed in Ledger" list, one line per version, same push. Phone-only on purpose (say so in
  MUSE.md): the token, settings, look/sound switches, caches, undo steps.
- Muse reads `MUSE.md` in the private `LEDGER-sync` repo (what the file holds, how Ledger
  counts money, how to edit it, and how Muse should mark its own app changes).
- Any change to the synced data (a new field, category, account type or investment entry kind)
  or to how money is counted (spending, income, You keep, net position) must update
  `LEDGER-sync/MUSE.md` in the same go, plus `_source/SYNC.md` and `synctest.js` if the file
  format changed. Every release, set MUSE.md's "Matches Ledger" line to the new version.
- Only ever touch `MUSE.md` there: `ledger-sync.json` belongs to the phone and Muse.

## Gaps to know about (Nov 2026)
- **Live version is v72** (pull down to refresh). The handover covers everything up to v72 (v65 was the move to GitHub Pages; v66 added Sync with Muse, see `_source/SYNC.md`).
- The handover's old "non-negotiable rules" mention zips and Netlify. The setup above replaces them.
- History was rewritten on 23 Nov 2026 (Bailey's OK) to remove his name, employer and town from
  old commits. Commit ids before that date changed.
- "Sound board 2" mentioned below was deleted in the Nov 2026 clean-up.

## Mockups and demos: one page per app
- All design ideas, mockups and demos for Ledger go on ONE artifact titled "Ledger designs".
  Update that same page every time (republish to its link). Never make a new one.
- Its link: https://claude.ai/artifact/A7Y1QSjHBbTxBFJz5HKJtv (slug 49cbd1bc-8fca-45cc-85d1-c063e3183e37).
  Published from files: `index.html` + `img/*.jpg` (real screenshots of the build, made-up test data).
- On it now: v69's new screens (payday, pots, calendar) and the 8 sounds Bailey picked (v70).
- Old ideas get replaced on the page, not kept. Decisions go in the handover instead.

@_source/LEDGER_handover.md
