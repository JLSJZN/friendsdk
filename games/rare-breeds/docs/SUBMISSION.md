<!--
Draft for submissions/rare-breeds/README.md in spokesz/rarefriends-vibeathon.
Before opening the PR: replace every TBD, pin source and media links to the final commit SHA
(replace "/rare-breeds/" in the raw and blob URLs), rebuild the preview from that commit, re-run the checks
and fill the checklist. New features go into "Features" as one more bullet.
-->

# Rare Breeds

![Rare Breeds: a Friend picks a mate, the egg hatches, the baby inherits pixel rows from both parents](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/gameplay.gif)

**Play: https://jlsjzn.github.io/friendsdk/**

**Project name**
Rare Breeds

**Builder / contact**
[@JLSJZN](https://github.com/JLSJZN) · X [@JLSJZN](https://x.com/JLSJZN) · Telegram [@JLSJZN](https://t.me/JLSJZN)

**Category**
Character Spotlight (primary) · Economy Potential (secondary)

**One sentence**
Your Friend's 256 on-chain pixels are its DNA: pair it with a real Rare Friend, hatch a 1 RF egg (simulated), and the baby inherits whole pixel rows from both parents, walk cycle included.

**Source code**
[GitHub repository](https://github.com/JLSJZN/friendsdk/tree/rare-breeds/games/rare-breeds) (TBD: pin to commit) · FriendSDK v0.1.2 (fork of `spokesz/friendsdk` at `762d6f5`) · React 19 · TypeScript · Canvas 2D · [game README](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/README.md) · [exact rules: `game.json`](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/game.json)

**Playable preview**
https://jlsjzn.github.io/friendsdk/ on GitHub Pages, built with the SDK CLI (`node tools/build-pages.mjs --base friendsdk`).

**Wallet and network**
A browser wallet on **Robinhood mainnet (chain 4663)** holding a hardwired Rare Friends Generations NFT, generation 1 or higher. The SDK runtime connects the wallet, lets you pick the Friend and verifies ownership at a fresh block before play. No RF, private key or transaction signature is needed: all balances and outcomes in the preview are simulated.

## Run it

Node.js 22.18+ on macOS, Linux or Ubuntu/WSL2:

```sh
git clone https://github.com/JLSJZN/friendsdk.git
cd friendsdk
git checkout rare-breeds   # TBD: pin to commit
npm ci
npm run build
node scripts/dev-game.mjs dev games/rare-breeds
```

Open the printed URL, connect the wallet and select your Friend. Add `--host 0.0.0.0 --port 4173` to play from a phone wallet browser on the same network.

## How to play

Walk with **WASD** / arrow keys, or tap and drag on the floor. Press **E** (or Enter, Space, or tap the station) at a station. A six-step intro explains the game on start (what it is, the four stations on a picture of the room, breeding, the odds, what to do with a baby, every HUD chip); **?** replays it and shows the stations and HUD legends, the odds, mute and reduced motion.

1. **Matchmaker:** parent A is your Friend (or a kept baby); parent B is one of three real wild Friends (free reroll, or a 15-Heart **Wish** for a family you pick) or another kept baby.
2. **Breed:** uses one Egg. With none waiting, **Buy egg & breed · 1 RF** buys one first. The runtime asks you to confirm **Buy egg**, then **Use egg**.
3. **Hatch:** the mate walks in, the egg wobbles and cracks, both parents' rows fly in and merge, the baby appears (**Skip** or Escape to jump ahead).
4. **Keep or trade in:** **Keep** adds the baby to your brood (+5 Hearts, then Hearts every 10 s); it follows you around the nursery in a line. **Trade in at the Sanctuary** redeems it for its fixed value (runtime confirmation **Redeem reward**).
5. **Spend Hearts and breed again:** tap the heart counter for hats and wishes. Kept babies are parents too: F1 babies make F2, F2 make F3. Goal: babies from all 9 families and all 4 tiers.

The Egg incubator sells 1, 3 or 5 eggs in one confirmation. The **Moon Slingshot** (in front of the back window, between the incubator and the Sanctuary) plays like the casino game Crash: pick a kept baby, see its exits (fizzle on the pad 10%, x1.5 60%, x2 45%, x4 22.5%, the Moon at x10 9%) and confirm **Redeem reward**. The baby is traded in for its fixed value (into the balance as usual) and tossed out of the window onto a tiny firework rocket. **Hold to fly, let go to jump** (mouse, touch, Space or Enter): the multiplier climbs from x1 to x10 in 9 s with the live payout, the baby jumps and parachutes into the hay at the multiplier you let go at, a rocket that gives out first drops it in the pond (x0), and x10 lands it on the Moon (simulated). Jump early for a likely small win, hold for a rare big one: on average every exit pays back about 0.9x (exactly at the round exits). Your balance gets the baby's value either way (the trade-in); the flight only moves the Slingshot net. A result card shows payout, stake, net, where the rocket would have given out, the record to chase and where the money went, and the HUD keeps the session's Slingshot net in its own pill (simulated, not spendable in the preview). The baby is gone afterwards, even in the pond. Everything stays inside the SDK's container; on portrait phones the frame grows as tall as the screen allows (3:4 down to 1:2) with a follow camera, and the flight fills it.

## Features

- **Pixel genetics:** every baby is built from its two parents' real pixel rows across all 64 frames, with a pattern and mutation per tier. Deterministic from (Friend ID, parents, play ID).
- **Brood and lineage:** kept babies follow your Friend like ducklings and can breed with wild Friends or each other (F1, F2, F3). Colossus passes on a dominant Side-walker gene.
- **Hearts:** session game points that only kept babies earn (6 to 60 a minute by tier, +5 per Keep). Never RF, never redeemable.
- **Hearts shop:** 8 hats from 20 to 250 Hearts that sit on each Friend's own head, frame by frame, and a Wish match for 15 Hearts.
- **Collection goal:** all 9 Friend families and all 4 tiers, tracked on the reveal card and in the brood.
- **Genes you breed for:** the ledger decides the rarity, you decide the genes. Shape mutations still grow only on Mutant and Prismatic hatches, but they live in the parent's own pixel rows, so a baby that takes those rows carries them in any tier, Common included, and passes them on (49.1% measured, shown as "about 1 in 2"; a shape counts only when it is whole in every idle and walk frame of every facing; the Matchmaker names what a parent can pass on, the reveal card leads with "Inherited: Horns from Zibu!" and marks its rows in the DNA strip). Lines earn cosmetic titles (Echo of your Friend, Purebred, Chimera), every card shows its hatch number, and each of the 45 family pairs is a named breed ("Ghost Bones", "Blimp", "Glitter Bandit") in a breed book.
- **Moon Slingshot:** a fourth station that turns a kept baby into a Crash-style rocket ride. The SDK trades the baby in (runtime-confirmed `redeem`, its fixed value becomes the stake), then you hold to fly and let go to jump: the multiplier climbs past the nursery roof (x1.5), cloud nine (x2) and the orbit (x4) to the Moon (x10), and a jump pays stake x multiplier unless the rocket gives out first (the pond). The crash point is drawn once at ignition with exact odds (10% fizzle, x2 45%, x10 9%), every exit pays back about 0.9x on average (exactly at the round exits), and the multiplier is a clearly labelled simulated side ledger backed by a 600 RF Moon Fund.
- **Onboarding:** a six-step intro with your own Friend: what the game is, your nursery (the real room art with the four stations numbered), breeding, the odds, Keep / Sanctuary / Moon Slingshot, and a legend of every HUD chip ending on the goal and the first tap. Plus first-time hints, a "What can hatch" odds strip in the Matchmaker, and **Replay intro**.
- **Phone layout:** a portrait frame as tall as the screen allows (`host.css`, 3:4 down to 1:2, never taller than the visible height) and a follow camera on small frames.

## Costs, odds and rewards

**All balances, purchases and rewards are simulated.** You start with 20 RF; the preview ledger holds 60 RF of simulated prize backing (6 RF maximum prize x 10). One Egg costs **1 RF** (`1000000000000000000` base units) and hatches exactly one baby.

| outcomeId | Tier | Weight | Chance | Sanctuary value | EV share | Hearts if kept |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Common hatchling: pure ink rows | 6,000 bps | 60% | 0.5 RF | 0.3 RF | 6 / min |
| 2 | Spotted hatchling: green pattern | 2,500 bps | 25% | 1 RF | 0.25 RF | 12 / min |
| 3 | Mutant hatchling: violet pattern plus a head mutation | 1,250 bps | 12.5% | 1.5 RF | 0.1875 RF | 24 / min |
| 4 | Prismatic hatchling: rainbow body, mutation and tail | 250 bps | 2.5% | 6 RF | 0.15 RF | 60 / min |

- Expected value: (0.5 x 6000 + 1 x 2500 + 1.5 x 1250 + 6 x 250) / 10000 = **0.8875 RF per egg** (88.75% return, 11.25% house edge), exact over all 10,000 rolls.
- Backing follows the SDK unchanged: every purchased or pending egg reserves the 6 RF maximum prize; kept babies keep their fixed value reserved with no redemption expiry; new purchases stop when free stake cannot cover another maximum prize. From the preview stake that happens only after 11 Prismatic hatches in a row (p = 2.38e-18).
- The parents never change the odds. The tier comes from the ledger; the parents only decide what the baby looks like.
- From 20 RF: keeping every baby gives exactly 20 hatches; trading in every baby gives at least 39 (mean 173.7 over 5,000 simulated sessions). P(at least one Prismatic in 20 hatches) = 39.7%.

**Hearts (game points, not RF).** Earned by kept babies once per 10 s cycle (Common 1, Spotted 2, Mutant 4, Prismatic 10), +5 on every Keep; an average kept baby earns 0.6 x 6 + 0.25 x 12 + 0.125 x 24 + 0.025 x 60 = 11.1 a minute. Spent on hats (Party hat 20, Bow 20, Flower 25, Beanie 35, Headphones 50, Top hat 80, Crown 150, Halo 250; 630 for all) and the Wish match (15). Hearts cannot be bought with RF, traded in or redeemed, so they back no payout and need no prize reserve. They last for the session.

**Moon Slingshot (simulated side ledger).** A launch first trades the baby in through the SDK (`redeem(outcomeId, 1)`, runtime confirmation **Redeem reward**): the tier token is burned and its fixed value, the stake, lands in the simulated RF balance. Then the baby rides a rocket like the casino game Crash, and the side ledger books only the difference, payout minus stake, as **Slingshot net** (can be negative).

- While the player holds, the multiplier is m(t) = e^(k t), k = ln(10) / 9 s, in whole hundredths: x2 after 2.71 s, x4 after 5.42 s, x10 at 9 s. Letting go jumps at floor(m x 100) / 100.
- One roll in 0-9999, drawn once at ignition, fixes the crash point C = floor(900000 / (roll + 1)) hundredths (capped at x10). A jump at h pays stake x h / 100 (rounded down to base units) when C >= h; otherwise the rocket gives out first and the baby lands in the pond (x0). Below x1 it fizzles on the pad; a rocket good for x10 jumps onto the Moon by itself.

| Exit | Winning rolls | Chance | Payback | Prismatic (6 RF stake) pays |
| --- | --- | ---: | ---: | ---: |
| Fizzles on the pad | none (9000-9999 fizzle) | 10% | x0 | 0 RF |
| Jump at x1.5 | 0-5999 | 60% | x0.9 | 9 RF |
| Jump at x2 | 0-4499 | 45% | x0.9 | 12 RF |
| Jump at x4 | 0-2249 | 22.5% | x0.9 | 24 RF |
| The Moon, automatic jump at x10 | 0-899 | 9% | x0.9 | 60 RF |

- Exact odds: P(C >= h) = floor(900000 / h) / 10000 for every h, so always jumping at h pays back h x floor(900000 / h) / 10^6 of the stake: exactly **x0.9** at the round exits (10% edge, the same as the SDK fishing reference), never more, at least x0.899 anywhere. Timing changes the risk, not the payback. Launching every baby and jumping at a round exit returns 0.8875 x 0.9 = **0.79875 RF per 1 RF egg** (`798750000000000000` base units), exact over all 10^8 egg and crash roll pairs.
- Backing mirrors the SDK rule: the simulated Moon Fund starts at **600 RF** (10 x the 60 RF top payout, the SDK preview-stake convention), and a baby worth v flies only while the fund covers its x10 payout, whatever exit the player will pick. The fund takes the stake and pays the payout (fund' = fund + v - payout >= v), so it never goes negative; the first 11 launches of a session can never be blocked.
- The crash point is drawn once, at ignition, after the trade-in is confirmed; no reroll, every result final. Cancelling the confirmation changes nothing; **Don't fly** before ignition is a plain Sanctuary trade-in with nothing booked in the side ledger. If the runtime pauses or the tab hides mid-flight, the baby jumps at once.
- Sessions that launch every baby (5,000 simulated sessions per strategy from 20 RF, the trade-ins paying for new eggs): 173.7 launches and 154.236 RF staked on average, mean Slingshot net about -15.4 RF for every strategy (exact identity E[net] = -0.1 x E[staked]); P(net > 0) is 10.8% jumping at x1.5, 18.6% at x2, 28.4% at x4 and 33.3% riding to the Moon, whose fund low point was 322.5 RF. It never blocked a launch.

Full tables, base units and the Monte Carlo: [Rules and rewards](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/README.md#rules-and-rewards-rf-simulated) · [Moon Slingshot](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/README.md#moon-slingshot-simulated-side-ledger) · `node tools/economy-report.mjs`.

## How the NFT is the main character

- **You play as your Friend.** Its 64 canonical frames (idle and walk, four facings, eight frames each) are read on-chain from the FamiliesRegistry through the SDK and drawn pixel for pixel at an integer scale, with a white sticker outline. The intro opens on your own Friend: 16 rows x 16 = 256 pixels.
- **Its pixels literally become the baby.** Each of the baby's 16 rows is copied from one parent, in runs of 2 to 5 rows (each parent gives at least 4). One row mask covers all 64 frames, so the baby walks with a real mix of both parents' walk cycles. Frames are repaired into one connected body with the fewest added pixels; no inherited pixel is ever removed, and symmetric parents give symmetric babies. The result card shows the DNA strip: which rows came from whom.
- **Hats sit on the canonical art, not over it.** Each hat is anchored to every frame's own head, so it bobs with the Friend's idle frames and walks with its walk cycle in all four facings, and it never covers a pixel of body ink. Tests check this on all 73 pool Friends and 32 bred babies (mutants, prismatics, Side-walkers, F2), 64 frames each.
- **The mates are real Friends too:** 73 Generations Friends from all nine families, with their canonical art.
- **Family genes carry over.** Colossus Friends have no front or back art, so **Side-walker** is dominant: any baby with a Colossus parent shows its right-facing frames from every side, and passes that on to F2 and F3.
- **Lineage.** A baby is one generation past its older parent (F1, F2, F3...), and every baby traces back to the holder's own Friend.
- **Mutations are heirlooms.** A Mutant's horns are pixels in its own rows; a descendant that inherits those rows wears the same pixels, and the card says whose they were ("Horns (from Zibu)"). "Echo of #id" marks a baby whose rows are at least 12 of 16 the holder's own Friend's.

![Friend #77949 bred with one Friend of every family, in all four tiers, with the walk cycle of each Prismatic baby](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/genetics-sheet.png)

![All 8 hats on Friend #77949, one Friend of every family and bred babies, anchored frame by frame](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/accessories-sheet.png)

## What would be on-chain

Nothing in this build; no transaction is ever sent and no contract is deployed. **The egg loop needs no new contract:** it is a deployment of the SDK's existing `ChanceGame` with this `game.json` (consumable Egg, four outcomes), used through the SDK's live runtime from the Friend's canonical wallet. **The Moon Slingshot needs one more contract** (future work, below).

| In the game | SDK action | Existing `ChanceGame` effect |
| --- | --- | --- |
| Buy eggs | `buy(quantity)` | Exact RF approval; RF moves from the Friend's canonical wallet into the game; 6 RF reserved per egg; Egg tokens minted to that wallet |
| Breed | `play(1)` | Burns one Egg and commits the play. No outcome exists yet |
| Hatch | `settle(playId)` | One Dice randomness request per batch (fee capped at 0.000025 ETH excluding gas), then `roll = keccak256(word, game, chainId, batchId, playId) % 10000` against the cumulative weights; mints one tier token (ERC-1155 id 1 to 4) to the Friend's canonical wallet |
| Keep | none | The tier token stays in the Friend wallet, backed, no expiry |
| Trade in at the Sanctuary | `redeem(outcomeId, 1)` | Burns one tier token and pays its fixed RF to the Friend's canonical wallet |

**Moon Slingshot: a separate `Slingshot` contract next to the `ChanceGame` (future work, not built, not deployed).** It needs the SDK support listed below.

| In the game | Preview today | Future `Slingshot` contract |
| --- | --- | --- |
| Launch | `redeem(outcomeId, 1)` (runtime-confirmed; tier token burned, fixed value to the simulated balance as the stake) | `launch(outcomeId)` or `launch(outcomeId, target)`: burns one tier token from the Friend's canonical wallet (or accepts it as the stake); its reserved value moves from the `ChanceGame` reward liability into the slingshot stake; reserves 10 x the value (the Moon payout) of free slingshot stake; records the launch time. No randomness exists yet |
| Jump | Letting go in the browser; the crash point was drawn at ignition (`samplePreviewRoll`) | `jump(launchId)`: fixes the exit from the time since launch, floor(100 x 10^(t / 9 s)) capped at x10 (or the `target` set at launch, the automatic jump), and only then requests one Dice random word |
| Land | The simulated side ledger books payout minus stake | `settle(launchId)`: `roll = keccak256(word, game, chainId, launchId) % 10000`, C = floor(900000 / (roll + 1)); pays value x exit in RF to the Friend's canonical wallet when C >= exit, else nothing, and releases the reservation |
| Pending launch | none (the roll follows the press immediately) | Resumes by its launch ID; never burns another token, never rerolls |

**Why the jump comes before the randomness.** A real-time cash-out is not safe if the crash point is on-chain before the jump: anyone could read it (or the pending Dice word) and jump just below it. So live, the jump transaction fixes the exit multiplier first and the Dice word is requested after it, with exactly the same odds (P(C >= h) = floor(900000 / h) / 10000); the flight animation then reveals whether the rocket would have made it. A player who does not want to race block times sets an automatic jump target at launch instead (one transaction, then Dice). In the preview the whole flight is local, so the crash point can be drawn at ignition and the rocket can visibly give out.

On-chain: RF, Eggs, tier tokens, backing and every tier; live, also every slingshot launch, exit, crash point and payout. Off-chain: the baby's pixels (derived deterministically from Friend ID, parent A, parent B and play ID; genetics receives the settled tier as an input and cannot choose or change it; inherited shapes are part of those pixels), Hearts, hats, the collection, titles, breed names and the flight animation. In the preview, the slingshot multiplier is a simulated local side ledger.

## How randomness is used

Two random outcomes carry RF value: the tier and the slingshot's crash point. For the tier, the preview's SDK ledger draws one roll per settle; live, it comes from Dice as above: the Egg is burned before any randomness exists, there is no reroll, and an unsettled play resumes as **Finish hatching** without using another egg. The slingshot's crash point is drawn once, at ignition (the press), after the trade-in is confirmed; the player only decides when to jump. In the preview that roll is browser randomness: the SDK's own `samplePreviewRoll` (Web Crypto, rejection sampling to 0-9999), the same draw the preview ledger uses for eggs, and its result is a simulated local balance, which the SDK rules treat as presentation only. Live, it would come from the `Slingshot` contract's Dice request, made only after the jump transaction has fixed the exit (see above): the tier token is burned before any randomness exists, no reroll, and a pending launch resumes by its ID. The baby's rows, pattern, mutation and name come from a seeded generator, so the same pair and play always give the same baby. The three wild Friends offered (also after a Wish) and idle animations are browser-random with no RF value; the "chemistry" hearts are flavour ("Same odds for every pair").

## Economy Potential

**Today (simulated, SDK `ChanceGame` unchanged): two currencies with a hard line between them.**

- **RF, backed:** spent in exactly one place, Eggs at 1 RF. Every baby needs a new egg, and lineage asks for more: an F3 takes at least three hatches, each with fresh odds. A kept baby keeps its fixed RF value reserved inside the game until its holder trades it in. The 11.25% average house edge stays in the game contract as free stake; it is not burned.
- **Hearts, unbacked game points:** earned only by holding babies, spent only on hats and Wish matches. Nothing Hearts buy is redeemable, so they create no RF liability and need no reserve.

The two connect at the reveal card: fixed RF now, or Hearts over time plus a parent for the next generation. Rarer babies are worth more both ways (0.5 to 6 RF, or 6 to 60 Hearts a minute). Hearts never replace RF: a Wish picks a better mate, but the hatch still needs an egg.

**A second RF loop on bred babies: the Moon Slingshot (simulated multiplier).** Breed, keep, launch: every kept baby is also a stake. The trade-in runs through the SDK unchanged (`redeem`, backed, no expiry), and the slingshot puts that value back at risk on a rocket the player steers by timing alone, from x1 up to x10. Every jump returns on average 0.9x its stake whatever the timing; the 10% edge stays in the Moon Fund, which is always funded for the next x10 payout. It turns every hatch into a jackpot ticket with a choice: bank x1.5 60% of the time, or ride for the Moon (9%): a Prismatic on the Moon pays 60 RF from a 1 RF egg (1 in 444 eggs: 2.5% x 9%; in the preview that is the 6 RF trade-in into the balance plus 54 RF of simulated net booked as **Slingshot net**). Live, each launch would be its own on-chain RF action (tier token burn, Dice request, RF payout to the Friend's canonical wallet), a spending loop that keeps bred babies moving RF after the hatch; no Token Activity metrics are claimed.

**Why breeding.** Breeding is one of the longest-running NFT spending loops: CryptoKitties (2017) charged a fee for every breed and let owners rent out Kitties as sires. Rare Breeds uses each Friend's own on-chain art as its genome, so every Friend brings genes no other Friend has.

**Future work, not built.** Illustrative numbers; each needs SDK and contract support (see below). Nothing is burned or paid to other holders today, and Hearts stay game points in every row.

| Mechanic | Player pays | Where the RF goes | Egg edge |
| --- | ---: | --- | ---: |
| Today: one egg | 1 RF | Game contract, prizes backed from stake | 0.1125 RF |
| Sire fee: breed with another holder's opted-in Friend | 1.25 RF | 0.25 RF to the sire Friend's canonical wallet | 0.1125 RF |
| Generational fee: F2 and later eggs | 1.25 RF | 0.25 RF burned at purchase | 0.1125 RF |
| Burn share on every egg | 1 RF | 0.05 RF burned at purchase | 0.0625 RF |
| RF cosmetics: e.g. a 1 RF hat next to the Hearts ones | 1 RF | Burned; no payout, so no reserve | unchanged |

A sire market would turn every holder's Friend into an RF-earning asset: its art becomes breeding stock that others pay to use. Cosmetics sold for RF would be a pure sink, and hats already sit on each Friend's own art. The 6 RF per egg backing is unchanged in every row.

## Needs future SDK support

- **Persistence:** a per-Friend save for the brood, lineage, chosen pairs, Hearts, hats and the collection (the sandbox has no storage and the bridge no save API).
- **Pair commitment:** recording the parent pair with the play, so a baby's look can be rebuilt from chain state.
- **Sire market:** opt-in sire listings, RF payment to another Friend's canonical wallet, and runtime sprite reads of listed Friends. SDK v0.1.2 has no trading, revenue-share or creator-fee actions.
- **More consumables and RF sinks:** generation-priced eggs, a burn share at purchase, and RF purchases of cosmetics (one consumable, no upgrade or cosmetic action and no burn path today).
- **Unique baby tokens:** today's tier tokens are fungible per tier; minting each baby as its own NFT needs a minting API.
- **Moon Slingshot:** reward-token-as-stake actions over the bridge (`launch(outcomeId, target?)`, `jump(launchId)` and its settle), a Dice request made after the jump and pending-launch recovery, a way to move a kept reward's reserved value from the `ChanceGame` liability into the slingshot stake, and runtime confirmations for a launch and a jump. SDK v0.1.2 has one consumable and one outcome table, so the preview uses `redeem` plus a simulated side ledger for the multiplier.

## Checks

<!--
Verified on the working tree with the Moon Slingshot wired in (uncommitted): 50/50 unit tests (14 economy, 12 genetics,
8 accessories, 16 slingshot), tsc clean, dev-game check and check:games valid (4 games), tools/test-game.mjs PASS desktop
960 x 800 and phone 390 x 844 (full scenario incl. Hearts, hat, trade-in and a slingshot launch with a cancelled and a
confirmed Redeem reward), build-pages --smoke PASS, dev/scene/shoot.mjs 72 checks passed, dev/ui/shots.mjs no problems.
Preview live (to be rebuilt from the final commit). Re-run everything on the final commit and fill the TBDs.
-->

- [ ] Unit tests `node --test "games/rare-breeds/tests/*.test.ts"`: TBD of TBD pass (economy: schema, weights, exact EV, roll boundaries, backing and pause limits, hatch budget; genetics: determinism, 500 random pairs x 4 tiers give one connected body in all 64 frames, inherited rows never removed, symmetry, Side-walker through F2, tier effects, F2/F3, speed, inherited shapes at a measured rate of about 1 in 2 with no false positives and whole in every idle and walk frame of every facing, session-unique names; titles and breeds: constructed lineages, 45 unique names covering every pair; accessories: every hat on every pool Friend and bred baby in all 64 frames stays in bounds, never on ink, follows the head, stays symmetric; slingshot: the crash point over all 10,000 rolls (10% fizzle, 9% Moon, P(C >= h) = floor(900000 / h) / 10000 for every h), at most x0.9 back for every exit from x1 to x10, payouts rounded down, the multiplier curve, 0.79875 RF per egg, the 600 RF Moon Fund and its backing rule, a fund that never goes negative, records, one draw per flight booked once, the same results as the SDK's own preview ledger)
- [ ] Typecheck `npx tsc -p games/rare-breeds/tsconfig.json`: TBD
- [ ] Game validation `node scripts/dev-game.mjs check games/rare-breeds` and `npm run check:games`: TBD
- [ ] Browser test `node tools/test-game.mjs`, 960 x 800 desktop: TBD
- [ ] Browser test, 390 x 844 phone with touch: TBD
- [ ] GitHub Pages build `node tools/build-pages.mjs --smoke --base friendsdk`, deployed from the final commit: TBD
- [ ] Hosted preview reaches the SDK wallet gate with no errors: TBD
- [ ] Real-wallet playthrough with an owned Friend (desktop TBD, phone TBD): TBD

The browser test drives the real sandboxed runtime and its confirmations: the six intro steps, two full hatch loops (Spotted and Prismatic kept, +5 Hearts each; the card shows "Hatch #1 · F1" and a first "New breed" line), the Matchmaker naming what the kept Prismatic can pass on, "Breeds 2/45" in the brood, buying the Party hat once the brood has earned 20 Hearts and putting it on the Friend, then trading in the Prismatic (balance 20 - 1 - 1 + 6 = 24 RF). Then the Moon Slingshot with the kept Spotted (desktop taps the station in the world, the phone uses the first-time prompt): a cancelled **Redeem reward** changes nothing, a confirmed one (1 RF) opens the flight, a real mouse or touch press holds **Hold to fly** for 2.4 s while the multiplier climbs, letting go jumps, **Skip**, the result card shows payout, stake, net and the revealed crash point, and afterwards the brood is empty, the balance is 25 RF and the HUD shows the Slingshot net. It uses the SDK's mock wallet and sample Friend #7730; mocks are never in a build.

| Intro: your nursery | Hearts shop | Phone |
| --- | --- | --- |
| ![Intro step 2 at 960 x 800: the real room with the four stations numbered, and what each one does](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/test-intro-nursery-desktop.png) | ![Friend wearing the Party hat in the Hearts shop](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/test-shop-hat-desktop.png) | ![Nursery on a 390 x 844 phone, 1:2 portrait frame](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/test-phone-390x844.png) |

| Moon Slingshot | Hold to fly (phone) | Flight result |
| --- | --- | --- |
| ![Moon Slingshot panel at 960 x 800: baby picker, exits ladder with exact chances and payouts, launch button](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/test-slingshot-desktop.png) | ![The flight on a 390 x 844 phone: the baby strapped to its rocket, the live multiplier and payout, the big hold button](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/test-slingshot-flight-phone.png) | ![Flight result card: payout, stake, net and the revealed crash point](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/test-slingshot-result-desktop.png) |

## Known limitations and risks

- **Session-local:** reloading starts a new session (20 RF, 0 Hearts, no hats, empty brood and collection). If only the game frame reloads, kept babies are rebuilt from the ledger with a deterministic stand-in mate, so their look and generation can change.
- **Wild mates are a fixed snapshot** of 73 Friends. Their holders are not involved and earn nothing in this build.
- **On-chain, the baby is a tier token.** Its pixels are presentation until the pair is recorded with the play. Hearts and hats are local game state.
- **Moon Slingshot multiplier is simulated:** a browser roll and a local side ledger (Moon Fund, Slingshot net), labelled simulated in the game. It resets when the game frame remounts (for example after switching Friends and back); the traded-in stakes stay in the runtime ledger like any Sanctuary redemption, and a remount mid-flight leaves only the trade-in. Live play needs the `Slingshot` contract above (jump first, then Dice), which is not built.
- **Wallets and funds:** game code never receives a wallet, signer or RF; the SDK runtime owns connection, eligibility and every confirmation. The preview sends no transactions. Live mode has never run and no contract is deployed.
- Every buy, use and redeem opens a runtime confirmation by design; on a phone it covers most of the frame.
- No trading, wearable NFTs, creator fees or live economy. No Token Activity metrics are claimed. Production publication needs separate Rare Friends review.

## Credits

Character art: canonical Rare Friends Generations sprites from the FamiliesRegistry (`0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D`, chain 4663); your Friend is read live through the SDK, the 73 wild mates are a snapshot taken with `tools/fetch-wild-friends.mjs`, and babies are derived from those pixels. Sounds: FriendSDK sound kit. Wallet, Friend selection, ownership gate, simulated ledger and confirmations: FriendSDK v0.1.2 runtime (Apache-2.0, [notices](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/NOTICE.md)). Nursery, stations, hatch effects, hats, icons and pixel lettering are drawn in code: no image, font or audio files and no third-party assets. Breeding as a mechanic is a nod to CryptoKitties; no assets or code are used.
