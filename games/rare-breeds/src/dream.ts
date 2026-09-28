// Rare Breeds dream child: every day your Friend dreams of a child. Find the mate and the rows to make it real.
// From (local date, your Friend, round) the day's dream is derived: a secret mate from the wild pool (never your Friend)
// and a secret row mask that really hatches for that pair (possibleMasks in genetics.ts). The dream child is that pair's
// body with that mask, no tier pattern or mutation, so locking all 16 rows to the mask hatches it exactly, in any tier.
// Cosmetic plus Hearts (game points, never RF): every attempt is an ordinary egg and the tier and its odds never change.
// Pure and deterministic (the hook only keeps session state), for the game, node tests and dev tools.
import { useCallback, useMemo, useState } from "react";
import { breed, possibleMasks } from "./genetics.ts";
import { FACINGS, FRAME_SIZE, type Clip, type Creature, type DreamMatch } from "./types.ts";

/** Hearts for making the dream come true (16 of 16 rows), once per dream. */
export const DREAM_HEARTS = 50;
/**
 * Clue strength: a fresh set of wild mates (New faces, or the new faces after a hatch) brings the dream mate along this
 * often, on top of its plain 3 in 72 chance; a Wish for its family always brings it. Measured in tests/dream.test.ts.
 */
export const DREAM_OFFER = 0.25;
/** The dream picks among the best-scoring quarter of the pair's possible masks, so it is a good-looking child. */
const DREAM_BEST = 0.25;
/** A dream mate must differ from your Friend in at least this many rows (otherwise the puzzle has nothing to find). */
const MIN_CLUE_ROWS = 8;
const CANDIDATES = 3;
const CLIPS_AND_FACINGS = (["idle", "walk"] as const).flatMap(clip => FACINGS.map(facing => [clip as Clip, facing] as const));

/** The day's dream. `mask`: per row, 0 = from your Friend (Parent A), 1 = from the mate (Parent B). */
export type Dream = Readonly<{
  /** "2026-09-28#0": the date and the round (Dream again draws the next round). */
  id: string; date: string; round: number;
  friendKey: string; mate: Creature; mask: readonly (0 | 1)[];
  /** Rows both parents draw identically in every frame: they look the same whichever parent gives them, so they always match. */
  same: readonly boolean[];
  /** The dream child: the pair's body with the mask (Common, no pattern, no mutation). */
  child: Creature;
}>;

/** The session's progress on the current dream: eggs hatched with the dream pair, the best match, the baby that made it real. */
export type DreamProgress = Readonly<{ id: string; eggs: number; best: number; solved: string | null }>;

/** 32-bit FNV-1a. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

/** mulberry32: a seeded random() in [0, 1). */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The player's local calendar date, "YYYY-MM-DD" (a new dream every day). */
export function localDateKey(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Per row: both parents draw it identically in every frame of every clip and facing. */
export function sameRows(a: Creature, b: Creature): boolean[] {
  return Array.from({ length: FRAME_SIZE }, (_, y) => CLIPS_AND_FACINGS.every(([clip, facing]) => a.sheet[clip][facing].every((frame, i) => {
    const other = b.sheet[clip][facing][i];
    for (let x = 0; x < FRAME_SIZE; x++) if (frame[y * FRAME_SIZE + x] !== other[y * FRAME_SIZE + x]) return false;
    return true;
  })));
}

/**
 * The dream for a date, your Friend and a round (0 first, Dream again adds one). The mate is the first of the pool, in seeded
 * order, that differs from your Friend in enough rows and can hatch at least one baby with it; the mask is one of that pair's
 * best possible masks. Null only when no pool Friend can breed with yours.
 */
export function dreamOf({ date, friend, pool, round = 0 }: Readonly<{ date: string; friend: Creature; pool: readonly Creature[]; round?: number }>): Dream | null {
  const seed = hash(`rare-breeds-dream|${date}|${friend.tokenId ?? friend.key}|${round}`), random = seededRandom(seed);
  const mates = pool.filter(mate => mate.key !== friend.key && (friend.tokenId === undefined || mate.tokenId !== friend.tokenId));
  for (let i = mates.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [mates[i], mates[j]] = [mates[j], mates[i]]; }
  type Found = { mate: Creature; masks: readonly (readonly (0 | 1)[])[]; same: boolean[] };
  let found: Found | null = null, fallback: Found | null = null;
  for (const mate of mates) {
    const masks = possibleMasks(friend, mate);
    if (!masks.length) continue;
    const same = sameRows(friend, mate);
    if (same.filter(row => !row).length >= MIN_CLUE_ROWS) { found = { mate, masks, same }; break; }
    fallback ??= { mate, masks, same };
  }
  found ??= fallback;
  if (!found) return null;
  const best = found.masks.slice(0, Math.max(1, Math.round(found.masks.length * DREAM_BEST)));
  const mask = Object.freeze(best[Math.floor(random() * best.length)].slice());
  const id = `${date}#${round}`;
  const result = breed({ a: friend, b: found.mate, tier: "common", seed, playId: 0n, locks: mask });
  const child: Creature = Object.freeze({
    key: `dream:${id}`, kind: "baby", name: "Dream child", family: result.family, familyId: result.familyId, lineage: result.lineage,
    sheet: result.sheet, tier: "common", parents: [friend.key, found.mate.key] as const, dna: result.dna,
  });
  return Object.freeze({ id, date, round, friendKey: friend.key, mate: found.mate, mask, same: Object.freeze(found.same), child });
}

/**
 * How close a baby came to the dream: a row matches when it came from the same parent as in the dream, or when both parents
 * draw it the same (it looks the same either way). Only a baby of your Friend (Parent A) and the dream mate (Parent B) counts.
 */
export function dreamMatch(dream: Dream, baby: Creature): DreamMatch | null {
  const source = baby.dna?.rowSource;
  if (!source || baby.parents?.[0] !== dream.friendKey || baby.parents[1] !== dream.mate.key) return null;
  const rows = Object.freeze(dream.mask.map((side, y) => dream.same[y] || source[y] === side));
  return Object.freeze({ id: dream.id, rows, matched: rows.filter(Boolean).length });
}

export const startProgress = (id: string): DreamProgress => ({ id, eggs: 0, best: 0, solved: null });

/** The baby with its dream match recorded (unchanged when it is not a baby of the dream pair). */
export function stampDream(dream: Dream, baby: Creature): Creature {
  const match = dreamMatch(dream, baby);
  return match ? Object.freeze({ ...baby, dream: match }) : baby;
}

/** Books a hatch on the current dream: one more egg, the best match, and the reward the first time all 16 rows match. */
export function recordHatch(progress: DreamProgress, baby: Creature): Readonly<{ progress: DreamProgress; reward: number }> {
  const match = baby.dream;
  if (!match || match.id !== progress.id) return { progress, reward: 0 };
  const solved = progress.solved ?? (match.matched === FRAME_SIZE ? baby.key : null);
  const reward = !progress.solved && solved ? DREAM_HEARTS : 0;
  return { progress: { ...progress, eggs: progress.eggs + 1, best: Math.max(progress.best, match.matched), solved }, reward };
}

/** The reveal card's news line for a baby measured against the dream (before or after recordHatch booked it). */
export function dreamNews(baby: Creature, progress: DreamProgress | null): string[] {
  const match = baby.dream;
  if (!match) return [];
  if (match.matched < FRAME_SIZE) return [`Dream match: ${match.matched} of ${FRAME_SIZE} rows`];
  return [progress?.solved && progress.solved !== baby.key ? "Dream come true again (Hearts once per dream)" : `Dream come true! +${DREAM_HEARTS} Hearts`];
}

/**
 * The Matchmaker's wild mates: `count` from the pool without your Friend, different families first. With a dream mate it comes
 * along on DREAM_OFFER of the sets (in a random slot) unless it is already there. `random` is injectable for the measurement.
 */
export function pickMates(pool: readonly Creature[], exclude: bigint | undefined, random: () => number = Math.random, dreamMate?: Creature | null, count = CANDIDATES) {
  const open = pool.filter(creature => creature.tokenId !== exclude);
  const picked: Creature[] = [], families = new Set<number>();
  // Prefer different families so every reroll feels fresh.
  for (let guard = 0; picked.length < count && guard < 200; guard++) {
    const candidate = open[Math.floor(random() * open.length)];
    if (picked.includes(candidate) || (families.has(candidate.familyId) && guard < 100)) continue;
    picked.push(candidate); families.add(candidate.familyId);
  }
  if (dreamMate && picked.length && !picked.some(item => item.key === dreamMate.key) && random() < DREAM_OFFER) {
    picked[Math.floor(random() * picked.length)] = dreamMate;
  }
  return picked;
}

/** Wish match: three mates from one family. A Wish for the dream mate's family always brings it along. */
export function wishMates(pool: readonly Creature[], familyId: number, exclude: bigint | undefined, random: () => number = Math.random, dreamMate?: Creature | null) {
  const family = pool.filter(creature => creature.familyId === familyId && creature.tokenId !== exclude);
  const picked = [...family].sort(() => random() - 0.5).slice(0, CANDIDATES);
  if (dreamMate && dreamMate.familyId === familyId && picked.length && !picked.some(item => item.key === dreamMate.key)) {
    picked[Math.floor(random() * picked.length)] = dreamMate;
  }
  return picked;
}

/**
 * The dream in a session: today's dream for your Friend (null until the Friend is known), its progress, and Dream again.
 * `awake` turns on after the first hatch, so the intro stays as it is. Session state only (the sandbox has no storage).
 */
export function useDream({ friend, pool, date }: Readonly<{ friend: Creature | null; pool: readonly Creature[]; date: string }>) {
  const [round, setRound] = useState(0);
  const dream = useMemo(() => friend ? dreamOf({ date, friend, pool, round }) : null, [friend?.key, pool, date, round]);
  const [progress, setProgress] = useState<DreamProgress | null>(null);
  const current = dream && progress?.id === dream.id ? progress : dream ? startProgress(dream.id) : null;
  const [awake, setAwake] = useState(false);

  /** Books a hatch; returns the Hearts to grant (DREAM_HEARTS the first time the dream comes true, else 0). */
  const record = useCallback((baby: Creature) => {
    if (!current) return 0;
    const next = recordHatch(current, baby);
    if (next.progress !== current) setProgress(next.progress);
    return next.reward;
  }, [current]);
  /** After it came true: dream the next dream. */
  const again = useCallback(() => { if (current?.solved) setRound(value => value + 1); }, [current?.solved]);

  return { dream, progress: current, awake, wake: useCallback(() => setAwake(true), []), record, again };
}
