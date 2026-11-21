# Ledger test suite (built against v55)

Headless Chromium + Playwright. Each script loads the app with fake v49-shaped
data (`seed.js`) and clicks through it like a person would.

Layout expected:
  ../app/index.html            the build under test
  ../app-previous/index.html   the last deployed build (functest compares stored data between the two)
  ../shots/                    screenshots land here

Run:  NODE_PATH=$(npm root -g) node functest.js   (and the others)
Every line should start PASS; "errors: []" means no console/page errors.

- functest.js     tabs, gear, search, import a Wise CSV, re-import adds nothing, fresh install,
                  and saved data identical to the previous build after opening
- soundtest.js    every sound fires on the right event, one at a time, switch works
- citest.js       the whole Sunday check-in end to end, skip/resume, the sort list
- montest.js      month review waits for the check-in
- memotest.js     notes required for Other / Transfers
- settingstest.js Settings groups, freedom targets, automatic rates, loading screen
- frtest.js       the swipeable Freedom card
- compacttest.js  v68 compact look: each trimmed part hidden at first, opens/closes on a tap, remembered; nothing lost
- privacytest.js  this repo is public: no tokens, backups, data files, real names (run before every push)
- synctest.js     Sync with Muse: fake GitHub, off by default, Muse entry pulled, phone entry pushed, delete propagates, merge rules, bad token, token never in backup or synced file, price cache never syncs

Note: dates are relative to "today". citest forces an old backup date so the
backup step always appears.
