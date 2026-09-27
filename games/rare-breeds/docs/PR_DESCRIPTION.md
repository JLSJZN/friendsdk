<!--
PR body draft for spokesz/rarefriends-vibeathon. The PR adds submissions/rare-breeds/README.md (from docs/SUBMISSION.md).
Title suggestion: Submission: Rare Breeds
Replace every TBD and pin links to the final commit SHA before opening. New features go into "Features" as one more bullet.
-->

![Rare Breeds gameplay](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/gameplay.gif)

**Play: https://jlsjzn.github.io/friendsdk/**

**Project name:** Rare Breeds
**Builder / contact:** [@JLSJZN](https://github.com/JLSJZN) · X [@JLSJZN](https://x.com/JLSJZN) · Telegram [@JLSJZN](https://t.me/JLSJZN)
**Category:** Character Spotlight (primary) · Economy Potential (secondary)

Your Friend's 256 on-chain pixels are its DNA: pair it with a real Rare Friend, hatch a 1 RF egg (simulated), and the baby inherits whole pixel rows from both parents, walk cycle included.

**Features**
- **Pixel genetics:** babies are built from both parents' real rows across all 64 frames (idle and walk, four facings); Colossus passes on a dominant Side-walker gene.
- **Brood and lineage:** kept babies follow your Friend and breed again (F1, F2, F3).
- **Hearts:** session game points only kept babies earn (6 to 60 a minute by tier, +5 per Keep). Never RF, never redeemable, so no reserve.
- **Hearts shop:** 8 hats (20 to 250 Hearts) anchored frame by frame to each Friend's own head, never covering its art; Wish match (15 Hearts) for mates from a chosen family.
- **Collection goal:** all 9 families and all 4 tiers.
- **Moon Slingshot:** hold to pull, let go: a kept baby is traded in through the SDK (runtime-confirmed `redeem`, its value is the stake) and shot out of the window; six zones from the pond (x0, 40%) to the Moon (x10, 2%) multiply the stake, 0.9x on average. The multiplier is a labelled simulated side ledger backed by a 600 RF Moon Fund; live it needs its own Slingshot contract (not built).
- **Onboarding:** six-step intro (a map of the four stations drawn from the real room, what to do with a baby, a legend of the HUD), first-time hints, odds strip, the same legends in "?", Replay intro.
- **Phone layout:** 3:4 portrait frame and follow camera.

**Details**
- **Economy (simulated):** Egg 1 RF; Common 60% / 0.5 RF, Spotted 25% / 1 RF, Mutant 12.5% / 1.5 RF, Prismatic 2.5% / 6 RF; expected value 0.8875 RF per egg (11.25% house edge, kept in the game as free stake). Every egg reserves the 6 RF maximum prize; kept babies stay backed with no expiry.
- **On-chain path:** no new contract for the egg loop. The SDK's existing `ChanceGame` covers it (`buy`, `play`, `settle` with Dice, `redeem`); the tier is on-chain, the pixels are deterministic presentation, Hearts and hats stay off-chain.
- **Future economy (not built, needs SDK support):** sire fees paid to other holders' Friend wallets, generational fees, a burn share and RF cosmetics as a burn sink, with the math in the submission README.
- **Wallet and network:** browser wallet on Robinhood mainnet (chain 4663) holding a hardwired Generations NFT, generation 1 or higher. No RF or signature needed for the preview.
- **Controls:** WASD / arrows or tap to walk, E / Enter / Space or tap at stations, heart counter for the shop; mute and reduced motion in the HUD and Settings.
- **Checks:** TBD unit tests, typecheck TBD, `friendsdk check` TBD, browser test desktop TBD / phone TBD, real-wallet playthrough TBD.
- **Known limitations:** progress, Hearts and hats are session-local (no save API); wild mates are a fixed snapshot of 73 Friends; live mode never run.

Adds `submissions/rare-breeds/README.md`. [Source (FriendSDK v0.1.2 fork)](https://github.com/JLSJZN/friendsdk/tree/rare-breeds/games/rare-breeds) (TBD: pin to commit) · [Game README and exact rules](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/README.md) · [`game.json`](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/game.json)
