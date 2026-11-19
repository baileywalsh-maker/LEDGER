# Ledger sync with Muse — v66

## The shape of it

The phone and Muse never talk to each other directly. They share one file:

- **Private repo:** `baileywalsh-maker/ledger-sync` (private — Bailey creates it;
  Muse's GitHub App cannot create repos, it can only write to repos it is
  installed on, so Bailey also installs the Muse GitHub App on it)
- **File in it:** `ledger-sync.json`
- **Phone side:** Ledger reads/writes that file with a token Bailey pastes into
  Settings → Your data → Sync with Muse (see below)
- **Muse side:** Muse reads/writes that same file through the GitHub
  connector (`get_file_contents` / `create_or_update_file` on
  `baileywalsh-maker/ledger-sync`)

The **public** `LEDGER` repo holds the app code only. It never holds
transactions, backups, tokens or any personal money figures. The sync file
format and the token rules are the whole privacy story — read them before
touching sync.

## The file

```json
{
  "__ledgerSync": 1,
  "version": 12,
  "updatedAt": "2026-11-19T15:50:00.000Z",
  "updatedBy": "phone",
  "schema": 1,
  "txns": [ { "id": "...", "date": "2026-11-19", "amount": 18.45, "dir": "out",
              "acct": "wgbp", "toAcct": null, "desc": "Tesco", "cat": "groceries",
              "upd": 1730000000000 } ],
  "budgets": { "groceries": 450 },
  "cats": [ { "id": "groceries", "name": "Groceries", "kind": "spend", "colour": "#4aa87a" } ],
  "rules": [ { "match": "tesco", "cat": "groceries" } ],
  "accts": [ { "id": "wgbp", "name": "Wise GBP", "type": "current", "opening": 1800, "openingDate": "2026-05-23" } ],
  "assets": [ { "id": "a1", "name": "Index fund", "initial": 4000, "initialDate": "2026-06-01",
               "contribs": [], "values": [{ "date": "2026-11-17", "value": 5900 }] } ],
  "recur": [ { "id": "r1", "name": "Spotify", "amount": 11.99, "cadence": "monthly",
              "nextDue": "2026-12-19", "acct": "wgbp", "cat": "subs" } ],
  "invest": { "trades": [ { "id": "...", "ext": "cb:1", "src": "coinbase", "cat": "crypto",
                           "date": "2026-11-09", "ts": "2026-11-09 12:00:00", "sym": "BTC",
                           "kind": "buy", "qty": 0.01, "gbp": 500 } ],
             "cats": [ { "id": "crypto", "name": "Crypto", "type": "crypto" } ],
             "byValue": {} },
  "impmap": { "cols": { "date": 0, "amount": 1 }, "fmt": "ymd" }
}
```

What syncs: transactions, monthly budgets, categories, sort rules, accounts,
hand-logged assets, subscriptions/bills, investments (trades, investment
categories, tracked-by-value flags) and the remembered CSV column mapping.
What NEVER syncs, and never leaves the phone: the live price caches
(`ledger:invpx` and `invest.prices` — refetched from the price feed), settings
(display currency, Freedom targets, dismissals), the undo stack, the
pre-migration copy, the backup marker, and COACH's half of the shared backup
(COACH gets its own sync later). Ledger never holds bank logins or credentials
at all — money only arrives as a CSV Bailey downloads himself — so there is
nothing of that kind to leak. What does leave the phone is transactions and
balances, to a private repo only Bailey and Muse can see.

## The token (phone side)

- Bailey makes a **fine-grained personal access token** in GitHub:
  Settings → Developer settings → Personal access tokens → Fine-grained
  tokens. Repository access: **only `baileywalsh-maker/ledger-sync`**.
  Permissions: **Contents — Read and write** only. Nothing else.
  No expiry is convenient; 90 days is safer — if it expires, sync just
  stops and Settings says the token was not accepted.
- He pastes it into Ledger → Settings (gear) → Your data → Sync with Muse
  → token field.
- It is stored in `localStorage` under `ledger:sync-token` only. It is never
  written into the app code, never included in a backup (the backup builder
  never reads that key — a test checks this), and only ever sent to
  `https://api.github.com`. Revoking it in GitHub stops syncing instantly.
- Muse **never sees the token** and must never ask for it. If Bailey says
  sync stopped working, the first thing to check is whether the token
  expired or was revoked — Settings will say "GitHub did not accept the
  token".

## How the phone syncs

- Off by default (`settings.syncEnabled`). Switching it on shows the token
  box and a Sync now button. Status line says Off / no token yet /
  Last synced … / Last sync failed: …
- **Auto:** on opening the app (2s after load), ~8 seconds after any change,
  and when the app is hidden/closed (best effort).
- **Manual:** Settings → Your data → Sync now.
- **Merge (three-way, by id):** the phone keeps a snapshot of the data as
  it was at the last good sync (`ledger:sync` in localStorage).
  Something changed on one side only is taken from that side. Something
  added on either side is kept. Something deleted on one side and unchanged
  on the other is deleted. A transaction or investment trade changed on
  **both** sides keeps the copy with the later `upd` (stamped on every save
  while sync is on). Anything else changed on both sides keeps this phone's
  copy. Every both-ways clash is listed in Settings ("kept the newer copy"
  / "kept this phone's"). Nothing is ever deleted silently outside that rule.
- **Conflicts with GitHub itself:** if the file changed under the phone
  (HTTP 409 on PUT), the phone re-fetches, re-merges and retries once.
- **Failures are quiet and safe:** no token, bad token (401/403), offline,
  or a bad file all leave the phone's money exactly as it is and say so in
  Settings. A failed sync never wipes local data.

## How Muse adds / edits / deletes (Muse's instructions)

1. Read the current file from the private repo:
   `get_file_contents` on `baileywalsh-maker/ledger-sync`, path `ledger-sync.json`.
   If it is a 404, there is nothing synced yet — tell Bailey to open Ledger
   and tap Sync now once, then try again. Do **not** invent a file.
2. Decode the base64 content. Keep everything exactly as it is, except the
   change Bailey asked for. Never add keys that are not in the file already —
   no `settings`, no `prices`, no `carry`, no `rollback`, no token.
3. To **add a transaction**, first check it is not already there: a
   transaction is a duplicate when another one has the same
   `date|amount.toFixed(2)|desc (lowercase, spaces removed, first 24 chars)|acct`.
   If it matches, do not add it — tell Bailey it is already in Ledger.
   Otherwise append:
   `{ "id": "<uid>", "date": "YYYY-MM-DD", "amount": <pounds, positive number>,
      "dir": "<out|in|transfer>", "acct": "<an existing account id from the file>",
      "toAcct": "<for a transfer, the other account id, else null>",
      "desc": "<Bailey's words>", "cat": "<an existing category id, or null>",
      "upd": <now ms> }`.
   Use `uid()` style ids: `Date.now().toString(36) + random 5 chars` — never
   reuse an id. If the category or account is unclear, ask Bailey — do not
   invent a category id or an account id. Amounts are pounds, always positive;
   `dir` carries the direction. Do not set `imported`.
4. To **delete a transaction**: remove that one object from `txns` and nothing
   else. To **edit** one (amount, category, description): change the field
   and set `upd` to now. To **change a monthly budget**: set
   `budgets[<category id>]` to the new monthly pounds figure; delete the key
   to remove the limit. Leave every other section untouched unless Bailey
   asked to change it.
5. Bump `version` by 1, set `updatedAt` to now (ISO), `updatedBy` to
   `"muse"`.
6. Write it back with `create_or_update_file` on the same repo/path,
   passing the `sha` from step 1 and a message like
   `Ledger sync: add "Tesco £18.45"`. If the write fails with a sha conflict,
   re-read the file and redo the change on the fresh copy — never
   overwrite blindly.
7. Tell Bailey it is synced and that it will appear in Ledger the next time
   he opens it (or immediately if Ledger is open — the phone auto-syncs on
   open and ~8s after its own edits; it does not poll while open, so if
   Ledger is already open, ask him to close and reopen it, or tap
   Sync now in Settings → Your data).

## Limits (say these plainly, don't paper over them)

- Sync is **transactions, budgets and the rest of the Ledger data above**.
  It is not a bank connection: nothing here moves money, and the weekly
  Wise CSV import still happens in Ledger on Sundays as before.
- The phone does **not** poll while open. Something Muse adds shows up when
  Ledger is next opened, or after a manual Sync now — not live while Bailey
  stares at the app.
- If Bailey edits a transaction on the phone and Muse edits the same one
  before the phone syncs, the newer copy wins and the older edit is lost.
  The phone reports this in Settings; Muse cannot see it happened.
- If two phones ever shared one token, last-write-wins per transaction still
  applies, but the snapshot logic assumes one phone. Ledger is one phone.
- The token is a bearer credential on the phone: anyone with the phone
  unlocked and the token could read/write the private repo. That is the
  same trust level as the phone itself. Revoke the token if the phone is
  lost.

## Tests

`NODE_PATH=<path to playwright> node _source/tests/synctest.js` — 34 checks
against a pretend GitHub (fake `api.github.com` route): off by default, Muse
transaction pulled on open, phone transaction pushed, delete propagates,
merge rules, both-ways conflict keeps newer + is reported, budgets merge,
bad token fails cleanly, token never in backup or in the synced file, price
cache never syncs, `upd` stamping. Full regression: `node functest.js`
(stored data identical to the previous build after opening), `citest.js`,
`settingstest.js` in the same folder.
