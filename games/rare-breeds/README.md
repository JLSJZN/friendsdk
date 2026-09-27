# Rare Breeds

> Your Friend's 256 on-chain pixels are its DNA.

A FriendSDK **v0.1.2** game. Your verified Rare Friend picks a mate from real Rare Friends,
an egg hatches, and the baby inherits whole pixel rows from both parents, walk cycle included.
Kept babies follow you around the nursery, earn Hearts for hats and wishes, and can become parents
themselves (F1, F2, F3), or ride the **Moon Slingshot** out of the window, where the landing zone multiplies
their value. **All RF, eggs, outcomes and payouts are simulated. Hearts are game points, never RF.** The
wallet, the NFT ownership check and the character art are real.

![Rare Breeds gameplay](docs/media/gameplay.gif)

## How to play

1. **Intro.** A six-step tour opens at the start of every session: what the game is (your Friend's pixels are its
   DNA), your nursery (a picture of the real room with the four stations numbered), find a match and hatch, what can
   hatch (with the odds), what to do with a baby (Keep, Sanctuary, Moon Slingshot) and your screen (every HUD chip,
   the goal and the first tap). **Skip intro** closes it; **?** then **Replay intro** opens it again.
2. **Matchmaker** (left station, or **Find a match**). Parent A is your Friend or one of your babies. Parent B
   is one of three real wild Friends, or another baby from your brood. **New faces** rerolls the wild Friends
   for free; **Wish** (15 Hearts) offers three from a family you pick. A strip above the button shows what can
   hatch.
3. **Breed.** Uses one Egg. With no egg waiting, the button reads **Buy egg & breed · 1 RF** and buys one first.
   The runtime shows its own confirmations (**Buy egg**, then **Use egg**). A wild mate walks in first, then the
   egg wobbles, cracks, both parents' rows fly in and merge, and the baby is revealed.
4. **Result card.** Name, tier, parents, a DNA strip (16 rows, coloured by parent, with row counts), traits,
   what it adds to your collection, and both choices side by side: **Keep** (+5 Hearts now, then Hearts every
   10 s) or **Trade in at the Sanctuary** for its fixed Simulated RF value (runtime confirmation
   **Redeem reward**).
5. **Spend Hearts.** The heart counter (top left) opens the **Hearts shop**: hats for your Friend and your babies,
   and the Wish match.
6. **Breed again.** Any kept baby can be parent A or B. A baby's generation is one more than its older parent.
   The goal: babies from all 9 Friend families and all 4 tiers.

The **Egg incubator** (centre station) sells 1, 3 or 5 eggs in one confirmation. The **Sanctuary** (right
station) opens your brood, where you can inspect, breed or trade in any baby.

The **Moon Slingshot** stands in front of the back-wall window, between the incubator and the Sanctuary. Walk to
it and press E (prompt **Load the slingshot**) or tap it. Once you have a kept baby, a **Moon Slingshot: x0 to
x10** prompt (with a ! badge) also opens it; it goes away the first time the panel opens. Its panel lists your
kept babies and, for the one you pick, every landing zone with its chance, multiplier and exact payout, plus what
the launch does to your money: the trade-in pays the baby's value into the balance as usual, and the landing adds
to or takes from the Slingshot net (for example pond -6 RF, Moon +54 RF for a Prismatic). Hold the pull button to
stretch the band, then let go. The launch first trades the baby in: the runtime asks you to confirm **Redeem
reward**, and its fixed Sanctuary value lands in your simulated RF balance as the stake. Only then is the landing
zone drawn: the baby hops into the slingshot and is shot out through the window, a flight overlay shows where it
lands, and the zone multiplies the stake from x0 to x10 (simulated, see
[Moon Slingshot](#moon-slingshot-simulated-side-ledger)). **The baby is gone afterwards, even in the pond.** A
result card shows the payout, the stake and the net, and says where the money went: the trade-in is in your
balance, and the difference (payout minus stake, negative below x1) goes to its own HUD counter, **Slingshot net**
(a moon pill reading "Slingshot +54 RF", "Net" on phones, with a Sim tag, shown from the first landing; tapping it
reopens the slingshot), never to the RF balance. Cancelling the confirmation changes nothing.

## Controls

| Action | Keyboard | Touch or mouse |
| --- | --- | --- |
| Walk | WASD or arrow keys | Tap or click the floor; drag to steer |
| Use a station | E, Enter or Space when its prompt shows | Tap the prompt, or tap the station (your Friend walks there and opens it) |
| Hop (Friend and brood) | Space or E away from a station | Tap your Friend |
| Open a baby | Brood button (bottom centre or HUD counter) | Tap the baby in the world |
| Hearts shop | Heart counter in the HUD | Tap the heart counter |
| Intro | Left / Right arrows step, Escape skips | Next, Back, Skip intro |
| Panels | Tab / Shift+Tab, Enter or Space, Escape closes | Tap; tap outside to close |
| Hatch animation | Escape or **Skip**; on the result card Escape means **Keep** | **Skip** |
| Moon Slingshot: pull and launch | Hold Space or Enter on the pull button, release to launch, then confirm **Redeem reward**; Escape while pulling cancels | Press and hold the pull button, let go, then confirm **Redeem reward**; a quick tap also launches |
| Slingshot flight | Escape or **Skip** jumps to the landing; on the result card Escape goes back to the nursery | **Skip** |
| Sound, help | HUD buttons, top right | HUD buttons, top right |

The bottom-left and bottom-right corners stay free for the SDK runtime's wallet/Friend control and menu.
The world pauses while a panel, the intro, the hatch, the slingshot flight or a runtime confirmation is open,
and whenever the runtime sets `paused`.

## Features

### Pixel genetics

A Friend is 64 one-bit 16 x 16 frames (idle and walk, four facings, eight frames each). A baby takes each of its
16 rows from parent A or parent B, in alternating runs of 2 to 5 rows, so each parent gives at least 4 rows. The
same row mask is used for all 64 frames, so the baby's walk cycle is a real mix of both parents' walk cycles.
Up to 64 seeded masks are scored and the best valid one wins. Each frame is then repaired into one 8-connected
body with the fewest added pixels; no inherited pixel is ever removed. Symmetric parents give symmetric front
and back views. The tier adds its pattern and mutation on top. **Side-walker** is dominant: Colossus Friends have
no front or back art, so any baby with a Colossus (or Side-walker) parent shows its right-facing frames from
every side, through every generation. Everything is deterministic from `(your Friend ID, parent A, parent B,
play ID)` and takes a few milliseconds per baby (test budget: under 5 ms on average). See
[`src/genetics.ts`](src/genetics.ts) and [`docs/media/genetics-sheet.png`](docs/media/genetics-sheet.png).

### Hearts (game points, never RF)

Hearts give **Keep** a reason next to the Sanctuary's fixed RF value. They live only in this session
([`src/hearts.ts`](src/hearts.ts)).

| Rule | Value |
| --- | --- |
| Income per kept baby, every 10 s | Common 1, Spotted 2, Mutant 4, Prismatic 10 Hearts (6, 12, 24, 60 per minute) |
| Average kept baby | 0.6 x 6 + 0.25 x 12 + 0.125 x 24 + 0.025 x 60 = 11.1 Hearts per minute |
| Keep bonus | +5 Hearts each time you keep a baby |
| Income pauses | While the runtime is paused (menus, confirmations), during the intro and a hatch, and while the tab is hidden |
| What Hearts are not | Not RF. They cannot be bought with RF, traded in or redeemed, so they back no payout and need no prize reserve |

Example, one baby on its own: a Common trades in for 0.5 RF, or earns 6 Hearts a minute and, with the Keep bonus,
pays for a Party hat in 2.5 minutes. A Prismatic trades in for 6 RF, or earns 60 Hearts a minute and pays for the
Halo in about 4 minutes.

### Hearts shop: hats and Wish match

| Item | Hearts |
| --- | ---: |
| Party hat | 20 |
| Bow | 20 |
| Flower | 25 |
| Beanie | 35 |
| Headphones | 50 |
| Top hat | 80 |
| Crown | 150 |
| Halo | 250 |
| **Wish match**: the Matchmaker offers three wild Friends from a family you pick | 15 |

The full wardrobe costs 630 Hearts. Each hat is bought once and worn by one creature at a time (your Friend or any
baby); putting it on someone else moves it, and a traded-in baby's hat returns to the wardrobe. A hat is drawn on
**each frame's own head**, so it bobs and walks with the canonical art in all four facings, and it **never covers
a pixel of body ink** ([`src/accessories.ts`](src/accessories.ts), [`docs/media/accessories-sheet.png`](docs/media/accessories-sheet.png)).

### Collection goal

Breed babies from all **9 Friend families** and find all **4 tiers**. A family counts once any hatched baby
(kept or traded in) has it as a parent family; a tier counts once any egg hatches it. The reveal card names new
finds ("New family: Hollow · 3/9"), the brood shows the set, and the Wish match marks families you still need.
No reward is attached; it is a goal.

### Onboarding

The six-step intro uses your own Friend and a real wild mate, with example babies bred by the same genetics
(presentation only, never kept or counted). Its nursery step paints the real room art (walls, props, the four stations
at rest and your Friend) into a canvas and pins numbered markers on the stations; its last step shows copies of the HUD
chips with their live values. The **?** panel repeats both legends ("Stations" and "Your screen") next to the rules. First-time hints: a "Start here" coach on **Find a match**, a note in
the Matchmaker about the runtime confirmations to expect, and a Keep or trade-in hint on the first reveal card.

### Phone layout

[`host.css`](host.css) gives the runtime frame a 3:4 aspect ratio on portrait screens up to 600 px wide, so the
nursery is not a thin strip. Frames narrower than 600 or lower than 400 CSS px zoom in with a follow camera that
keeps your Friend centred between the HUD and the action bar.

## Rules and rewards (RF, simulated)

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
| Backing pause | Free stake after n hatches = 60 RF + sum(1 RF price - reward). Purchases pause only after 11 Prismatic hatches in a row (p = 2.38e-18). Trading a baby in does not change free stake |
| Unhatched eggs | Also reserve 6 RF each: at most 12 in one purchase, or 11 bought one at a time, from a fresh session |
| Pending hatch | A used egg that has not settled shows **Finish hatching** and settles the same play. It never uses another egg |

What 20 simulated RF buys (`node tools/economy-report.mjs`: exact math, then 5,000 sessions per strategy on the
SDK's own `createGamePreview` ledger, seed 7730):

| Strategy | Hatches (minimum) | Median | Mean |
| --- | ---: | ---: | ---: |
| Keep every baby | 20 | 20 | 20.0 |
| Trade in only Commons | 20 (21 observed) | 28 | 28.1 |
| Trade in every baby | 39 (49 observed) | 143 | 173.7 |

In 20 hatches: P(at least one Prismatic) = 1 - 0.975^20 = 39.7%; P(at least one Mutant or Prismatic) = 1 - 0.85^20 = 96.1%.

### Moon Slingshot (simulated side ledger)

Source of truth: [`src/slingshot.ts`](src/slingshot.ts); every number below is proven exactly in
[`tests/slingshot.test.ts`](tests/slingshot.test.ts) (16 tests) and printed by `node tools/economy-report.mjs`.
A launch is a Sanctuary trade-in plus a multiplier. First the SDK redeems the baby (`redeem(outcomeId, 1)`,
runtime confirmation **Redeem reward**): its tier token is burned and its fixed Sanctuary value, the **stake**, lands
in the simulated RF balance. Then one roll in 0-9999 picks the landing zone against the cumulative weights (like
the SDK's `outcomeForRoll`), and the zone multiplies the stake. The side ledger books only the difference, payout
minus stake. **How hard you pull is cosmetic; the zone is drawn once, after you let go and confirm the trade-in.**

| Zone | Landing | Rolls | Weight | Chance | Multiplier | EV share | Net booked (payout - stake) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| pond | Belly flop in the pond | 0-3999 | 4,000 bps | 40% (2 in 5) | x0 | x0 | -1 x stake |
| haystack | Haystack | 4000-6399 | 2,400 bps | 24% | x0.5 | x0.12 | -0.5 x stake |
| rooftop | Rooftop | 6400-8199 | 1,800 bps | 18% | x1 | x0.18 | 0 |
| cloud | Cloud nine | 8200-9399 | 1,200 bps | 12% | x2 | x0.24 | +1 x stake |
| orbit | Orbit | 9400-9799 | 400 bps | 4% (1 in 25) | x4 | x0.16 | +3 x stake |
| moon | The Moon | 9800-9999 | 200 bps | 2% (1 in 50) | x10 | x0.2 | +9 x stake |
| | **Total** | 0-9999 | 10,000 bps | 100% | | **x0.9** | **-0.1 x stake** |

Payout per tier (stake x multiplier; every value is an exact number of base units, nothing is rounded):

| Outcome | Stake | Pond x0 | Haystack x0.5 | Rooftop x1 | Cloud nine x2 | Orbit x4 | The Moon x10 | EV per launch | Expected net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Common hatchling | 0.5 RF | 0 RF | 0.25 RF | 0.5 RF | 1 RF | 2 RF | 5 RF | 0.45 RF (`450000000000000000`) | -0.05 RF |
| Spotted hatchling | 1 RF | 0 RF | 0.5 RF | 1 RF | 2 RF | 4 RF | 10 RF | 0.9 RF (`900000000000000000`) | -0.1 RF |
| Mutant hatchling | 1.5 RF | 0 RF | 0.75 RF | 1.5 RF | 3 RF | 6 RF | 15 RF | 1.35 RF (`1350000000000000000`) | -0.15 RF |
| Prismatic hatchling | 6 RF | 0 RF | 3 RF | 6 RF | 12 RF | 24 RF | 60 RF | 5.4 RF (`5400000000000000000`) | -0.6 RF |

| Rule | Exact value |
| --- | --- |
| Expected multiplier | (0 x 4000 + 0.5 x 2400 + 1 x 1800 + 2 x 1200 + 4 x 400 + 10 x 200) / 10000 = 9000 / 10000 = **x0.9** of the stake: 90% return, 10% edge (the same edge as the SDK fishing reference), which stays in the Moon Fund. Exact over all 10000 rolls |
| Launch every baby | 0.8875 RF per egg x 0.9 = **0.79875 RF per egg** (`798750000000000000`), 79.875% of the 1 RF price. Exact over all 10^8 egg and launch roll pairs |
| Moon Fund | Simulated, **600 RF** (`600000000000000000000`) at session start: 10 x the top payout (Prismatic 6 RF x10 = 60 RF), the same x10 convention `GameHost` uses for the egg stake |
| Backing rule | A baby worth v flies only while the Moon Fund holds at least its Moon payout (10 v); the panel checks this before the trade-in. The fund takes the stake and pays the payout, so it moves by the negative net: fund' = fund + v - payout >= v, and it never goes negative |
| Backing pause | The largest drain per launch is 54 RF (a Prismatic on the Moon), so the first 11 launches of a session can never be blocked. 11 Prismatic Moon landings in a row leave 6 RF; then only Commons (Moon payout 5 RF) still fly. The panel names the reason when a baby cannot fly |
| One draw, final | The zone is drawn once, after the trade-in is confirmed. No reroll, and every result is final: the launched baby is gone for good, even in the pond. Cancelling the confirmation changes nothing |
| Slingshot net | Its own HUD counter (simulated, can be negative): the sum of payout minus stake over all launches. Never added to the runtime RF balance, so it cannot buy eggs in the preview. The stakes are ordinary Sanctuary redemptions and stay in the balance |

A session that launches every baby (`node tools/economy-report.mjs`: 5,000 sessions on the SDK's
`createGamePreview`, seeds 7730 and 7731, each from 20 RF: breed while the runtime sells an egg, trade every baby in
and launch it, so the trade-ins keep paying for eggs): 173.7 hatches and launches on average (median 143, the same
egg rolls as "Trade in every baby" above, because the net never reaches the spendable balance), 3.5 Moon landings
on average, P(at least one Moon landing) = 92.5%. The stakes (traded-in values) average 154.236 RF per session and
the Slingshot net averages -15.578 RF (median -14.5 RF, p5 -61.25 RF, p95 +28 RF), in line with the exact identity
E[net] = -0.1 x E[staked] (-0.1 x 154.236 = -15.424 RF). P(net > 0) = 24.0%. The Moon Fund ends at 615.578 RF on
average, its lowest point in any session was 421 RF, and it never blocked a launch in 5,000 sessions.

## What is simulated and what is real

| Simulated (SDK preview ledger) | Game state only (this session) | Real |
| --- | --- | --- |
| RF balance, prize stake, eggs, plays, tiers, Sanctuary payouts | Hearts, hats, the collection, the brood's lineage | Wallet connection and a fresh ownership/eligibility read by the SDK runtime (Robinhood mainnet, chain 4663) |
| Every **Buy egg**, **Use egg** and **Redeem reward** confirmation ("Simulated RF. No transaction will be sent.") | | Your Friend's 64 canonical frames, read on-chain through the SDK's `createFriendReader` |
| | | The wild mates' art: canonical frames of 73 real Friends (see Credits) |

Game code uses only the SDK's fixed action client (`read`, `buy`, `play`, `settle`, `redeem`) and moves RF only
through it; a slingshot launch's trade-in is an ordinary `redeem`. Hearts, hats and the slingshot's multiplier
never touch it.
The game has no wallet code, sends no transactions and deploys no contracts. No trading, creator fees or
wearable NFTs are implemented.

**The Moon Slingshot splits cleanly between the SDK and a simulated side ledger.**

- **The SDK handles the baby's value.** A launch starts with `redeem(outcomeId, 1)`: runtime-confirmed
  (**Redeem reward**), backed by the prize stake like every Sanctuary trade-in, the tier token burned, the fixed
  value in the simulated RF balance. The HUD balance and the runtime wallet menu therefore always agree.
- **The side ledger handles only the multiplier on top**, which SDK v0.1.2 cannot express: it supports exactly one
  consumable and one weighted outcome table, and game code can move RF only through the fixed action whitelist
  over the sandbox bridge. The FriendSDK guide welcomes mechanics beyond the chance-game API when they are backed
  by or integrated with RF, labelled as simulated, funded and documented ("mechanics beyond its current
  capabilities need their own integration"). So [`src/slingshot.ts`](src/slingshot.ts) keeps a session-local
  ledger (Moon Fund, Slingshot net, launches) that applies the SDK's rules to a second table:
  - **Backing:** a launch needs the simulated Moon Fund (600 RF at session start, 10 x the top payout) to cover the
    baby's x10 payout, like the SDK's rule that free stake must cover the maximum prize. The fund takes the stake
    and pays the payout, so it never goes negative.
  - **One draw, no reroll:** the zone is drawn once, after the trade-in is confirmed, and the result is final.
  - **Randomness:** in this preview the roll is browser randomness: the SDK's own `samplePreviewRoll` (Web Crypto,
    rejection sampling to 0-9999), the same draw the preview ledger uses for eggs. The FriendSDK rules are
    explicit that contracts determine paid outcomes and that browser randomness and local balances are preview
    only. Live, the zone would come from a separate Slingshot contract with Dice randomness
    ([design](docs/SUBMISSION.md#what-would-be-on-chain)); no such contract exists or is deployed.
  - **Labelled and separate:** the net is its own simulated HUD counter, **Slingshot net**, never mixed into the
    runtime RF balance.
  - **Checked against the SDK:** the tests write each tier's launch table as an SDK chance game (price = the
    stake, reward = the payout per zone) and show that the SDK's `createGamePreview` ledger, staked with the same
    600 RF, gives the same backing verdict and the same fund as the side ledger on every launch.

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
| Unit tests | `node --test "games/rare-breeds/tests/*.test.ts"` (economy, genetics, accessories, slingshot; use the glob, a bare directory fails on Node 22) |
| Typecheck | `npx tsc -p games/rare-breeds/tsconfig.json` |
| Browser test | `npx playwright install chromium` once, then `node tools/test-game.mjs` (960 x 800 and 390 x 844 touch) |
| Economy report | `node tools/economy-report.mjs` |
| GitHub Pages folder | `node tools/build-pages.mjs --smoke --base <repository>` (output `.friendsdk/site/`) |

The browser test drives the real sandboxed runtime with the SDK's mock wallet and sample Friend #7730: the intro,
two full hatch loops with the runtime confirmations, the Keep bonus, buying and wearing a hat, a trade-in, and a
Moon Slingshot launch (a cancelled **Redeem reward** that changes nothing, a confirmed one, Skip, the result card,
the brood and balance afterwards and the HUD net).
Mocks exist only in automated tests, never in a build. Details: [`tools/README.md`](../../tools/README.md).

## Accessibility

- **Mute:** HUD sound button and a Sound switch in Settings. Audio (SDK sound kit) starts only after a player
  gesture.
- **Reduced motion:** follows the system `prefers-reduced-motion` setting and can be toggled in Settings. It
  removes screen shake, hops and walk bobbing, keeps the camera on your Friend alone, turns the 4.75 s hatch
  into a 0.5 s fade to the reveal, and turns the slingshot shot into a quick fade in the nursery and its flight into a short fade to the landing.
- **Skip:** the hatch and the slingshot flight both have a **Skip** button (and Escape) that jumps straight to
  the result.
- **Keyboard:** every action works without a pointer. Panels are modal dialogs with a focus trap, Escape to close
  and visible focus rings. The slingshot's pull button is held with Space or Enter; Escape cancels a pull. The
  world canvas has a text label with the controls.
- **Screen readers:** HUD values (including Hearts, labelled "not RF", and the Slingshot net, labelled
  simulated), hatch progress and results, the slingshot's zones (chance, multiplier and payout) and its flight
  and landing have text labels or live status messages. A plain click from assistive technology launches with
  the minimum pull, which, like every pull, does not change the odds.
- **Small screens:** compact HUD and panels, the 3:4 portrait frame and the follow camera. The full loop is tested
  at 390 x 844 with touch.

## Known limitations

- **Session-local state.** The sandbox has no storage and the SDK bridge has no save API. Reloading starts a new
  session: 20 RF, 0 Hearts, no hats, an empty brood and collection, a 600 RF Moon Fund with a Slingshot net
  of 0, and the intro again.
- **The slingshot ledger lives in the game frame.** When the frame remounts inside the same runtime session (for
  example after switching Friends and back), the Slingshot net and the Moon Fund reset. The player keeps the
  traded-in stakes, which are ordinary Sanctuary redemptions in the runtime ledger; only the simulated multiplier
  result of earlier launches is lost.
- **The multiplier is simulated, not an SDK outcome.** Its roll is browser randomness and its balance is local
  (see [What is simulated and what is real](#what-is-simulated-and-what-is-real)); a live version needs the
  Slingshot contract described in the submission.
- **Child reload.** If only the game frame reloads inside the same runtime session, kept babies are rebuilt from
  the ledger's kept rewards, but the chosen mates lived in the frame. Rebuilt babies use your Friend and a
  deterministic stand-in mate, so their look and generation can differ.
- **The pair is presentation.** The tier comes from the ledger; the pixels come from the parents. In a future live
  version the baby would be a tier token, and its exact look would need the parent pair recorded with the play.
- **Hearts are local game state.** They are not on any ledger and would stay off-chain in a live version.
- **Wild mates are a fixed snapshot** of 73 Friends. Their holders are not involved and earn nothing in this build.
- **Confirmations.** Every buy, use and redeem opens a runtime confirmation by design; on a phone it covers most
  of the frame.

## Credits

- **Character art:** canonical Rare Friends Generations sprites from the FamiliesRegistry
  (`0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D`, chain 4663). Your Friend is read live through the SDK; the
  73 wild mates (8 per family plus pinned Friend #77949) were snapshotted by `tools/fetch-wild-friends.mjs` on
  2026-09-26 into [`data/wild-friends.json`](data/wild-friends.json). Babies are derived from these pixels; hats
  are drawn beside them, never over them.
- **Sound:** FriendSDK sound kit, synthesized in code.
- **Runtime:** FriendSDK v0.1.2 runtime (wallet, Friend selection, eligibility gate, simulated ledger,
  confirmations, sandbox). Apache-2.0; asset notices in [`NOTICE.md`](../../NOTICE.md).
- **Everything else** (nursery, stations, hatch effects, hats, icons, pixel lettering) is drawn in code. No image,
  font or audio files and no third-party assets. UI in React 19.
