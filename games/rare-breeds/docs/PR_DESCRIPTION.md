- **▶ Play:** https://jlsjzn.github.io/friendsdk/
- **🎬 Start here, the interactive guide and 45 s trailer:** https://jlsjzn.github.io/friendsdk/preview/

**The guide explains the whole game in detail and is worth a look before playing.** No wallet needed: scroll through one egg while its 16 pixel rows fly from both parents into the baby, lock rows from either parent, hatch any two of the 73 real Friends in the DNA lab and trace their pixel ancestry with the game's own hatch animation, and fly the Moon Slingshot yourself (hold to climb, let go to jump). It runs the game's real genetics and scenes, so it is the fastest way to see what only Rare Breeds does. It is an explainer, not the game: no RF, nothing saved; playing goes through the SDK wallet gate.

[![Rare Breeds interactive guide and trailer: a Prismatic baby hatching. Click to open the guide.](https://raw.githubusercontent.com/JLSJZN/friendsdk/4e2167b/games/rare-breeds/docs/media/trailer-poster.png)](https://jlsjzn.github.io/friendsdk/preview/)

![Rare Breeds gameplay](https://raw.githubusercontent.com/JLSJZN/rarefriends-vibeathon/submission/rare-breeds/submissions/rare-breeds/media/gameplay.gif)

*Demo capture from the SDK test runtime; the tiers in this clip are scripted for the demo.*

**Play: https://jlsjzn.github.io/friendsdk/** (connect a wallet holding a hardwired Friend, pick it, click through the intro, Find a match, Buy egg & breed. Everything is simulated, nothing is signed or spent.)

**Project name:** Rare Breeds
**Builder / contact:** [@JLSJZN](https://github.com/JLSJZN) · X [@JLSJZN](https://x.com/JLSJZN) · Telegram [@JLSJZN](https://t.me/JLSJZN)
**Category:** Character Spotlight (primary) · Economy Potential (secondary)

Your Friend's 256 on-chain pixels are its DNA: pair it with a real Rare Friend, hatch a 1 RF egg (simulated), and the baby inherits whole pixel rows from both parents, walk cycle included.

**Features**
- **Gene Lab:** lock pixel rows to either parent, see the possible-baby count and hatch the design. Two Hearts per locked row, the first three of the session free; paid only when the egg is used. RF odds and values stay unchanged.
- **Dream child:** a daily target for your Friend. Find the hinted mate, use the Gene Lab and read 16-row feedback after each hatch. A complete match earns 50 Hearts once per dream and the Dreamchild title. Progress is session-local.
- **Pixel provenance:** tap a baby's row and follow it through every generation to the original real Friend token ID. The open genome recipe is documented in GENOME.md.
- **Pixel genetics:** babies are built from both parents' real rows across all 64 frames (idle and walk, four facings); Colossus passes on a dominant Side-walker gene.
- **Brood and lineage:** kept babies follow your Friend and breed again (F1, F2, F3).
- **Hearts:** session game points only kept babies earn (6 to 60 a minute by tier, +5 per Keep). Never RF, never redeemable, so no reserve.
- **Hearts shop:** 8 hats (20 to 250 Hearts) anchored frame by frame to each Friend's own head, never covering its art; Wish match (15 Hearts) for mates from a chosen family.
- **Collection goal:** all 9 families and all 4 tiers.
- **Genes you breed for (new):** the ledger decides the rarity, you decide the genes. Mutations still grow only on Mutant and Prismatic hatches, but babies inherit a parent's horns, ears, crest, antennae or tail in any tier, Common included, about 1 in 2 (53.7% measured (231 of 430), checked whole in every idle and walk frame). The Matchmaker names what a parent can pass on, the card says whose it was ("Inherited: Horns from Zibu!").
- **Titles and breed book (new):** cosmetic lineage titles (Echo of your Friend, Purebred, Chimera, "just for show"), a hatch number on every card, and a named breed for each of the 45 family pairs ("Ghost Bones", "Blimp", "Glitter Bandit") in a breed book.
- **Moon Slingshot, now played like Crash (new):** a kept baby is traded in through the SDK (runtime-confirmed `redeem`, its value is the stake), then hold to fly and let go to jump: the baby rides a firework rocket past the roof (x1.5), cloud nine (x2) and the orbit (x4) towards the Moon (x10), and parachutes out with stake x multiplier unless the rocket gives out first (the pond). The crash point is drawn once at ignition with exact odds (10% fizzle, x2 45%, Moon 9%); every exit returns at most 0.9x on average, so timing changes risk, not value. Best-jump record, labelled simulated side ledger backed by a 600 RF Moon Fund; live it needs its own Slingshot contract (not built).
- **DNA card:** parent A, the baby and parent B side by side on one 16-row grid; hover or tap a row to trace it (your Friend's rows white, the mate's green).
- **Your Friend's legacy:** descendants, deepest generation, the share of the brood's pixel rows that are still your Friend's own, and a family tree rooted at it (tap the Friend).
- **Less friction:** fresh wild mates after every hatch (one from an uncollected family preselected), "Stock up: 5 eggs" in one confirmation, a 1.8 s hatch cut after the first two (Mutant and Prismatic keep the full show).
- **Onboarding:** six-step intro (a map of the four stations drawn from the real room, what to do with a baby, a legend of the HUD), first-time hints, odds strip, the same legends in "?", Replay intro.
- **Phone layout:** a portrait frame as tall as the screen allows (3:4 up to 1:2, capped to the visible height), landscape without page scroll, a full-frame flight and a follow camera.

**Details**
- **Economy (simulated):** Egg 1 RF; Common 60% / 0.5 RF, Spotted 25% / 1 RF, Mutant 12.5% / 1.5 RF, Prismatic 2.5% / 6 RF; expected value 0.8875 RF per egg (11.25% house edge, kept in the game as free stake). Every egg reserves the 6 RF maximum prize; kept babies stay backed with no expiry.
- **On-chain path:** no new contract for the egg loop. The SDK's existing `ChanceGame` covers it (`buy`, `play`, `settle` with Dice, `redeem`); the tier is on-chain, the pixels are deterministic presentation, Hearts and hats stay off-chain.
- **Future economy (not built, needs SDK support):** sire fees paid to other holders' Friend wallets, generational fees, a burn share and RF cosmetics as a burn sink, with the math in the submission README.
- **Wallet and network:** browser wallet on Robinhood mainnet (chain 4663) holding a hardwired Generations NFT, generation 1 or higher. No RF or signature needed for the preview.
- **Controls:** WASD / arrows or tap to walk, E / Enter / Space or tap at stations, heart counter for the shop; mute and reduced motion in the HUD and Settings.
- **Checks:** 101/101 unit tests, three clean TypeScript checks, valid game configuration, unchanged RF economy, desktop and touch-phone gameplay tests, and GitHub Pages smoke check pass. The Gene Lab passed 480 row hit tests; the guide passed lock, hatch and ancestry checks at 1280, 390 and 360 pixels. Publication of this release is pending. Real-wallet playthrough on desktop and a physical phone remains open.
- **Known limitations:** progress, Hearts and hats are session-local (no save API); wild mates are a fixed snapshot of 73 Friends; live mode never run.

Adds `submissions/rare-breeds/README.md`. Guide and game source share branch `rare-breeds`; the guide is built with `node tools/build-preview.mjs`. [Source (FriendSDK v0.1.2 fork)](https://github.com/JLSJZN/friendsdk/tree/rare-breeds/games/rare-breeds) (release links pinned when published) · [Game README and exact rules](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/README.md) · [`game.json`](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/game.json)

This PR is updated during the event.
