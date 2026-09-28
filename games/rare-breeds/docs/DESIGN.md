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
   player's Friend or a kept baby. Parent B is a wild Friend or another kept baby. Its **Gene Lab** tab locks rows of
   the pair to one parent (Hearts, never RF).
3. **Breed**: needs 1 Egg. If there is none, buy one first (SDK `buy`, 1 simulated RF). Then SDK `play(1)`
   (uses the egg) and SDK `settle(playId)` reveal the tier (outcome). The mate walks in (courtship),
   then the hatch overlay plays: egg wobble, crack, parent rows fly in and merge, baby reveal.
4. **Result card**: baby name, tier, hatch number and generation ("Hatch #7 · F2"), breed name, lineage titles (a tap
   explains one), parents, DNA strip (16 rows coloured by parent; an inherited shape's rows marked violet), traits
   (inherited ones name their source) and news ("Inherited: Horns from Zibu!" first). Names are unique per session.
   Tapping a DNA row traces it to the real Friend it came from (pixel provenance, below).
   Keep it (joins the brood) or send it to the **Sanctuary** (SDK `redeem(outcomeId, 1)` for the fixed RF value).
5. Kept babies can be parents again: F1, F2, F3 lineage. Their shape mutations pass on about 1 in 2 (a one-time toast
   says so for the first kept baby with a shape).
6. **Moon Slingshot** station (optional), played like the casino game Crash: pick a kept baby and launch. The baby
   is traded in first (SDK `redeem(outcomeId, 1)`, runtime confirmation) and tossed out of the window onto a tiny
   firework rocket. Hold to fly, let go to jump: the multiplier climbs from x1 to x10 in 9 s, the crash point is
   drawn at ignition, a jump pays stake x multiplier (parachute into the hay), a rocket that gives out first drops
   the baby in the pond (x0), x10 lands it on the Moon. The baby is gone afterwards, even in the pond.

Every SDK buy/play/redeem shows a trusted runtime confirmation inside the frame. That is expected.

## Depth: the ledger decides the rarity, you decide the genes

- **Inherited shapes** (`src/genetics.ts`): new mutations grow only on Mutant and Prismatic hatches, but a parent's shape
  lives in its own rows, so a baby that takes them carries it in any tier, through generations. Pieces bob and walk with
  the body, so `Dna.shapes` records each shape's cells in all 16 frames of every facing it grew on (plus its source);
  its rows are the union, and a baby carries it only when it is whole in every one of those frames. A seeded wish per
  trait in the row mask ranking (after the hard checks, before the score) makes the measured pass-on rate about 1 in 2
  (53.7%, 231 of 430 in `tests/genetics.test.ts`). The Matchmaker names what a chosen parent can pass on; the Moon Slingshot picker marks babies with a shape
  or a title.
- **Gene Lab** (`src/ui/GeneLab.tsx`, `lockOptions` and `breed({ locks })` in `src/genetics.ts`): "The ledger rolls the
  rarity, you design the genes: RF buys the roll, Hearts buy the genes." A Matchmaker tab that opens with what it is for
  ("Pick which parent gives the eyes, ears or feet: lock their rows."), then Parent A, a rail of 16 row locks, a ghost
  preview (locked rows solid, free rows both parents faint; Parent A's paper band ruled in ink), a rail and Parent B,
  plus four edge shortcuts on every pair (Top rows / Bottom rows from each parent, 3 rows, `edgeLocks`) and a one-tap
  shortcut per passable shape. Only the 630 masks that agree with the locks compete, ranked as before; without locks every baby
  is byte-identical (golden test). "N of 630 possible babies" counts masks that agree, pass the hard checks and build; a
  toggle that would leave none is disabled. 2 Hearts per locked row, the first 3 of a session free, charged once the egg
  is used. The baby records its locks (`Dna.locks`), a laid egg keeps its pair and locks, and the result card marks
  locked rows with a small lock. A pair's first `lockOptions` (tens of ms) never runs in a render: warmed while idle on
  the Parents tab, else right after the lab's first paint (`useLockOptions`). Touch compromise: rows are 3 to 7 px tall,
  so phones use the 44 px shortcuts and press-slide-release on a portrait (on frames under 300 px tall, where the lab
  scrolls, a finger that travels scrolls); the rails suit mouse and keyboard.
- **Lineage titles** (`src/titles.ts`): Echo of #id (12+ of 16 rows from the player's Friend), Purebred <Family> (all
  rows one family), Chimera (rows from 4+ Friends), traced with `src/legacy.ts`. Cosmetic, they stack in that order. The
  first of each explains itself in the news, and the card's title badges are buttons that show their meaning (touch).
- **Pixel provenance** (`src/legacy.ts` `rowPath`, `rowSources`; `src/ui/Provenance.tsx`): every row of every baby is
  one real Friend's row, so a traced baby row in the DNA trio reads "Row 8 of Loma: your Friend #7730 (Hoverer) via Veve (F1)",
  and when that Friend is further up than a parent its portrait shows with the row lit (beside the parent it came
  through on wide cards, level with its row; in the caption on phones). From F2 on the card leads with the player's own
  Friend in the signal colour, "6 of 16 rows are your Friend #7730", then "rest from #50115 x7 · #159358 x3", next to
  the family line (a real test run; "Rows from N real Friends: ..." when no row is the player's). Every card's trio hint
  reads "Tap a row to see which real Friend it came from." Keys: Up/Down, Enter or Space, Escape. It must not make the
  card taller where it is tight (the 960 x 640 card is at its height limit): the path replaces the caption line, the
  portrait uses the trio's empty side margin, the sources line shares the family chips' row. Presentation only; no RF,
  odds or values.
- **Dream child** (`src/dream.ts`, `src/ui/DreamPanel.tsx`, `src/scene/bubble.ts`): "Every day your Friend dreams of a child.
  Find the mate and the rows to make it real." It gives the Gene Lab a goal. From (local date, Friend ID, round) a seeded
  wild mate (never the Friend) and one of the pair's best possible masks; the dream child is that body (Common look), so
  16 locked rows hatch it exactly. It wakes after the first hatch (a thought bubble over the Friend, a one-time toast, a
  HUD button). Clues: the picture and the mate's family; the mate's Dream tag; the dream beside the Gene Lab. Feedback
  like Mastermind after each paid hatch of the pair: "Dream match: 11 of 16 rows" and a peg per row (a row matches when it
  came from the dream's parent, or both parents draw it alike). 16 of 16: +50 Hearts once per dream, the Dreamchild
  title, a burst (none with reduced motion); Dream again. Clue strength: a fresh set of mates brings the dream mate
  27.6% of the time (1 in 4 bonus plus 3 in 72), a Wish for its family always; measured 3 to 4 eggs for a first player.
  Hearts only: the tier, its odds and `game.json` never change.
- **Breed book** (`src/breeds.ts`): 45 names, one per unordered family pair, read from the baby's label. The main goal
  (9 families, 4 tiers) stays; breeds are a side collection. The book lists unfound breeds as their dimmed family pair
  ("Skeleton × Mask ???"), so it says which parents to try. Nothing here touches odds or values.

## Economy (simulated, SDK ChanceGame)

- Consumable: **Egg**, price 1 RF (preview wallet starts with about 20 simulated RF).
- Outcomes (tiers) in `game.json`, outcomeId = index + 1, order = `TIER_ORDER` in `src/types.ts`:
  common, spotted, mutant, prismatic. Exact weights/rewards are owned by the economy module; EV below 1 RF.
- Kept babies are the "hold" choice; the Sanctuary is the fixed-price "redeem" choice.
- The Moon Slingshot is the "gamble" choice: a Sanctuary redeem (the stake, through the SDK) plus a simulated
  Crash-style multiplier side ledger in `src/slingshot.ts` (crash point C = floor(900000 / (roll + 1)) hundredths,
  so P(C >= h) = floor(900000 / h) / 10000: 10% fizzle, x2 45%, x10 9%; every exit pays back at most x0.9, exactly
  at the round ones; 600 RF simulated Moon Fund covering the x10 payout; one draw at ignition, no reroll). The HUD
  shows its payout minus stake as "Slingshot net", never mixed into the runtime RF balance.
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

## Layout (960 x 640 reference, scales down to 360 px wide = 240 px tall; portrait phones get a taller frame)

- The world canvas fills the whole game area (logical 960 x 640, CSS scaled to fit, pixel crisp).
- Portrait phones: `host.css` picks the tallest frame that fits the screen, 3:4 down to 1:2, capped at the small
  viewport height so the page never scrolls (landscape phones keep 3:2, narrowed to fit). The follow camera zooms in
  until the room's full height fills the band between the HUD and the action bar.
- The SDK runtime overlays a wallet/Friend control **bottom-left** and a menu button **bottom-right**:
  keep both corners free (about 200 x 64 px each at 960 wide).
- HUD: top-left pill (Simulated RF balance, eggs, brood count) and, from the first launch, the Slingshot net pill
  (on portrait phones it sits in the bottom band beside "Find a match"); top-right icon buttons (sound, settings/how
  to play).
- Primary action: bottom-centre button "Find a match" (also reachable by walking to the Matchmaker station).
- Stations in the world: Matchmaker (terminal with heart screen, left), Incubator (egg machine, centre-top),
  Moon Slingshot (in front of the back-wall window, between the Incubator and the Sanctuary; it shoots through
  that window), Sanctuary (gate with plants, right). Walking near shows a prompt; E/Enter/Space or tap activates.
- Moon Slingshot flight: a full-area overlay with its own canvas (side view: the rocket climbs past the nursery roof
  x1.5, cloud nine x2, the orbit x4 to the Moon x10; portrait phones see a taller slice of it, panned to the action),
  a live multiplier counter on top, a big **Hold to fly** button at the bottom (pointer, touch, Space or Enter),
  **Don't fly** before ignition, **Skip** (= jump now), then a result card with the revealed crash point and the
  record to chase ("New record: x5.23!"); reduced motion keeps the baby
  still on its rocket (the counter carries the climb) and fades to the ending. A key held through an ending the rocket
  chose presses nothing until released; while paused the hold button stays focused (aria-disabled).
- Panels open as centred cards over the world; the world pauses while a panel is open.

## Module ownership

| Path | Owner | Notes |
| --- | --- | --- |
| `src/types.ts`, `src/api.ts`, `src/sprites.ts`, `src/draw.ts`, `docs/DESIGN.md` | lead | shared contract |
| `src/genetics.ts`, `src/names.ts`, `tests/genetics.test.ts` | genetics agent | pure, deterministic |
| `src/titles.ts`, `src/breeds.ts`, `tests/titles.test.ts`, `tests/breeds.test.ts` | genetics agent | lineage titles and the breed book; pure, cosmetic |
| `src/scene/**` | renderer agent | implements `NurseryScene`, `HatchSequence` |
| `src/ui/**`, `style.css` | UI agent | React 19 components, props only |
| `game.json`, `src/economy.ts`, `tests/economy.test.ts`, `tools/**`, test/video scripts | infra agent | |
| `src/slingshot.ts`, `tests/slingshot.test.ts` | lead | Moon Slingshot crash point, multiplier curve, exits, payouts, Moon Fund and backing rule; simulated side ledger (`createFlightDesk` in `useSlingshot`: draw at ignition, book once; `topExit` is the record) |
| `src/scene/launch.ts` | renderer agent | `createLaunchSequence` (`LaunchSequence` in `src/api.ts`): the rocket flight, presentation only (ignite, fly, end); `NurseryScene.playLaunch` lives in `src/scene/nursery.ts` |
| `src/ui/GeneLab.tsx`, `tests/genelab.test.ts`, `dev/ui/lab-check.mjs` | UI agent, genetics agent | Gene Lab bench (portraits, rails, preview, edge and shape shortcuts, deferred first `lockOptions`) and its proofs: golden no-lock babies, locked rows in all 64 frames, disabled toggles, edge and shape shortcuts, row hit test |
| `src/ui/SlingshotPanel.tsx`, `src/ui/LaunchOverlay.tsx` | UI agent | Station panel (baby picker, exits ladder, launch button) and the flight overlay: the flight clock, hold input, live counter and result card |
| `src/dream.ts`, `src/ui/DreamPanel.tsx`, `src/scene/bubble.ts`, `tests/dream.test.ts` | lead | Dream child: the day's dream (mate, mask, child), match counting, the once-per-dream reward, the Matchmaker's mate draw (`pickMates`, `wishMates`), the panel and the nursery bubble; proofs of validity, exact full locks and measured solvability |
| `index.tsx`, `README.md` | lead | integration |

Relative imports inside the game use explicit `.ts`/`.tsx` extensions (esbuild bundles them; node
runs tests with built-in type stripping: `node --test "games/rare-breeds/tests/*.test.ts"`).
Pure modules must not import `@rarefriends/friendsdk/*` at runtime (type-only imports are fine).
