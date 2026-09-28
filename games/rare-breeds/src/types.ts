// Shared contract for Rare Breeds. Owned by the project lead: change only by agreement.
// Pure types, no runtime imports, so every module and node test can import it.

export const FRAME_SIZE = 16;
/** One 16 x 16 one-bit frame, row-major (index = y * 16 + x), 1 = ink. */
export type Frame = Uint8Array;
export type Facing = "down" | "up" | "left" | "right";
export const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];
export type Clip = "idle" | "walk";
/** 8 frames per clip and facing, same layout as the SDK registry (idle 0-31, walk 32-63). */
export type SpriteSheet = Readonly<Record<Clip, Readonly<Record<Facing, readonly Frame[]>>>>;

/** Hatch rarity. Index order matches game.json outcomes (outcomeId = index + 1). */
export type TierId = "common" | "spotted" | "mutant" | "prismatic";
export const TIER_ORDER: readonly TierId[] = ["common", "spotted", "mutant", "prismatic"];

export type Dna = Readonly<{
  /** For each of the 16 rows: which parent the row came from (0 = parent A, 1 = parent B). */
  rowSource: readonly (0 | 1)[];
  /** Sprite-space stencil (256 entries, 1 = ink pixel drawn in the tier accent colour). Empty for common. */
  pattern: Uint8Array;
  /** Sprite-space cells added by shape mutation (index list), for the DNA card. */
  mutations: readonly number[];
  /** Human readable mutation labels, e.g. ["Antennae", "Stripes"]; inherited shapes read "Horns (from Zibu)". */
  traits: readonly string[];
  /** Shape mutations the baby carries, grown at this hatch or inherited (optional: absent on older data). */
  shapes?: readonly ShapeTrait[];
  /** Gene Lab: the 16 row locks the baby was bred with (null = free); every locked row matches rowSource. Absent without locks. */
  locks?: readonly RowLock[];
}>;

/** Gene Lab row lock: the row must come from parent A (0) or parent B (1); null leaves it to the seeded mask. */
export type RowLock = 0 | 1 | null;

/** Frames per facing: idle 0-7, then walk 0-7 (the order of ShapeTrait.cells lists). */
export const FACING_FRAMES = 16;

/**
 * A shape mutation (antennae, horns, ears, crest, tail or a bold variant). Rows are copied in place, so its cells are
 * the same in every descendant that carries it, and a descendant carries it when it took all of those rows from that
 * parent. Pieces follow the body while it bobs and walks, so the rows can differ from frame to frame.
 */
export type ShapeTrait = Readonly<{
  /** Trait label, e.g. "Horns", "Big Horns", "Tail". */
  label: string;
  kind: "head" | "tail";
  /**
   * Its cells in every frame of each facing it grew on: FACING_FRAMES lists per facing (idle 0-7, then walk 0-7).
   * Side-walkers only have "right" and "left" (their front and back reuse the right frames).
   */
  cells: Readonly<Partial<Record<Facing, readonly (readonly number[])[]>>>;
  /** Inherited: the parent it came from (0 = parent A, 1 = parent B) and that parent's name. Absent when it grew at this hatch. */
  from?: Readonly<{ side: 0 | 1; name: string }>;
}>;

export type CreatureKind = "friend" | "wild" | "baby";

/** Cosmetic head accessories bought with Hearts (catalog and pixel art in src/accessories.ts). */
export type AccessoryId = "party-hat" | "bow" | "flower" | "beanie" | "headphones" | "top-hat" | "crown" | "halo";

export type Creature = Readonly<{
  /** Stable unique key: "friend:<id>", "wild:<id>", "baby:<playId>". */
  key: string;
  kind: CreatureKind;
  /** On-chain token ID for friend and wild creatures. */
  tokenId?: bigint;
  /** Display name: "Friend #77949" or a generated baby name such as "Zibu". */
  name: string;
  /** Family label: SDK family name, or "Cellular × Hollow" for babies. */
  family: string;
  /** SDK family id (0-8) for friend/wild; dominant parent family for babies. */
  familyId: number;
  /** Lineage depth: 0 for friend/wild, F1 = 1, F2 = 2, ... */
  lineage: number;
  sheet: SpriteSheet;
  /** Babies only. */
  tier?: TierId;
  parents?: readonly [string, string];
  dna?: Dna;
  /** Babies only: the SDK play that hatched it. */
  playId?: bigint;
  /** Equipped cosmetic, drawn by drawCreature on every frame. */
  accessory?: AccessoryId;
  /** Babies of your Friend and the day's dream mate: how close they came to the dream child (src/dream.ts). */
  dream?: DreamMatch;
}>;

/** A hatch measured against the dream: per row, whether it matches the dream child's row (16 entries), and the count. */
export type DreamMatch = Readonly<{ id: string; rows: readonly boolean[]; matched: number }>;

/**
 * Input to genetics.breed. seed must be derived deterministically from friendId, parents and playId. `takenNames`: baby
 * names already used this session; the name is re-rolled (deterministically) until it is not one of them. `locks`: the
 * Gene Lab's 16 row locks (omitted or all null: the baby is exactly the one bred without them).
 */
export type BreedInput = Readonly<{ a: Creature; b: Creature; seed: number; tier: TierId; playId: bigint; takenNames?: ReadonlySet<string>; locks?: readonly RowLock[] }>;
export type BreedResult = Readonly<{ sheet: SpriteSheet; dna: Dna; name: string; family: string; familyId: number; lineage: number }>;

/** Tier visuals shared by renderer and UI. */
export const TIER_STYLE: Readonly<Record<TierId, Readonly<{ label: string; accent: string; glow: string | null }>>> = {
  common: { label: "Common", accent: "#111111", glow: null },
  spotted: { label: "Spotted", accent: "#9BCB00", glow: "#CCFF00" },
  mutant: { label: "Mutant", accent: "#8A4DFF", glow: "#B48CFF" },
  prismatic: { label: "Prismatic", accent: "#FFB800", glow: "#FFE27A" },
};

/** DNA source colours (parent A = your Friend paper white, parent B = the mate signal green), shared by the intro,
 * the hatch sequence and the DNA cards. On paper backgrounds draw parent A rows with an ink edge. */
export const PARENT_TINT = ["#F4F1EA", "#CCFF00"] as const;

/** World stations the player can walk to (scene) or open from the HUD (ui). */
export type StationId = "matchmaker" | "incubator" | "sanctuary" | "slingshot";
