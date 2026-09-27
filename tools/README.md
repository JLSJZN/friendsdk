# Rare Breeds tools

Run everything from the SDK root (`friendsdk/`) with Node 22.18+. The tools use the checked-in
`dist/` build and the SDK's own CLI, runtime and test fixture. Nothing here pushes, publishes or signs.
Mocked wallets exist only inside the automated browser runs, never in a build.

## Commands

| Task | Command | Notes |
| --- | --- | --- |
| Unit tests | `node --test "games/rare-breeds/tests/*.test.ts"` | Node strips types natively. A bare directory (`node --test games/rare-breeds/tests/`) fails on Node 22 with `MODULE_NOT_FOUND`; use the glob. |
| Typecheck | `npx tsc -p games/rare-breeds/tsconfig.json` | Bundler resolution (JSON imports work), `.ts`/`.tsx` extension imports, `verbatimModuleSyntax` + `erasableSyntaxOnly` so pure modules also run under Node type stripping. SDK imports resolve through the package `exports` to `dist/*.d.ts`, like `examples/tsconfig.json`. `tests/` is excluded: the SDK has no `@types/node`. |
| SDK game check | `node scripts/dev-game.mjs check games/rare-breeds` | Schema, README, import boundary. |
| Browser test | `node tools/test-game.mjs` | SDK `testGame` at 960x800 and 390x844 (touch). Screenshots: `docs/media/test-desktop-960x800.png`, `test-phone-390x844.png`. Runs `export test` of `tools/scenarios/rare-breeds.mjs`. Flags: `--scenario file`, `--no-scenario`, `--viewport desktop\|phone`, `--media dir`, `--timeout ms`. |
| Economy report | `node tools/economy-report.mjs` | Exact table and math, then a Monte Carlo on the SDK's own `createGamePreview` ledger. Games with `src/slingshot.ts` add a Moon Slingshot section (exits table with crash odds and payouts, Moon Fund rule, a trade-in-flow Monte Carlo per exit strategy next to the exact identity E[net] = -0.1 x E[staked]). `--sessions 5000 --seed 7730`. |
| Gameplay video | `node tools/record-video.mjs` | 960x640, reduced motion off. Writes `docs/media/gameplay.mp4`, `gameplay.gif` (640 px, 12 fps), `gameplay-poster.png`. Runs `export video` of the scenario. Flags: `--name`, `--scenario`, `--keep-intro`, `--keep-webm`, `--no-mp4`, `--no-gif`, `--gif-width`, `--gif-fps`. |
| GitHub Pages folder | `node tools/build-pages.mjs --smoke` | CLI `check` + `build`, copies the output to `.friendsdk/site/` (already gitignored), adds `.nojekyll`, verifies `./` relative paths and the child CSP. `--smoke` serves it under `/rare-breeds/` with plain static headers and boots it with the test fixture. `--out dir`, `--base repo-name`. |
| Local play (real wallet) | `node scripts/dev-game.mjs dev games/rare-breeds` | `npm run dev:game` would rebuild the SDK first. |

Other files: `fetch-wild-friends.mjs` (wild mate snapshot) and `genetics-sheet.mjs` belong to their owners.
`tools/scenarios/starter.mjs` drives the SDK starter UI and proves the confirmation helpers:
`node tools/test-game.mjs examples/starter --scenario tools/scenarios/starter.mjs`.

## Economy (`games/rare-breeds/game.json`)

Egg price 1 RF (`1000000000000000000`). outcomeId = index + 1 = `TIER_ORDER` position.

| outcomeId | Outcome | bps | Chance | Sanctuary value | EV share |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Common hatchling | 6000 | 60% (3 in 5) | 0.5 RF | 0.3 RF |
| 2 | Spotted hatchling | 2500 | 25% (1 in 4) | 1 RF | 0.25 RF |
| 3 | Mutant hatchling | 1250 | 12.5% (1 in 8) | 1.5 RF | 0.1875 RF |
| 4 | Prismatic hatchling | 250 | 2.5% (1 in 40) | 6 RF | 0.15 RF |

- EV = (0.5 x 6000 + 1 x 2500 + 1.5 x 1250 + 6 x 250) / 10000 = 8875 / 10000 = **0.8875 RF per egg**
  (`887500000000000000`, 88.75% return, 11.25% house edge). Exact over all 10000 rolls.
- Max prize 6 RF: every purchased or pending egg reserves 6 RF of backing.
- Preview ledger (`GameHost`, `dist/game-host.js`): stake = max prize x 10 = **60 RF**, balance **20 RF**.
  First egg: freeStake 60 >= 6 and 60 + 1 >= 6, so eggs are buyable from the first second.
- freeStake after n hatches = 60 + sum(1 - reward). Selling does not change it (stake and liability drop together).
  Purchases pause only after 11 Prismatic hatches in a row (p = 2.4e-18). Unhatched eggs also reserve 6 RF each:
  at the start 12 fit in one bulk `buy(12n)`, or 11 bought one at a time.
- Hatches from 20 RF: keep everything = exactly 20; sell only Commons = at least 20, mean 28.1; sell everything =
  at least 39 (all Common), mean 173.7 (5000 simulated sessions each). P(at least one Prismatic in 20 hatches) = 39.7%.

### Moon Slingshot (`games/rare-breeds/src/slingshot.ts`, simulated side ledger)

A launch first trades the baby in through the SDK (`client.redeem(outcomeId, 1n)`, runtime-confirmed: tier token burned,
its fixed value lands in the spendable RF balance). That value is the stake. The baby then rides a rocket like the casino
game Crash: while the player holds, the multiplier climbs as floor(100 x 10^(t / 9 s)) hundredths (x2 at 2.71 s, x10 at
9 s); letting go jumps. One roll in 0-9999, drawn at ignition, fixes the crash point C = floor(900000 / (roll + 1))
hundredths (capped at x10): a jump at h pays stake x h when C >= h, else x0 (the pond); x10 jumps onto the Moon by itself.
The simulated side ledger books only payout minus stake (the net, `slingshotNet`), which is not spendable. Proven exactly
in `games/rare-breeds/tests/slingshot.test.ts`.

| Exit | Winning rolls | Chance | Payback | Common 0.5 | Spotted 1 | Mutant 1.5 | Prismatic 6 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fizzles on the pad | none (9000-9999) | 10% | x0 | 0 | 0 | 0 | 0 |
| Jump at x1.5 | 0-5999 | 60% | x0.9 | 0.75 | 1.5 | 2.25 | 9 |
| Jump at x2 | 0-4499 | 45% | x0.9 | 1 | 2 | 3 | 12 |
| Jump at x4 | 0-2249 | 22.5% | x0.9 | 2 | 4 | 6 | 24 |
| Moon, auto jump at x10 | 0-899 | 9% | x0.9 | 5 | 10 | 15 | 60 |

- P(C >= h) = floor(900000 / h) / 10000 for every h, so always jumping at h pays back h x floor(900000 / h) / 10^6 of the
  stake: exactly **x0.9** at the round exits (exact over all 10000 rolls), never more, at least x0.899 (x9.73). The
  expected net per launch is -0.1 x stake at the round exits.
- Launch every baby and jump at a round exit: trade-in 0.8875 RF (spendable) + net -0.08875 RF (side ledger) =
  **0.79875 RF per egg** in total (exact over all 10^8 egg and crash roll pairs).
- Moon Fund starts at 10 x the top Moon payout (6 RF x10 = 60 RF) = **600 RF**, the preview-stake convention. A baby worth v
  flies only while fund >= 10 v, whatever exit the player picks. The stake joins the fund: fund' = fund + v - payout >= v,
  so the fund never goes negative, and fund = 600 RF - net at all times. The largest drain is 54 RF (Prismatic on the
  Moon), so the first 11 launches can never be blocked; 11 Prismatic Moon landings in a row leave 6 RF (only Commons fly).
- Monte Carlo, 5000 sessions per exit strategy from 20 RF (breed while the runtime sells an egg, trade in and launch every
  baby): hatches and launches equal the "sell every baby" strategy (mean 173.7), mean staked 154.24 RF, so E[net] =
  -15.42 RF. Simulated mean net: -15.47 (jump at x1.5), -15.42 (x2), -15.22 (x4), -15.20 RF (ride to the Moon); P(net > 0)
  10.8%, 18.6%, 28.4%, 33.3%; Moon Fund lowest 569.5, 539.5, 465.5, 322.5 RF; it never blocked a launch.

## Runtime confirmations (preview mode)

`buy`, `play` and `redeem` each open a trusted confirmation. It renders in the **runtime page**, not in the
game iframe, as `.rf-frame-scrim > .rf-frame-menu[role=dialog][aria-modal=true]` named by its `h2` title:

| Call | Dialog name | First line | Amount line |
| --- | --- | --- | --- |
| `client.buy(1n)` | `Buy egg` | `1 egg for Friend #7730.` | `1 RF` |
| `client.play(1n)` | `Use egg` | `Use 1 egg from Friend #7730.` | none |
| `client.redeem(4, 1n)` | `Redeem reward` | `1 Prismatic hatchling; simulated RF returns to this Friend.` | `6 RF` |
| `client.settle(id)` | no confirmation in preview (`Resolve result` in chain mode) | | |

Then `Friend #7730` and `Simulated RF. No transaction will be sent.` Buttons: `Cancel` and `Confirm preview`
(`Confirm` in live mode), plus `×` labelled `Close Buy egg`; Escape cancels. Playwright:

```js
await page.getByRole("dialog", { name: "Buy egg", exact: true })
  .getByRole("button", { name: "Confirm preview", exact: true }).click();
```

Use `page`, not the `game` frame locator. While a dialog is open the frame chrome is `inert` and the game
receives `paused = true`; it flips back after each dialog (a buy then play then settle chain works without
waiting). Cancel rejects the SDK call with `Game action cancelled.`. The bridge runs one action at a time
(`Another game action is pending.`) and refuses mutations while a runtime menu is open
(`Close the host menu before playing.`). At 390 px the dialog covers the whole 390x260 frame.
Helpers: `helpers.confirm("buy" | "play" | "redeem")`, `helpers.cancel(...)` in `tools/lib/runtime.mjs`.

## Test fixture (`scripts/browser-fixture.mjs`)

- Mock EIP-1193 wallet (owner `0x1111...1111`), mock Robinhood RPC (chain `0x1237`), Friend **#7730**
  (canonical wallet `0x3333...3333`). The runtime still runs its real eligibility gate and sandbox.
- Sprites: `page.route` answers the FamiliesRegistry `eth_call`s, including those made from the sandboxed
  child: `familyOf(7730) = 5` (Hoverer), `seedOf(7730) = 7730`, `frames(5, 7730)` = the 64 recorded frames in
  `examples/fishing/sample-sprites.ts`. So `createFriendReader().read(7730n)` works (verified: Hoverer, 64 frames).
  Any other token ID fails the assertion and the test ("Game browser errors"): wild mates must come from
  `data/wild-friends.json`. Any other external URL is aborted; WebSockets are rejected.
- The init script runs in every frame, the game iframe included: `crypto.getRandomValues(new Uint32Array(1))`
  always returns 1500 there (other lengths and `Math.random` stay random). The ledger draws one such value per
  settle, so every harness hatch is roll 1500 = **Common** unless a scenario queues rolls with
  `{ tiers: ["prismatic"] }` / `helpers.forceTiers` (patches the runtime page only).
- `testGame` forces `reducedMotion: "reduce"`; touch below 500 px. The game document measures 958x638 at
  960 wide and 388x258 at 390 wide. `record-video` uses the same fixture with reduced motion off.

## Scenario steps (`tools/lib/runtime.mjs`)

A scenario exports `test` and/or `video`: an array of steps or `async ctx => {}` (`ctx`: `page`, `game`,
`viewport`, `definition`, `helpers`). Targets: `"exact text"`, `{ role, name }`, `{ text }`, `{ label }`,
`{ css }`, `{ testId }`, with `in: "page"`, `within: css`, `nth`; string names match exactly, RegExp partially.

`{ click }` `{ tap }` `{ hover }` `{ focus }` `{ world: [x, y] }` (canvas click/tap in 960x640 logical space)
`{ key, hold }` `{ down, via }` `{ up }` (press and hold a target, then let go: touch on touch viewports, else mouse, or `via: "key"`)
`{ type }` `{ wait: ms }` `{ waitFor, state }` `{ expect, contains | matches }`
`{ confirm: "buy", expect: { description, amount } }` `{ cancel }` `{ tiers: [...] }` `{ rolls: [...] }`
`{ screenshot: "name" }` `{ run: async ctx => {} }` `{ log }`; any step may add `only: "desktop" | "phone"`.
`tools/scenarios/rare-breeds.mjs` runs a smoke check until the `Find a match` button exists, then two full
hatch loops (Spotted kept, Prismatic kept with its one-time "can pass on" tip, then sent to the Sanctuary, HUD shows
24 RF), the Hearts shop and a hat, and a
Moon Slingshot launch of the kept baby (one cancelled trade-in, then a confirmed one; hold **Hold to fly** for 2.4 s with a
real mouse or touch press, let go, Skip, result card with the crash point; HUD shows 25 RF).

## GitHub Pages (manual)

`node tools/build-pages.mjs --smoke`, then copy the **contents** of `.friendsdk/site/` (with `.nojekyll`)
to the root of a `gh-pages` branch, enable Pages from that branch and `/ (root)`, and open
`https://<account>.github.io/<repository>/` with a wallet on Robinhood mainnet holding a hardwired Friend.
