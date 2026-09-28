// Game state and SDK action flows. Owned by the project lead.
// The SDK client decides every paid outcome (tier). Genetics only turns that tier plus the chosen
// parents into pixels, so presentation never selects or changes an outcome.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameClient, GameSnapshot } from "@rarefriends/friendsdk/game";
import { createFriendReader } from "@rarefriends/friendsdk/sprites";
import wildData from "../data/wild-friends.json";
import { breed, breedSeed, NO_LOCKS } from "./genetics.ts";
import { breedAvailability } from "./economy.ts";
import { pickMates, wishMates } from "./dream.ts";
import { creatureFromGenerationSprites, creatureFromRecord, type WildFriendRecord } from "./sprites.ts";
import { TIER_ORDER, type Creature, type RowLock, type TierId } from "./types.ts";

/** The 73 real wild Friends the Matchmaker offers (and the dream mates come from). */
export const WILD_POOL: readonly Creature[] = (wildData.friends as WildFriendRecord[]).map(record => creatureFromRecord(record));

export type HatchState = Readonly<{
  baby: Creature; parentA: Creature; parentB: Creature; outcomeId: number;
  stage: "hatching" | "result";
}>;

export type BreedStep = "buying" | "laying" | "hatching";

/**
 * A laid egg's pair and Gene Lab locks, and the Hearts paid for them: a pending play hatches exactly what was chosen for it.
 * `stamp` decorates the baby before it is stored (the dream match, measured against the dream of the moment the egg was laid).
 */
export type Commitment = Readonly<{ a: Creature; b: Creature; locks: readonly RowLock[]; hearts: number; stamp?: (baby: Creature) => Creature }>;

const CANCELLED: Record<string, string> = {
  buying: "Cancelled. Nothing was spent.",
  laying: "Cancelled. Your egg is safe in the incubator.",
  hatching: "The egg is still waiting. Try hatching it again.",
  releasing: "Cancelled. Your baby stays with you.",
};

function errorMessage(cause: unknown, step: string, fallback: string) {
  const text = cause instanceof Error ? cause.message : "";
  if (/reject|denied|cancel/i.test(text)) return CANCELLED[step] ?? "Cancelled.";
  return /insufficient/i.test(text) ? "Not enough simulated RF for an egg." : text || fallback;
}

/** Deterministic stand-in mate for plays whose original mate choice was lost (child reload). */
function restoredMate(playId: bigint, exclude: bigint | undefined) {
  const pool = WILD_POOL.filter(creature => creature.tokenId !== exclude);
  return pool[Number(playId % BigInt(pool.length))];
}

/**
 * `takenNames`: baby names already used this session, so "Horns from Lulu" never has two Lulus. `locks`: the Gene Lab's row
 * locks (the baby records them in Dna.locks, so the same inputs always give the same baby).
 */
export function makeBaby(friendId: bigint, a: Creature, b: Creature, playId: bigint, tier: TierId, takenNames?: ReadonlySet<string>, locks?: readonly RowLock[]): Creature {
  const result = breed({ a, b, tier, playId, seed: breedSeed(friendId, a.key, b.key, playId), takenNames, locks });
  return Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId,
  });
}

/** `dreamMate`: reads today's dream mate (src/dream.ts), which fresh sets of wild mates and a Wish for its family bring along. */
export function useRareBreeds({ friendId, client, paused, dreamMate }: { friendId: bigint; client: GameClient; paused: boolean; dreamMate?: () => Creature | null | undefined }) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [player, setPlayer] = useState<Creature | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<BreedStep | "releasing" | null>(null);
  const [babies, setBabies] = useState<ReadonlyMap<string, Creature>>(new Map());
  const [candidates, setCandidates] = useState<readonly Creature[]>([]);
  const [hatch, setHatch] = useState<HatchState | null>(null);
  const epoch = useRef(0), locked = useRef(false), stepRef = useRef<string>("");
  const setStep = (step: NonNullable<typeof busy>) => { stepRef.current = step; setBusy(step); };
  const lineage = useRef(new Map<string, Creature>());
  // Laid eggs by play id, until they hatch (a play whose settle failed keeps its pair and locks for "Finish hatching").
  const commits = useRef(new Map<bigint, Commitment>());
  const definition = client.definition;
  const dreamRef = useRef(dreamMate);
  dreamRef.current = dreamMate;
  const pickCandidates = (exclude: bigint | undefined) => pickMates(WILD_POOL, exclude, Math.random, dreamRef.current?.());

  const remember = (creature: Creature) => { lineage.current.set(creature.key, creature); return creature; };
  /** Names of every baby this session (kept, traded in or launched), except the one about to be made. */
  const takenNames = (key: string) => new Set([...lineage.current.values()].filter(item => item.kind === "baby" && item.key !== key).map(item => item.name));

  const load = useCallback(() => {
    const version = ++epoch.current;
    setLoadError("");
    void Promise.all([client.read(), createFriendReader().read(friendId)]).then(([value, sprites]) => {
      if (version !== epoch.current) return;
      const friend = remember(creatureFromGenerationSprites(sprites));
      setPlayer(friend);
      setSnapshot(value);
      setCandidates(pickCandidates(friendId));
    }).catch(cause => {
      if (version === epoch.current) setLoadError(cause instanceof Error ? cause.message : "Could not load your Friend.");
    });
  }, [client, friendId]);

  useEffect(() => {
    setSnapshot(null); setPlayer(null); setBabies(new Map()); setHatch(null); setError(""); setBusy(null);
    locked.current = false; lineage.current = new Map(); commits.current = new Map();
    load();
    return () => { epoch.current++; };
  }, [load]);

  // Kept babies must match the ledger's kept rewards. Rebuild any the child session lost
  // (for example after a child reload inside the same runtime session).
  useEffect(() => {
    if (!snapshot || !player || hatch) return;
    const settled = snapshot.plays.filter(play => play.outcomeId !== null);
    setBabies(current => {
      const next = new Map<string, Creature>();
      TIER_ORDER.forEach((tier, index) => {
        const keep = Number(snapshot.inventory[index] ?? 0n);
        const plays = settled.filter(play => play.outcomeId === index + 1).reverse();
        const known = plays.filter(play => current.has(`baby:${play.id}`));
        const chosen = [...known, ...plays.filter(play => !known.includes(play))].slice(0, keep);
        for (const play of chosen) {
          const key = `baby:${play.id}`;
          next.set(key, current.get(key)
            ?? remember(makeBaby(friendId, player, remember(restoredMate(play.id, friendId)), play.id, tier, takenNames(key))));
        }
      });
      const same = next.size === current.size && [...next.keys()].every(key => current.has(key));
      return same ? current : next;
    });
  }, [snapshot, player, hatch, friendId]);

  async function run<T>(step: NonNullable<typeof busy>, work: () => Promise<T>, fallback: string): Promise<T | undefined> {
    if (locked.current || paused) return undefined;
    const version = epoch.current;
    locked.current = true; setBusy(step); setError("");
    stepRef.current = step;
    try {
      const result = await work();
      return version === epoch.current ? result : undefined;
    } catch (cause) {
      if (version === epoch.current) setError(errorMessage(cause, stepRef.current, fallback));
      return undefined;
    } finally {
      if (version === epoch.current) {
        locked.current = false; setBusy(null);
        void client.read().then(value => { if (version === epoch.current) setSnapshot(value); }).catch(() => {});
      }
    }
  }

  const { eggs, needsEgg, blocker, canAfford, pendingPlay } = breedAvailability(snapshot, definition);
  const blockerText = blocker === "balance" ? "Not enough simulated RF for an egg. Send a baby to the Sanctuary to earn some back."
    : blocker === "backing" ? "The hatchery is out of prize backing right now." : "";
  const pendingCommit = pendingPlay ? commits.current.get(pendingPlay.id) ?? null : null;

  /**
   * Buy an egg if needed, lay it, and settle it. Resolves with the hatch state (stage "hatching"). `lab.locks`: Gene Lab row
   * locks; `lab.onCommit` runs once the breed really starts (the egg is used, or a pending play without a record starts to
   * settle), so a cancelled confirmation costs nothing. It pays for the locks and returns what the egg keeps: the locks and
   * the Hearts paid (no locks when the payment fails). A pending play hatches the pair and locks it was laid with.
   */
  const breedPair = useCallback(async (parentA: Creature, parentB: Creature, onLaid?: () => Promise<void>,
    lab?: Readonly<{ locks: readonly RowLock[]; onCommit?: () => Readonly<{ locks: readonly RowLock[]; hearts: number }>; stamp?: (baby: Creature) => Creature }>) => {
    return run("buying", async () => {
      const version = epoch.current;
      let play = pendingPlay, commit = play ? commits.current.get(play.id) : undefined;
      if (!play) {
        if ((await client.read()).consumables === 0n) { setStep("buying"); await client.buy(1n); }
        setStep("laying");
        play = (await client.play(1n))[0];
      }
      if (!commit) {
        commit = { a: parentA, b: parentB, ...(lab?.onCommit?.() ?? { locks: lab?.locks ?? NO_LOCKS, hearts: 0 }), stamp: lab?.stamp };
        commits.current.set(play.id, commit);
      }
      const { a, b, locks, stamp } = commit;
      setStep("hatching");
      const [settled] = await Promise.all([client.settle(play.id), onLaid?.()]);
      if (settled.outcomeId === null) throw new Error("The egg has not hatched yet. Try again in a moment.");
      const tier = TIER_ORDER[settled.outcomeId - 1];
      remember(a); remember(b);
      const made = makeBaby(friendId, a, b, settled.id, tier, takenNames(`baby:${settled.id}`), locks);
      const baby = remember(stamp ? stamp(made) : made);
      commits.current.delete(settled.id);
      const state: HatchState = { baby, parentA: a, parentB: b, outcomeId: settled.outcomeId, stage: "hatching" };
      if (version === epoch.current) {
        setBabies(current => new Map(current).set(baby.key, baby));
        setHatch(state);
        // Fresh faces after every hatch, so the lazy path does not breed the same pair forever.
        setCandidates(pickCandidates(friendId));
      }
      return state;
    }, "The egg could not be hatched.");
  }, [client, friendId, pendingPlay, paused]);

  const finishHatch = useCallback(() => setHatch(current => current && { ...current, stage: "result" }), []);
  const closeHatch = useCallback(() => setHatch(null), []);

  /** Send a kept baby to the Sanctuary: redeem one reward of its tier for the fixed RF value. */
  const release = useCallback(async (baby: Creature) => {
    const outcomeId = TIER_ORDER.indexOf(baby.tier ?? "common") + 1;
    // Drop the baby before the post-action ledger read, so reconciliation keeps the right siblings.
    const done = await run("releasing", async () => {
      await client.redeem(outcomeId, 1n);
      setBabies(current => { const next = new Map(current); next.delete(baby.key); return next; });
      return true;
    }, "The Sanctuary could not take this baby.");
    return Boolean(done);
  }, [client, paused]);

  /** Stock up the incubator: one confirmation for several eggs. */
  const buyEggs = useCallback(async (quantity: bigint) =>
    Boolean(await run("buying", async () => { await client.buy(quantity); return true; }, "The eggs could not be bought.")),
  [client, paused]);

  const reroll = useCallback(() => setCandidates(pickCandidates(friendId)), [friendId]);
  /** Wish match: three candidates from one family (the Hearts price is charged by the caller). */
  const wish = useCallback((familyId: number) => {
    const picked = wishMates(WILD_POOL, familyId, friendId, Math.random, dreamRef.current?.());
    if (picked.length) setCandidates(picked);
  }, [friendId]);
  const brood = useMemo(() => [...babies.values()].sort((x, y) => Number((x.playId ?? 0n) - (y.playId ?? 0n))), [babies]);
  const creature = useCallback((key: string) => lineage.current.get(key) ?? null, []);

  return {
    definition, snapshot, player, loadError, retryLoad: load, error, clearError: () => setError(""), busy,
    eggs, needsEgg, canAfford, blockerText, buyEggs, pendingPlay, pendingCommit, brood, candidates, reroll, wish, hatch, breedPair, finishHatch, closeHatch,
    release, creature,
  };
}
