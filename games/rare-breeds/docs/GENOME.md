# Rare Breeds genome

A Rare Breeds baby is a pure function of a few public inputs and the canonical pixels of its parents. This page
specifies that function as implemented in [`src/genetics.ts`](../src/genetics.ts) (breeding) and
[`src/legacy.ts`](../src/legacy.ts) (provenance), so another Rare Friends game or tool can rebuild a baby and check it.
Both modules are pure and deterministic and import no SDK runtime code (only `src/types.ts`, `src/sprites.ts` and
`src/names.ts`, whose one SDK import is type-only).

**License.** Rare Breeds lives in a fork of FriendSDK whose root [`LICENSE`](../../../LICENSE) is Apache-2.0
(`package.json`: `"license": "Apache-2.0"`); the game adds no license file of its own. The pixels are canonical Rare
Friends Generations artwork, whose use in games and related projects [`NOTICE.md`](../../../NOTICE.md) permits with
the asset source attribution kept.

## Inputs

| Input | Type | Meaning |
| --- | --- | --- |
| `friendId` | bigint | Token ID of the holder's verified Friend (the session's Friend) |
| `a`, `b` | `Creature` | Parent A and parent B: 64 one-bit 16 x 16 frames (`sheet`), `familyId`, `lineage`; a baby parent also has `parents` and `dna` |
| parent keys | string | `friend:<tokenId>` for the holder's Friend, `wild:<tokenId>` for a wild Friend, `baby:<playId>` for a bred baby. The key, not only the token ID, is hashed |
| `playId` | bigint | The SDK play that hatched the baby |
| `tier` | `TierId` | The settled outcome: `TIER_ORDER[outcomeId - 1]` (common, spotted, mutant, prismatic). Genetics receives it, it never chooses it |
| `locks` | optional, 16 x (0, 1 or null) | Gene Lab row locks: row y must come from parent A (0) or B (1); null leaves it free |
| `takenNames` | optional set | Names already used this session; changes only the name (re-rolled deterministically) |

A parent's frames come from the FamiliesRegistry: live through the SDK (`creatureFromGenerationSprites(await
createFriendReader().read(id))`, as `src/controller.ts` does), offline from the snapshot in
[`data/wild-friends.json`](../data/wild-friends.json) (`creatureFromRecord`). A baby parent is itself rebuilt from its
own inputs, recursively.

## Seed

`breedSeed(friendId, aKey, bKey, playId)` is the 32-bit FNV-1a hash of `rare-breeds|<friendId>|<aKey>|<bKey>|<playId>`.
Each decision draws from its own mulberry32 stream of that seed, salted by name (`rows`, `heirs`, `heir-rows`,
`mutation`, `pattern`), so the decisions stay uncorrelated. Swapping A and B gives a different seed.

## The 630 row masks

`dna.rowSource[y]` says which parent row y came from (0 = A, 1 = B). A mask is alternating runs of 2 to 5 rows,
either parent first, so each parent gives at least 4 rows. There are exactly 630 such masks (`ALL_MASKS`,
`MASK_COUNT`). One mask covers all 64 frames (idle and walk, four facings, eight frames each), so a baby's walk cycle is
a row mix of both parents' walk cycles.

## Ranking and repair

- **Without locks** (`rankRows`): seeded masks are drawn (at most 64) until 16 pass the hard checks on idle frame 0 of
  the down and right views (right only for Side-walkers): ink at least max(12, 40% of the lighter parent), at most 6
  bridge pixels, at least 6 pixels different from each parent. When a parent carries a shape mutation, up to 16 masks
  that grant every seeded inheritance wish (one per shape, take it or leave it, 1 in 2) join. Order: passes the hard
  checks, then fewest broken wishes, then score (bridge pixels, balance between parents, seam quality, distinctness).
- **With locks** (`rankLocked`): the candidates are the masks that agree with the locks among the pair's possible masks
  (all 630 assessed once per pair: hard checks passed and every frame builds), in the same seeded order; the number of
  finalists scales with the smaller pool, then the same order applies. A lock set no mask agrees with is ignored.
  `lockOptions` reports what the Gene Lab shows: possible babies, which toggles keep at least one, and each shape's odds;
  `edgeLocks` its Top rows / Bottom rows shortcuts (3 rows of one parent from the pair's first or last inked row). Both
  only read the pair's report, so they never change a baby.
- **Build and repair:** the first ranked mask whose 64 frames all keep their ink floor wins. Each frame is joined into
  one 8-connected body by the cheapest bridges (fewest added pixels, mirrored in symmetric front and back views). No
  inherited pixel is ever removed. Degenerate parents fall back to a fixed half and half mask (with locks, the best agreeing one).
- **Side-walker:** a Colossus parent (or a Side-walker baby) has no front or back art, so the baby shows its
  right-facing frames from every side, through every generation.

## Tier effects

`breed` picks the row mask before it reads the tier, so the tier changes only what grows on top:

| Tier | Effect |
| --- | --- |
| Common | Pure ink rows, no pattern |
| Spotted | One design in the accent colour: spots, stripes or a patch (a patterned parent's kind is tried first) |
| Mutant | A design plus a head mutation (antennae, horns, ears or crest; a tail when no head kind fits) |
| Prismatic | Rainbow coat (with darker bands or spots while it still covers most of the body), a head mutation (bold when it fits) and a tail when one fits |

Inherited shapes are checked first, on the body before anything grows: a baby carries a parent's shape only when every
row of it came from that parent and every one of its cells is ink in all 16 frames of each facing it grew on
(`inheritedShapes`). What a baby already carries is never grown twice.

## rowSource and provenance

A baby's row y is always row y of one parent (plus bridge and mutation pixels), so following `rowSource` down the family
tree ends at a Friend or wild Friend whose on-chain row it is. [`src/legacy.ts`](../src/legacy.ts):

- `rowPath(baby, y, lookup)`: every baby the row passed through, with its side and generation, ending at the origin's
  key, family and token ID.
- `rowSources(baby, lookup)`: the distinct real Friends behind the 16 rows, most rows first, with their rows.
- One memoised tracer: an unknown parent ends a path at the key its child names, cycles and chains deeper than 256
  generations end safely.

## Determinism guarantees

| Guarantee | Proof |
| --- | --- |
| The seed covers every input and their order | `tests/genetics.test.ts`: "breedSeed is a stable unsigned 32-bit hash of all inputs" |
| Same input, same baby (64 frames, pattern, Dna, name, family) | `tests/genetics.test.ts`: "breed is deterministic for the same input"; `tests/genelab.test.ts`: the same locks and play give the same baby |
| Babies without locks are byte-identical to the genetics before the Gene Lab | `tests/genelab.test.ts`: golden digests of 70 samples in all 4 tiers; all-free locks and impossible lock sets give that same baby |
| Every locked row comes from the chosen parent in all 64 frames | `tests/genelab.test.ts`: 1,428 locked rows of 267 babies with random allowed lock sets |
| One connected body, no inherited pixel removed | `tests/genetics.test.ts`: 500 random pairs x 4 tiers; "row sources are real" |
| The name re-roll changes nothing else | `tests/genetics.test.ts`: "a name already used this session is re-rolled, deterministically, and changes nothing else" |
| Provenance matches an independent oracle and never throws | `tests/legacy.test.ts`: `rowOrigins`, `rowPath`, `rowSources` from F1 to F3, Side-walkers, missing data, cycles, 400 generations |

The guarantee holds for this code version: a change that alters any sampled baby fails the golden test
(`GOLDEN_PRINT=1` reprints the digests, only after an intended change). Run all of it with
`node --test "games/rare-breeds/tests/*.test.ts"` (101 of 101 pass).

## Recipe: rebuild and verify a baby

From the SDK root (Node.js 22.18+, built-in type stripping), save as `verify-baby.ts` and run `node verify-baby.ts`:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { breed, breedSeed } from "./games/rare-breeds/src/genetics.ts";
import { rowSources } from "./games/rare-breeds/src/legacy.ts";
import { creatureFromRecord, type WildFriendRecord } from "./games/rare-breeds/src/sprites.ts";
import { FACINGS, TIER_ORDER, type Creature, type RowLock } from "./games/rare-breeds/src/types.ts";

// Offline: the snapshot of canonical frames. Live: creatureFromGenerationSprites(await createFriendReader().read(id)).
const records: WildFriendRecord[] = JSON.parse(readFileSync("games/rare-breeds/data/wild-friends.json", "utf8")).friends;
const record = (id: string) => records.find(friend => friend.id === id)!;
const known = new Map<string, Creature>();
const remember = (creature: Creature) => (known.set(creature.key, creature), creature);

/** The baby of one settled play, exactly as the game builds it (controller.ts makeBaby). */
function rebuild(friendId: bigint, a: Creature, b: Creature, playId: bigint, outcomeId: number, locks?: readonly RowLock[]): Creature {
  const tier = TIER_ORDER[outcomeId - 1];
  const result = breed({ a, b, tier, playId, seed: breedSeed(friendId, a.key, b.key, playId), locks });
  return remember(Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId,
  }));
}

/** All 64 frames as one digest, to compare with the baby another tool shows. */
const frameDigest = (creature: Creature) => createHash("sha256").update(Buffer.concat((["idle", "walk"] as const)
  .flatMap(clip => FACINGS.flatMap(facing => creature.sheet[clip][facing].map(frame => Buffer.from(frame)))))).digest("hex").slice(0, 16);

// Friend #77949 breeds two F1s with wild Friends, then their F2 (the tests/legacy.test.ts fixture).
const friend = remember(creatureFromRecord(record("77949"), "friend"));
const razu = rebuild(77949n, friend, remember(creatureFromRecord(record("172863"))), 1n, 2);
const baba = rebuild(77949n, friend, remember(creatureFromRecord(record("78874"))), 2n, 1);
const rimi = rebuild(77949n, razu, baba, 3n, 3);

console.log(rimi.name, `F${rimi.lineage}`, rimi.family, rimi.tier, rimi.dna.rowSource.join(""), frameDigest(rimi));
console.log(rowSources(rimi, key => known.get(key)).map(source => `#${source.tokenId} x${source.rows.length}`).join(" · "));
```

Output, the same on every run:

```text
Rimi F2 Mask × Sparkling mutant 1111000111000111 51024548a88a7afc
#77949 x7 · #78874 x6 · #172863 x3
```

To verify a baby another tool shows, rebuild it from the same inputs and compare `rowSource`, the frame digest and, for
a Gene Lab baby, `dna.locks`. Inside the game, `takenNames` can change a baby's name, and nothing else.

**Limits.** The preview records the inputs only in the game frame, not on-chain; rebuilding a baby from chain state
needs the parent pair and locks recorded with the play (see
[Needs future SDK support](SUBMISSION.md#needs-future-sdk-support)).
