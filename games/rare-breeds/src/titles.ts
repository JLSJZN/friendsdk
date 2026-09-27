// Rare Breeds lineage titles: names a baby earns from where its 16 rows really come from (legacy.ts traces every row
// to the Friend or wild Friend whose on-chain row it is). Cosmetic only: a title never changes a baby's tier or its
// fixed Sanctuary value. Pure and deterministic (no SDK runtime import), for the cards, the collection and tests.
import { rowFamilies, rowOrigins, type CreatureLookup } from "./legacy.ts";
import { FRAME_SIZE, type Creature } from "./types.ts";

export type TitleId = "echo" | "purebred" | "chimera";
export type LineageTitle = Readonly<{ id: TitleId; label: string; detail: string }>;

/** Rows that must trace to the player's own Friend for "Echo of #<id>". */
export const ECHO_ROWS = 12;
/** Distinct real Friends a Chimera's rows must trace to. */
export const CHIMERA_FRIENDS = 4;
/** Titles stack; a baby lists every title it earns in this order. */
export const TITLE_ORDER: readonly TitleId[] = ["echo", "purebred", "chimera"];
/** Short names for tight spots (brood grid, discovery lines). */
export const TITLE_NAME: Readonly<Record<TitleId, string>> = { echo: "Echo", purebred: "Purebred", chimera: "Chimera" };

/**
 * Every title a baby earns, in TITLE_ORDER:
 * - "Echo of #<id>": at least 12 of its 16 rows trace to the player's own Friend (`friend`).
 * - "Purebred <Family>": all 16 rows trace to Friends of one family.
 * - "Chimera": its rows trace to at least 4 distinct real Friends.
 * Friends and wild Friends earn none. An unknown ancestor counts as the origin of its rows (see legacy.ts).
 */
export function lineageTitles(baby: Creature, lookup: CreatureLookup, friend?: Creature | null): LineageTitle[] {
  if (baby.kind !== "baby" || !baby.dna || !baby.parents) return [];
  const origins = rowOrigins(baby, lookup), families = rowFamilies(baby, lookup), titles: LineageTitle[] = [];
  const own = friend ? origins.filter(key => key === friend.key).length : 0;
  if (friend && own >= ECHO_ROWS) {
    titles.push({ id: "echo", label: `Echo of #${friend.tokenId ?? friend.name}`, detail: `${own} of ${FRAME_SIZE} rows from your Friend` });
  }
  if (new Set(families).size === 1) titles.push({ id: "purebred", label: `Purebred ${families[0]}`, detail: `all ${FRAME_SIZE} rows from ${families[0]} Friends` });
  const founders = new Set(origins).size;
  if (founders >= CHIMERA_FRIENDS) titles.push({ id: "chimera", label: "Chimera", detail: `rows from ${founders} different Friends` });
  return titles;
}
