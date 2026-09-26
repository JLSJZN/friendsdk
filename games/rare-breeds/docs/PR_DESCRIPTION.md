<!--
PR body draft for spokesz/rarefriends-vibeathon. The PR adds submissions/rare-breeds/README.md (from docs/SUBMISSION.md).
Title suggestion: Submission: Rare Breeds
Replace every TBD and pin links to the final commit SHA before opening.
-->

![Rare Breeds gameplay](https://raw.githubusercontent.com/JLSJZN/friendsdk/rare-breeds/games/rare-breeds/docs/media/gameplay.gif)

**Play: https://jlsjzn.github.io/friendsdk/** (TBD)

**Project name:** Rare Breeds
**Builder / contact:** [@JLSJZN](https://github.com/JLSJZN) · contact TBD
**Category:** Character Spotlight (primary) · Economy Potential (secondary)

Your Friend's 256 on-chain pixels are its DNA: pair it with a real Rare Friend, hatch a 1 RF egg (simulated), and the baby inherits whole pixel rows from both parents, walk cycle included.

- **Character:** you play as your verified Friend, drawn from its canonical on-chain frames. Babies are built from both parents' real rows across all 64 frames (idle and walk, four facings), kept babies follow you and breed again (F1, F2, F3), and Colossus passes on a dominant Side-walker gene.
- **Economy:** Egg 1 RF; Common 60% / 0.5 RF, Spotted 25% / 1 RF, Mutant 12.5% / 1.5 RF, Prismatic 2.5% / 6 RF; expected value 0.8875 RF per egg (11.25% house edge, kept in the game as free stake). Every egg reserves the 6 RF maximum prize; kept babies stay backed with no expiry. All simulated.
- **On-chain path:** no new contract. The SDK's existing `ChanceGame` covers it (`buy`, `play`, `settle` with Dice, `redeem`); the tier is on-chain, the pixels are deterministic presentation.
- **Future economy (not built, needs SDK support):** sire fees paid to other holders' Friend wallets, generational fees and a burn share, with the math in the submission README.
- **Wallet and network:** browser wallet on Robinhood mainnet (chain 4663) holding a hardwired Generations NFT, generation 1 or higher. No RF or signature needed for the preview.
- **Controls:** WASD / arrows or tap to walk, E / Enter / Space or tap at stations; mute and reduced motion in the HUD and Settings.
- **Checks:** TBD unit tests, typecheck TBD, `friendsdk check` TBD, browser test desktop TBD / phone TBD, real-wallet playthrough TBD.
- **Known limitations:** progress is session-local (no save API); wild mates are a fixed snapshot of 73 Friends; live mode never run.

Adds `submissions/rare-breeds/README.md`. [Source (FriendSDK v0.1.2 fork)](https://github.com/JLSJZN/friendsdk/tree/rare-breeds/games/rare-breeds) (TBD: pin to commit) · [Game README and exact rules](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/README.md) · [`game.json`](https://github.com/JLSJZN/friendsdk/blob/rare-breeds/games/rare-breeds/game.json)
