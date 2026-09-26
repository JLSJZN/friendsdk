# Rare Breeds

> Your Friend's 256 on-chain pixels are its DNA.

A FriendSDK **v0.1.2** game. Your verified Rare Friend picks a mate from real Rare Friends,
an egg hatches, and the baby inherits whole pixel rows from both parents, walk cycle included.
Kept babies follow you around the nursery in a line and can become parents themselves (F1, F2, F3).
**All RF, eggs, outcomes and payouts are simulated.** The wallet, the NFT ownership check and the
character art are real.

![Rare Breeds gameplay](docs/media/gameplay.gif)

## How to play

1. **Nursery.** You walk as your own Friend. Kept babies follow you.
2. **Matchmaker** (left station, or the **Find a match** button). Parent A is your Friend or one of your
   babies. Parent B is one of three real wild Friends, or another baby from your brood. **New faces** rerolls
   the three wild Friends for free.
3. **Breed.** Uses one Egg. With no egg waiting, the button reads **Buy egg & breed · 1 RF** and buys one first.
   The runtime shows its own confirmations (**Buy egg**, then **Use egg**). A wild mate walks in first, then the
   egg wobbles, cracks, both parents' rows fly in and merge, and the baby is revealed.
4. **Result card.** Name, tier, parents, a DNA strip (16 rows, coloured by parent, with row counts) and traits.
   **Keep** it (it joins the brood) or **Send to Sanctuary** for its fixed Simulated RF value (runtime
   confirmation **Redeem reward**).
5. **Breed again.** Any kept baby can be parent A or B. A baby's generation is one more than its older parent.

The **Egg incubator** (centre station) sells 1, 3 or 5 eggs in one confirmation. The **Sanctuary** (right
station) opens your brood, where you can inspect, breed or send any baby. **?** in the top-right corner
shows how to play, the exact odds and the settings.

## Controls

| Action | Keyboard | Touch or mouse |
| --- | --- | --- |
| Walk | WASD or arrow keys | Tap or click the floor; drag to steer |
| Use a station | E, Enter or Space when its prompt shows | Tap the prompt, or tap the station (your Friend walks there and opens it) |
| Hop (Friend and brood) | Space or E away from a station | Tap your Friend |
| Open a baby | Brood button (bottom centre or HUD counter) | Tap the baby in the world |
| Panels | Tab / Shift+Tab, Enter or Space, Escape closes | Tap; tap outside to close |
| Hatch animation | Escape or **Skip**; on the result card Escape means **Keep** | **Skip** |
| Sound, help | HUD buttons, top right | HUD buttons, top right |

The bottom-left and bottom-right corners stay free for the SDK runtime's wallet/Friend control and menu.
The world pauses while a panel, the hatch or a runtime confirmation is open, and whenever the runtime
sets `paused`.

## Rules and rewards

Source of truth: [`game.json`](game.json). One Egg hatches exactly one baby. The tier (outcome) is decided by
the SDK ledger when the egg is settled. Which parents you pick never changes the odds.

| outcomeId | Outcome | Weight | Chance | Sanctuary value | Base units | EV share | Look |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Common hatchling | 6,000 bps | 60% (3 in 5) | 0.5 RF | `500000000000000000` | 0.3 RF | Pure ink rows from both parents |
| 2 | Spotted hatchling | 2,500 bps | 25% (1 in 4) | 1 RF | `1000000000000000000` | 0.25 RF | Green spots, stripes or a patch |
| 3 | Mutant hatchling | 1,250 bps | 12.5% (1 in 8) | 1.5 RF | `1500000000000000000` | 0.1875 RF | Violet pattern plus a head mutation (antennae, horns, ears or crest; a tail if none fits) |
| 4 | Prismatic hatchling | 250 bps | 2.5% (1 in 40) | 6 RF | `6000000000000000000` | 0.15 RF | Rainbow body, a mutation (bold when it fits) and a tail |
| | **Total** | 10,000 bps | 100% | | | **0.8875 RF** | |

| Rule | Exact value |
| --- | --- |
| Egg price | 1 RF (`1000000000000000000` base units) |
| Expected Sanctuary value | (0.5 x 6000 + 1 x 2500 + 1.5 x 1250 + 6 x 250) / 10000 = 8875 / 10000 = **0.8875 RF per egg** (`887500000000000000`): 88.75% return, 11.25% house edge |
| Maximum prize | 6 RF. Every purchased or pending egg reserves 6 RF of backing |
| Kept babies | Keep their fixed RF value reserved. Redemption has no expiry |
| Preview ledger (SDK `GameHost`) | 20 RF simulated balance; 60 RF simulated stake (6 RF maximum prize x 10) |
| Purchase rule | Free stake must cover the maximum prize before and after the purchase. At the start, eggs are buyable immediately (60 RF >= 6 RF) |
| Backing pause | Free stake after n hatches = 60 RF + sum(1 RF price - reward). Purchases pause only after 11 Prismatic hatches in a row (p = 2.38e-18). Sending a baby to the Sanctuary does not change free stake |
| Unhatched eggs | Also reserve 6 RF each: at most 12 in one purchase, or 11 bought one at a time, from a fresh session |
| Pending hatch | A used egg that has not settled shows **Finish hatching** and settles the same play. It never uses another egg |

What 20 simulated RF buys (`node tools/economy-report.mjs`: exact math, then 5,000 sessions per strategy on the
SDK's own `createGamePreview` ledger, seed 7730):

| Strategy | Hatches (minimum) | Median | Mean |
| --- | ---: | ---: | ---: |
| Keep every baby | 20 | 20 | 20.0 |
| Send only Commons to the Sanctuary | 20 (21 observed) | 28 | 28.1 |
| Send every baby to the Sanctuary | 39 (49 observed) | 143 | 173.7 |

In 20 hatches: P(at least one Prismatic) = 1 - 0.975^20 = 39.7%; P(at least one Mutant or Prismatic) = 1 - 0.85^20 = 96.1%.

## What is simulated and what is real

| Simulated (SDK preview ledger) | Real |
| --- | --- |
| RF balance, prize stake, eggs, plays, tiers, Sanctuary payouts | Wallet connection and a fresh ownership/eligibility read by the SDK runtime (Robinhood mainnet, chain 4663) |
| Every **Buy egg**, **Use egg** and **Redeem reward** confirmation ("Simulated RF. No transaction will be sent.") | Your Friend's 64 canonical frames, read on-chain through the SDK's `createFriendReader` |
| | The wild mates' art: canonical frames of 73 real Friends (see Credits) |

The game only calls the SDK's fixed action client (`read`, `buy`, `play`, `settle`, `redeem`). It has no wallet
code, sends no transactions and deploys no contracts. No trading, creator fees or wearable NFTs are implemented.

## Genetics in one paragraph

A Friend is 64 one-bit 16 x 16 frames (idle and walk, four facings, eight frames each). A baby takes each of its
16 rows from parent A or parent B, in alternating runs of 2 to 5 rows, so each parent gives at least 4 rows. The
same row mask is used for all 64 frames, which is why the baby's walk cycle is a real mix of both parents'
walk cycles. Up to 64 seeded masks are scored and the best valid one wins. Each frame is then repaired into one
8-connected body with the fewest added pixels; no inherited pixel is ever removed. Symmetric parents give
symmetric front and back views. The tier adds its pattern and mutation on top. **Side-walker** is dominant:
Colossus Friends have no front or back art, so any baby with a Colossus (or Side-walker) parent shows its
right-facing frames from every side, through every generation. Everything is deterministic from
`(your Friend ID, parent A, parent B, play ID)` and takes a few milliseconds per baby (the test budget is under 5 ms on average). See
[`src/genetics.ts`](src/genetics.ts) and [`docs/media/genetics-sheet.png`](docs/media/genetics-sheet.png).

## Run, build and test

From the SDK root (`friendsdk/`), Node.js 22.18+ (the unit tests use Node's built-in type stripping):

```sh
npm ci
npm run build                                    # builds the SDK dist/ used by the CLI and tools
node scripts/dev-game.mjs dev games/rare-breeds  # local play (npm run dev:game -- games/rare-breeds also rebuilds the SDK)
```

Open the printed URL with a browser wallet on Robinhood mainnet (chain 4663) that holds a hardwired Rare Friends
Generations NFT (generation 1 or higher). No RF, private key or signature is needed. For a phone on the same
network add `--host 0.0.0.0 --port 4173` and open `http://YOUR_LAN_IP:4173` in a wallet browser.

| Task | Command |
| --- | --- |
| Static build | `node scripts/dev-game.mjs build games/rare-breeds` (output `games/rare-breeds/.friendsdk/`) |
| Game validation | `node scripts/dev-game.mjs check games/rare-breeds` |
| Unit tests | `node --test "games/rare-breeds/tests/*.test.ts"` (use the glob; a bare directory fails on Node 22) |
| Typecheck | `npx tsc -p games/rare-breeds/tsconfig.json` |
| Browser test | `npx playwright install chromium` once, then `node tools/test-game.mjs` (960 x 800 and 390 x 844 touch) |
| Economy report | `node tools/economy-report.mjs` |
| GitHub Pages folder | `node tools/build-pages.mjs --smoke --base <repository>` (output `.friendsdk/site/`) |

The browser test drives the real sandboxed runtime with the SDK's mock wallet and sample Friend #7730 through two
full hatch loops, including the runtime confirmations. Mocks exist only in automated tests, never in a build.
Details for every tool: [`tools/README.md`](../../tools/README.md).

## Accessibility

- **Mute:** HUD sound button and a Sound switch in Settings. Audio (SDK sound kit) starts only after a player
  gesture.
- **Reduced motion:** follows the system `prefers-reduced-motion` setting and can be toggled in Settings. It
  removes screen shake, hops and walk bobbing, and the 4.75 s hatch becomes a 0.5 s fade to the reveal.
- **Keyboard:** every action works without a pointer. Panels are modal dialogs with a focus trap, Escape to close
  and visible focus rings. The world canvas has a text label with the controls.
- **Screen readers:** HUD values, hatch progress and results have text labels or live status messages.
- **Small screens:** compact HUD and panels below 600 x 480. The full loop is tested at 390 x 844 (touch); the SDK
  smoke test also passes at the 360 px minimum (a frame about 240 px tall).

## Known limitations

- **Session-local state.** The sandbox has no storage and the SDK bridge has no save API. Reloading starts a new
  session: 20 RF and an empty brood.
- **Child reload.** If only the game frame reloads inside the same runtime session, kept babies are rebuilt from
  the ledger's kept rewards, but the chosen mates lived in the frame. Rebuilt babies use your Friend and a
  deterministic stand-in mate, so their look and generation can differ.
- **The pair is presentation.** The tier comes from the ledger; the pixels come from the parents. In a future live
  version the baby would be a tier token, and its exact look would need the parent pair recorded with the play.
- **Wild mates are a fixed snapshot** of 73 Friends. Their holders are not involved and earn nothing in this build.
- **Confirmations.** Every buy, use and redeem opens a runtime confirmation by design. At 390 px wide it covers
  the whole frame.

## Credits

- **Character art:** canonical Rare Friends Generations sprites from the FamiliesRegistry
  (`0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D`, chain 4663). Your Friend is read live through the SDK; the
  73 wild mates (8 per family plus pinned Friend #77949) were snapshotted by `tools/fetch-wild-friends.mjs` on
  2026-09-26 into [`data/wild-friends.json`](data/wild-friends.json). Babies are derived from these pixels.
- **Sound:** FriendSDK sound kit, synthesized in code.
- **Runtime:** FriendSDK v0.1.2 runtime (wallet, Friend selection, eligibility gate, simulated ledger,
  confirmations, sandbox). Apache-2.0; asset notices in [`NOTICE.md`](../../NOTICE.md).
- **Everything else** (nursery, stations, hatch effects, icons, pixel lettering) is drawn in code. No image, font
  or audio files and no third-party assets. UI in React 19.
