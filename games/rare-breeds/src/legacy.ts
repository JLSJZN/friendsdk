// Rare Breeds legacy: how far the player's Friend travels through its brood.
// A baby's row y is always row y of one parent (Dna.rowSource says which), so following rowSource down the
// family tree ends at the Friend or wild Friend whose on-chain pixel row it really is.
// Pure, deterministic and cycle-safe (no SDK runtime import), for the legacy card, the family tree, the DNA trio's
// row paths ("Row 5: Friend #4411 via Pip") and tests.
import { familySides } from "./genetics.ts";
import { FAMILY_NAMES } from "./sprites.ts";
import { FRAME_SIZE, type Creature } from "./types.ts";

/** Resolves a creature key ("friend:1", "wild:2", "baby:3") to the creature, e.g. the controller's `creature(key)`. */
export type CreatureLookup = (key: string) => Creature | null | undefined;

export type LegacyNode = Readonly<{
  creature: Creature;
  /**
   * "friend": the root. "kept": a baby in the brood. "ancestor": a baby no longer kept (traded in at the
   * Sanctuary) that still links kept babies to the Friend.
   */
  role: "friend" | "kept" | "ancestor";
  /** The other parent (the one this node does not hang under); null for the root or when it cannot be resolved. */
  mate: Creature | null;
  /** How many of this creature's 16 rows are the Friend's own rows (16 for the root). */
  friendRows: number;
  /** Babies hanging under this node, in hatch order (playId). */
  children: readonly LegacyNode[];
}>;

export type Legacy = Readonly<{
  /** Kept babies whose line reaches the Friend (any generation). */
  descendants: number;
  /** Highest generation among them (F3 -> 3); 0 without descendants. */
  deepestLineage: number;
  /** Distinct families mixed into the line: the Friend's first, then in the order they joined (hatch order, parent A first). */
  families: readonly string[];
  /**
   * The family tree rooted at the Friend. Every kept baby appears once, under its first parent (parent A,
   * else B) that is in the Friend's line, so node counts match `descendants`; the other parent is `mate`.
   * A baby of two kept babies therefore hangs under parent A and names parent B as its mate.
   */
  tree: LegacyNode;
  /** 0-1: share of all kept babies' pixel rows that trace back to the Friend's own rows. */
  legacyShare: number;
  /** The numbers behind legacyShare: rows tracing to the Friend, and 16 rows per kept baby. */
  friendRows: number;
  totalRows: number;
}>;

/** Deeper chains than this are treated as broken data (real lines are a handful of generations). */
const MAX_DEPTH = 256;

const familyOf = (creature: Creature) => FAMILY_NAMES[creature.familyId] ?? creature.family;
const traceable = (creature: Creature) => !!creature.dna && !!creature.parents;

type Trace = Readonly<{ keys: readonly string[]; families: readonly string[] }>;

/** Memoised row tracing over one lookup: per creature, the origin key and origin family of each row. */
function rowTracer(lookup: CreatureLookup) {
  const memo = new Map<string, Trace>();
  const path = new Set<string>();
  function trace(creature: Creature): Trace {
    const known = memo.get(creature.key);
    if (known) return known;
    const { dna, parents } = creature;
    // A Friend (or a baby that cannot be traced, or a cycle) owns its rows.
    if (!dna || !parents || path.has(creature.key) || path.size >= MAX_DEPTH) {
      const own = { keys: Array<string>(FRAME_SIZE).fill(creature.key), families: Array<string>(FRAME_SIZE).fill(familyOf(creature)) };
      if (!path.has(creature.key)) memo.set(creature.key, own);
      return own;
    }
    path.add(creature.key);
    const sides = parents.map(key => { const parent = lookup(key); return parent ? trace(parent) : null; });
    path.delete(creature.key);
    // An unknown parent is still the origin as far as we can see; its family is the label's name for that side.
    const labelSides = familySides(creature.family);
    const keys: string[] = [], families: string[] = [];
    for (let y = 0; y < FRAME_SIZE; y++) {
      const side = dna.rowSource[y] === 1 ? 1 : 0, from = sides[side];
      keys.push(from ? from.keys[y] : parents[side]);
      families.push(from ? from.families[y] : labelSides?.[side] ?? familyOf(creature));
    }
    const result = { keys, families };
    memo.set(creature.key, result);
    return result;
  }
  return trace;
}

/** For each of the 16 rows, the key of the ancestor (Friend or wild Friend) whose row it ultimately is. */
export function rowOrigins(baby: Creature, lookup: CreatureLookup): readonly string[] {
  return rowTracer(lookup)(baby).keys;
}

/** For each of the 16 rows, the family of the ancestor whose row it ultimately is. */
export function rowFamilies(creature: Creature, lookup: CreatureLookup): readonly string[] {
  return rowTracer(lookup)(creature).families;
}

/** Where a row really comes from: the Friend or wild Friend (or the last known ancestor) whose pixel row it is. */
export type RowOrigin = Readonly<{
  /** Its key ("friend:77949", "wild:4411"); for an ancestor the lookup does not know, the key its child names. */
  key: string;
  /** Null when the lookup does not know it (its rows still count as its own). */
  creature: Creature | null;
  /** Its family; for an unknown ancestor, the child's label name for that side. */
  family: string;
  /** The on-chain token ID of a Friend or wild Friend. */
  tokenId?: bigint;
}>;

/** One step down a row's path: a baby, the parent side the row came from (0 = parent A, 1 = parent B) and its generation (F2 -> 2). */
export type RowStep = Readonly<{ creature: Creature; side: 0 | 1; generation: number }>;

export type RowPath = Readonly<{
  /** The row, 0-15. */
  row: number;
  /** One step per baby the row passed through, the traced baby first; empty for a Friend or wild Friend. */
  steps: readonly RowStep[];
  origin: RowOrigin;
}>;

/** A real ancestor and the baby's rows that are its own (0-15, top first). */
export type RowSource = RowOrigin & Readonly<{ rows: readonly number[] }>;

function rowOrigin(key: string, family: string, from: Creature, lookup: CreatureLookup): RowOrigin {
  const creature = key === from.key ? from : lookup(key) ?? null;
  return Object.freeze({ key, creature, family, tokenId: creature?.tokenId });
}

/**
 * The path of row y from `baby` down to the real Friend it came from: every baby on the way with the parent side
 * it took the row from, ending at your Friend or a wild Friend (token ID and family). One row mask covers all 64
 * frames, so row y is row y of every frame; a Side-walker (a Colossus in its line) shows its right-facing frames
 * from every side, so its row y is row y of its ancestors' right-facing (and left-facing) frames. The origin is
 * the one rowOrigins finds (same tracer), so missing ancestors, cycles and very deep chains end the path safely.
 * Null for a row outside 0-15.
 */
export function rowPath(baby: Creature, y: number, lookup: CreatureLookup): RowPath | null {
  if (!Number.isInteger(y) || y < 0 || y >= FRAME_SIZE) return null;
  const { keys, families } = rowTracer(lookup)(baby);
  const steps: RowStep[] = [];
  // Follow rowSource down until the tracer's origin (it stops at an unknown parent, a cycle or MAX_DEPTH too).
  for (let at: Creature | null | undefined = baby; at?.dna && at.parents && at.key !== keys[y] && steps.length < MAX_DEPTH;) {
    const side = at.dna.rowSource[y] === 1 ? 1 : 0;
    steps.push(Object.freeze({ creature: at, side, generation: at.lineage }));
    at = lookup(at.parents[side]);
  }
  return Object.freeze({ row: y, steps: Object.freeze(steps), origin: rowOrigin(keys[y], families[y], baby, lookup) });
}

/**
 * The distinct real ancestors of a baby's 16 rows, most rows first (then by their first row): #77949 x10,
 * #4411 x4, #812 x2. A Friend or wild Friend is its own single source.
 */
export function rowSources(baby: Creature, lookup: CreatureLookup): readonly RowSource[] {
  const { keys, families } = rowTracer(lookup)(baby);
  const rows = new Map<string, number[]>();
  keys.forEach((key, y) => { const list = rows.get(key); if (list) list.push(y); else rows.set(key, [y]); });
  return Object.freeze([...rows].map(([key, list]) => Object.freeze({ ...rowOrigin(key, families[list[0]], baby, lookup), rows: Object.freeze(list) }))
    .sort((p, q) => q.rows.length - p.rows.length || p.rows[0] - q.rows[0]));
}

/** The creatures and all their known ancestors, each once (iterative, so any depth or cycle is safe). */
function ancestryOf(starts: Iterable<Creature>, lookup: CreatureLookup): Creature[] {
  const found = new Map<string, Creature>(), stack = [...starts];
  while (stack.length) {
    const creature = stack.pop()!;
    if (found.has(creature.key)) continue;
    found.set(creature.key, creature);
    for (const key of creature.parents ?? []) { const parent = lookup(key); if (parent && !found.has(parent.key)) stack.push(parent); }
  }
  return [...found.values()];
}

/**
 * Families of the founders (Friends and wild Friends) among `creatures`, each once, in the order they were
 * mixed in: babies in hatch order, parent A before parent B. An unknown parent counts as the label's name
 * for that side.
 */
function foundingFamilies(creatures: readonly Creature[], lookup: CreatureLookup, first?: string): string[] {
  const out: string[] = first ? [first] : [];
  const add = (name: string) => { if (!out.includes(name)) out.push(name); };
  const babies = creatures.filter(traceable).sort(hatchOrder);
  if (!babies.length) creatures.forEach(creature => add(familyOf(creature)));
  for (const baby of babies) {
    const sides = familySides(baby.family);
    baby.parents!.forEach((key, side) => {
      const parent = lookup(key);
      if (!parent) add(sides?.[side] ?? familyOf(baby));
      else if (!traceable(parent)) add(familyOf(parent));
    });
  }
  return out;
}

/**
 * Every family in a creature's lineage, each once, in the order it was mixed in (hatch order, parent A
 * first): ["Cellular", "Mask", "Sparkling"] for the F2 of a Cellular Friend's Mask and Sparkling babies.
 * A Friend or wild Friend gives its own family.
 */
export function familyLine(creature: Creature, lookup: CreatureLookup): readonly string[] {
  return foundingFamilies(ancestryOf([creature], lookup), lookup);
}

/** Hatch order: by playId, creatures without one last, then by key. */
function hatchOrder(p: Creature, q: Creature): number {
  if (p.playId !== q.playId) {
    if (p.playId === undefined) return 1;
    if (q.playId === undefined) return -1;
    return p.playId < q.playId ? -1 : 1;
  }
  return p.key < q.key ? -1 : p.key > q.key ? 1 : 0;
}

/**
 * The Friend's legacy over its brood: descendants, deepest generation, families mixed in, the family tree
 * and the share of the brood's pixel rows that are the Friend's own. Brood entries win over `lookup` (they
 * carry current accessories); ancestors no longer kept come from `lookup`. A kept baby whose line cannot be
 * traced to the Friend (missing lookup data) stays out of the tree and `descendants`, but its rows still
 * count in `totalRows`.
 */
export function buildLegacy(friend: Creature, brood: readonly Creature[], lookup: CreatureLookup): Legacy {
  const kept = new Map<string, Creature>();
  for (const baby of brood) if (baby.key !== friend.key && !kept.has(baby.key)) kept.set(baby.key, baby);
  const find = (key: string): Creature | null => key === friend.key ? friend : kept.get(key) ?? lookup(key) ?? null;
  const trace = rowTracer(find);

  // joinsVia: key -> the parent through which the creature reaches the Friend (null: not in the line).
  // Parents on the current path are skipped, so the recorded links always lead to the Friend without loops.
  const joinsVia = new Map<string, string | null>(), path = new Set<string>();
  const joins = (creature: Creature): boolean => {
    if (creature.key === friend.key) return true;
    const known = joinsVia.get(creature.key);
    if (known !== undefined) return known !== null;
    if (!creature.parents || path.has(creature.key) || path.size >= MAX_DEPTH) return false;
    path.add(creature.key);
    let via: string | null = null;
    for (const key of creature.parents) {
      const parent = find(key);
      if (parent && joins(parent)) { via = key; break; }
    }
    path.delete(creature.key);
    joinsVia.set(creature.key, via);
    return via !== null;
  };

  const line = [...kept.values()].filter(joins);
  const children = new Map<string, Creature[]>(), placed = new Set<string>([friend.key]);
  for (const baby of line) {
    for (let node: Creature | null = baby; node && !placed.has(node.key);) {
      placed.add(node.key);
      const up = joinsVia.get(node.key)!;
      const list = children.get(up) ?? [];
      list.push(node);
      children.set(up, list);
      node = find(up);
    }
  }
  const friendRowsOf = (creature: Creature) => trace(creature).keys.filter(key => key === friend.key).length;
  const nodeOf = (creature: Creature, role: LegacyNode["role"], mate: Creature | null): LegacyNode => Object.freeze({
    creature, role, mate,
    friendRows: role === "friend" ? FRAME_SIZE : friendRowsOf(creature),
    children: Object.freeze((children.get(creature.key) ?? []).sort(hatchOrder).map(child => {
      const up = joinsVia.get(child.key)!, parents = child.parents!;
      const other = parents[0] === up ? parents[1] : parents[0];
      return nodeOf(child, kept.has(child.key) ? "kept" : "ancestor", find(other));
    })),
  });
  const tree = nodeOf(friend, "friend", null);

  const families = foundingFamilies(ancestryOf(line, find), find, familyOf(friend));
  let friendRows = 0;
  for (const baby of kept.values()) friendRows += friendRowsOf(baby);
  const totalRows = kept.size * FRAME_SIZE;
  return Object.freeze({
    descendants: line.length,
    deepestLineage: line.reduce((deepest, baby) => Math.max(deepest, baby.lineage), 0),
    families: Object.freeze(families),
    tree,
    legacyShare: totalRows ? friendRows / totalRows : 0,
    friendRows, totalRows,
  });
}
