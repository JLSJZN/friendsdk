# Rare Breeds - design brief

> Your Friend's 256 on-chain pixels are its DNA.

Rare Breeds is a FriendSDK v0.1.2 game for the Rare Friends Vibeathon (deadline 2026-09-30).
The player's verified Friend picks a mate from real Rare Friends (canonical on-chain art),
an egg hatches, and the baby genuinely inherits pixel rows from both parents, walk cycle included.
Kept babies follow the parent around the nursery in a little line, like ducklings.

Target categories: Character Spotlight (primary), Economy Potential (secondary).
Judges test solo, quickly, with a real holder wallet, on desktop and phone. First impression matters most.

## Core loop (2-3 minutes)

1. **Nursery**: the player's Friend walks around (WASD/arrows, tap/click to walk). Babies follow.
2. **Matchmaker** station: 3 real wild Friends are offered as mates (free reroll). Parent A is the
   player's Friend or a kept baby. Parent B is a wild Friend or another kept baby.
3. **Breed**: needs 1 Egg. If there is none, buy one first (SDK `buy`, 1 simulated RF). Then SDK `play(1)`
   (uses the egg) and SDK `settle(playId)` reveal the tier (outcome). The mate walks in (courtship),
   then the hatch overlay plays: egg wobble, crack, parent rows fly in and merge, baby reveal.
4. **Result card**: baby name, tier, parents, DNA strip (16 rows coloured by parent), traits.
   Keep it (joins the brood) or send it to the **Sanctuary** (SDK `redeem(outcomeId, 1)` for the fixed RF value).
5. Kept babies can be parents again: F1, F2, F3 lineage.
6. **Moon Slingshot** station (optional): pick a kept baby, hold to pull the band, let go. The baby is traded in
   first (SDK `redeem(outcomeId, 1)`, runtime confirmation), then the zone is drawn and the baby flies out through
   the window; the landing zone multiplies its value (x0 to x10). The baby is gone afterwards, even in the pond.

Every SDK buy/play/redeem shows a trusted runtime confirmation inside the frame. That is expected.

## Economy (simulated, SDK ChanceGame)

- Consumable: **Egg**, price 1 RF (preview wallet starts with about 20 simulated RF).
- Outcomes (tiers) in `game.json`, outcomeId = index + 1, order = `TIER_ORDER` in `src/types.ts`:
  common, spotted, mutant, prismatic. Exact weights/rewards are owned by the economy module; EV below 1 RF.
- Kept babies are the "hold" choice; the Sanctuary is the fixed-price "redeem" choice.
- The Moon Slingshot is the "gamble" choice: a Sanctuary redeem (the stake, through the SDK) plus a simulated
  multiplier side ledger in `src/slingshot.ts` (six zones, x0.9 on average, 600 RF simulated Moon Fund, one draw
  after the confirmation, no reroll). The HUD shows its payout minus stake as "Slingshot net", never mixed into the
  runtime RF balance.
- Everything is labelled "Simulated RF". Never call the house edge a burn.

## Art direction

Match the Rare Friends brand: crisp 1-bit pixel art, monochrome, one signal accent.

- Palette: paper `#F4F1EA`, floor grid `#E6E1D6`, ink `#111111`, halo `#FFFFFF`,
  signal green `#CCFF00` (brand accent), panel black `#111111`, panel text `#F4F1EA`, muted `#8C877D`.
- Tier accents in `TIER_STYLE` (`src/types.ts`): spotted green, mutant violet, prismatic gold/rainbow shimmer.
- Creatures: draw with `drawCreature` from `src/draw.ts` (ink + 1-sprite-pixel white halo, sticker look).
  Integer scales only. Player Friend scale 3 (48 px), babies scale 2 (32 px), UI thumbnails 3-5.
- World props are drawn procedurally in the same 1-bit style (ink outlines, paper fills, small green accents).
  No external images or fonts (sandbox CSP: `default-src 'none'`, images only self/blob/data).
- Typography: system UI font for text, `ui-monospace` for numbers/labels. Uppercase small labels with letter spacing.
- UI panels: black `#111` cards with 2px ink border, 0 or 4px radius, green focus rings, big touch targets (min 44px).
- Motion: snappy and playful (squash/stretch on hatch, hearts, confetti pixels). Everything has a reduced-motion
  variant (fades or instant) when `reducedMotion` is true.

## Layout (960 x 640 reference, scales down to 360 px wide = 240 px tall)

- The world canvas fills the whole game area (logical 960 x 640, CSS scaled to fit, pixel crisp).
- The SDK runtime overlays a wallet/Friend control **bottom-left** and a menu button **bottom-right**:
  keep both corners free (about 200 x 64 px each at 960 wide).
- HUD: top-left pill (Simulated RF balance, eggs, brood count) and, from the first launch, the Slingshot net pill;
  top-right icon buttons (sound, settings/how to play).
- Primary action: bottom-centre button "Find a match" (also reachable by walking to the Matchmaker station).
- Stations in the world: Matchmaker (terminal with heart screen, left), Incubator (egg machine, centre-top),
  Moon Slingshot (in front of the back-wall window, between the Incubator and the Sanctuary; it shoots through
  that window), Sanctuary (gate with plants, right). Walking near shows a prompt; E/Enter/Space or tap activates.
- Moon Slingshot flight: a full-area overlay with its own canvas (side view past the zones), **Skip**, then a
  result card; reduced motion fades to the landing.
- Panels open as centred cards over the world; the world pauses while a panel is open.

## Module ownership

| Path | Owner | Notes |
| --- | --- | --- |
| `src/types.ts`, `src/api.ts`, `src/sprites.ts`, `src/draw.ts`, `docs/DESIGN.md` | lead | shared contract |
| `src/genetics.ts`, `src/names.ts`, `tests/genetics.test.ts` | genetics agent | pure, deterministic |
| `src/scene/**` | renderer agent | implements `NurseryScene`, `HatchSequence` |
| `src/ui/**`, `style.css` | UI agent | React 19 components, props only |
| `game.json`, `src/economy.ts`, `tests/economy.test.ts`, `tools/**`, test/video scripts | infra agent | |
| `src/slingshot.ts`, `tests/slingshot.test.ts` | lead | Moon Slingshot zones, odds, payouts, Moon Fund and backing rule; simulated side ledger (`useSlingshot`) |
| `src/scene/launch.ts` | renderer agent | `createLaunchSequence` (`LaunchSequence` in `src/api.ts`): the flight overlay; `NurseryScene.playLaunch` lives in `src/scene/nursery.ts` |
| `src/ui/SlingshotPanel.tsx`, `src/ui/LaunchOverlay.tsx` | UI agent | Station panel (baby picker, zone ladder, hold-to-pull button) and the flight overlay with the result card |
| `index.tsx`, `README.md` | lead | integration |

Relative imports inside the game use explicit `.ts`/`.tsx` extensions (esbuild bundles them; node
runs tests with built-in type stripping: `node --test "games/rare-breeds/tests/*.test.ts"`).
Pure modules must not import `@rarefriends/friendsdk/*` at runtime (type-only imports are fine).
