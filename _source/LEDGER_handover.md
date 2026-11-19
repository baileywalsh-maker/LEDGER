# Ledger: handover and brief for the next round

Attach `ledger_v55.zip` (the app) and `ledger_tests.zip` (the test suite).

## What Ledger is
My own money tracker. It mirrors where my money is and where it goes. It never
holds money or makes payments. Single-file PWA (index.html + sw.js + manifest +
icons), deployed by dropping the zip into Netlify, run from my iPhone home screen.
All data lives in the phone's localStorage under `ledger:*` keys.

Current version: **v55** (service worker cache `ledger-v55`). About 9,300 lines.
I use it on **Sundays** for the weekly check-in.

## Non-negotiable rules
1. Never wipe or break saved data. Every update must read whatever is on my phone.
   New fields are additive only.
2. Plain, simple language. Short answers. Number every list of options in one
   running sequence so I can reply "do 1, 3". Add dot-point summaries.
3. Deliver the deploy zip and the raw index.html with every build.
4. Show a demo (screenshots) with every big change.
5. Test before shipping. Netlify deploys cost credits. Run the test suite.
6. Never paste API keys in chat.

## What's built (decisions already made)
- Look: matches COACH. Page #0a0b0e, cards #121419, raised #1a1d23, hairline
  #1f232a, Manrope text, Sora numbers, 24px cards, gold accent #d9b44a.
- Top tabs Ledger / Spending / Assets. Gear opens Settings. Fixed Add + Import bar.
  Backup pill top-left (green Safe / amber when due).
- Loading screen on open (LEDGER, gold line, "Every pound, accounted for").
- Home: net position card, swipeable Freedom card (bars view and gauges view;
  "You keep" % and runway months against targets I pick: keep 20/30/40/50%,
  runway 3/6/9/12 months), Sunday check-in card, needs-sorting alert, due soon,
  accounts, recent (grouped by day, category dots), history.
- Sunday check-in: one guided flow. Import → sort new shops → asset values →
  balance check → backup → Week closed summary. Skip on every step, X keeps my place.
- Sort list: tap a category chip and the row disappears. Remembers the shop as a
  rule. Undo toast. Other / Other money in / Transfers require a note.
- Sounds (synthesised in code): arcade coin (net worth up), big book closing
  (check-in done), typewriter (import), pencil tick (spending), safe dial (backup),
  soft two-note drop (over budget), wood click (taps), coins + chime (each £10k).
- Settings: six tappable groups (Every week, Set up, Currency, Sound and feel,
  Your data, Fix things). No undo row, no rate buttons. Second currency rate
  refreshes itself daily.
- Backup: share sheet → Save to Files → same iCloud folder → Replace. Only counts
  once actually saved.
- Wise CSV import: columns and currency conversion automatic.

## Parked: do NOT build unless I ask
- Excluding the Transfers category from "You keep" income
- Treating Hyperliquid as an asset (deposits vs trading P&L)
- Investment History (Coinbase, "I sold this" button)
- Selling the apps (they are personal-use only)

## Brief: how to make Ledger better, aesthetically and operationally
Look at the app yourself first (run it with the test data), then propose a
numbered list. Ideas to weigh, not orders:

Aesthetic
1. Home is long. Consider what earns a place above the fold on a Sunday vs a
   weekday, and what could fold away.
2. Two icon systems are mixed (an icon font and inline SVGs). Unify on one.
3. Motion: count-up on big figures, consistent sheet/step transitions, the
   Freedom bars animating in. Keep it subtle and respect reduced-motion.
4. Spending tab: a clear this-month vs last-month comparison.
5. The app icon and splash still predate the new look.
6. The sounds are code-made. Real recorded, free-to-use samples (e.g. Kenney CC0
   packs) would sound far better if they can be embedded small.

Operational
7. The single 9,300-line file is hard to change safely. Consider a source split
   with a build step that still outputs one index.html.
8. A schema version and a small migration step on load, so future data changes
   are explicit and tested.
9. Check a backup file is valid before restoring it, and show what's inside first.
10. Performance at scale: render() redraws everything on every change. Measure
    with a few thousand transactions before optimising.
11. Keep the test suite growing with every change, and run it before every build.


---

## v56 update (latest)

Current version is **v56**. Everything above still holds; this is what changed.

- **Source is split.** `ledger_source_v56.zip` holds `src/` (42 parts), `build.js` (glues them into one `index.html`, refuses to build if the script has an error) and `tests/run-all.sh` (173 checks). Still ships as one file. See its README.
- **Data version.** `ledger:schema` = 1. A small step runs once on load and on restore; it only adds or repairs (wrong-shaped lists, text amounts, rows with no date are left out). Untouched originals are kept in `ledger:premigrate` before any rewrite. Data from a newer build is left alone.
- **Restore preview.** Picking a backup shows what is in the file next to what is on the phone, warns if it is older, blocks files from a newer build. Undo is on the toast.
- **Speed.** With ~4,500 transactions at 4x slower CPU: Home 354 to ~80ms, Assets 1,132 to ~25ms. Balances are worked out once per redraw (`memo`), never kept between redraws.
- **Home folds.** Order: hero, check-in, sorting alert, Freedom, Due soon, Accounts, Recent (5), History (folded, 6 months then "older"). Fold state is in `ledger:homefold` (a phone preference, not in backups).
- **One icon set.** Icon font removed; `tools/make-icons.js` generates `src/css/02-icons.css`.
- **Motion.** Figures count, bars fill once, views fade. Off with Reduce Motion.
- **Spending.** "This month vs last" card, both to the same day, plus biggest category changes.
- **App icon** redrawn (`tools/make-icon.js`). iPhone only shows it after removing and re-adding to the Home Screen.
- **Sounds: unchanged.** Real recordings are still unreachable from the workspace. Sound board 2 offers 45 CC0 designed sounds (UI SFX pack) numbered 21 to 65 to pick from.
- Still parked: 35, 36, 37.


---

## v57 update (latest)

- **Investments:** Crypto and Stocks on the Assets tab. Each has its own page: worth now, all-time result, a value chart (3M/1Y/All, your investment value only), put in, taken out, profit from sales, not yet sold, rewards (dividends for stocks), fees, holdings, by year, past coins. Each coin has its own page with the same plus "I bought more" / "I sold some" and its full history (staking grouped by month).
- **Coinbase:** drop the transaction history CSV into Import (main button, the Crypto page, or the Sunday check-in). Only new entries are added. Converted to pounds at each day's rate; if offline, a stand-in rate is used and corrected later.
- **Prices:** live price from Coinbase's public price feed; daily history from Coinbase's public daily prices, fetched once and kept in `ledger:invpx`. Not testable from the build workspace (no internet) — falls back to prices from your own trades.
- **Net worth and Holdings** now include investments. A hand-logged asset that is really crypto/stocks can be marked "In Crypto"/"In Stocks" in its sheet so it is not counted twice (kept, not deleted).
- **Sunday check-in:** step 3 is now "Update your investments" with the Coinbase import.
- **Backups** carry investments; older backups without them leave what is on the phone alone. Undo covers them too.
- **Stocks:** waiting for Bailey's Pearler history file to build its importer.
- Still parked: excluding Transfers from "You keep", Hyperliquid as an asset.


---

## v58 update (latest)

- **Investment categories are yours:** add (Assets → Investments → Add), rename, change type (Crypto / Shares and funds / Something else) or delete (with Undo). Stored in `invest.cats`; Crypto and Stocks are the defaults.
- **Every category page:** Import file and Add by hand; Edit top right. Every holding: I bought more, I sold some, Update value (non-crypto), Rename. Every history line: tap to edit or delete.
- **Any broker file** (for Pearler etc.): columns matched by name, changeable, currency picked (AUD guessed for Australian brokers), preview before adding, duplicates skipped. Original currency amounts kept on each entry.
- **Edit links where things are shown:** Home → Accounts "Edit", Spending → By category "Edit", spending categories can be renamed and recoloured.
- **Holdings total** now lists what it is made of (each category + logged by hand).
- **Sunday check-in:** a card per investment category (import + value boxes for holdings without live prices).
- Older Coinbase file layouts (single-row converts, "Spot Price" headers) are read too.
- Saves can no longer be lost to a full phone: the price cache is dropped first, then old undo steps.
- Open question: Bailey saw SOL and ETH missing on his phone. His file shows all three here (online, offline, after reopening, and in the older layout) — waiting on his backup or a screenshot to find the cause.


---

## v59 update (latest)

- **No second list:** hand-logged assets move into investment categories with one tap ("Put these in your categories"). Guesses the category and code (BTC/ETH/SOL → Crypto, others → Stocks), all changeable. If the holding already exists (from a file), the hand value becomes today's value; otherwise it becomes a new holding tracked by value (`invest.byValue`), carrying its full history. Old asset records are kept, marked `movedTo`, never counted. Undo straight after.
- **Edit what you hold** on every holding: how many and what it is worth. Writes an "Amount corrected" entry (at average cost, so no fake profit) and/or a "Value update" entry, both editable in history. Saving unchanged writes nothing.
- **Sunday step "Check everything you own":** every holding in every category, with how many and worth now; only changes are saved.
- **Add an asset** now asks which category.
- Bailey re-added SOL and ETH by hand on his phone (13 Nov) — moving them in uses his hand values.

---

## v60 update (latest)

- **Pearler file read properly.** Bailey's Pearler export ("ongoing transaction statement") is a cash statement: Action / Description / Value / Currency / Date ("21st November 2025, 08:06 p.m.") / Running Balance / Is Pending. No share codes or amounts. Ledger now recognises any such statement and adds deposits as money in and withdrawals as money out (kinds `deposit`/`withdraw` inside the category; never a holding). Transfers between his own cash accounts, the A$6.50 moves and rewards are left out (rewards are already inside the withdrawals).
- Per-share history would need Pearler's trade/order history (US cash account), if Pearler offers it.
