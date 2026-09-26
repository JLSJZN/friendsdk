// Game state and SDK action flows. Owned by the project lead.
// The SDK client decides every paid outcome (tier). Genetics only turns that tier plus the chosen
// parents into pixels, so presentation never selects or changes an outcome.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameClient, GameSnapshot } from "@rarefriends/friendsdk/game";
import { createFriendReader } from "@rarefriends/friendsdk/sprites";
import wildData from "../data/wild-friends.json";
import { breed, breedSeed } from "./genetics.ts";
import { purchaseBlocker } from "./economy.ts";
import { creatureFromGenerationSprites, creatureFromRecord, type WildFriendRecord } from "./sprites.ts";
import { TIER_ORDER, type Creature, type TierId } from "./types.ts";

const WILD_POOL: readonly Creature[] = (wildData.friends as WildFriendRecord[]).map(record => creatureFromRecord(record));
const CANDIDATES = 3;

export type HatchState = Readonly<{
  baby: Creature; parentA: Creature; parentB: Creature; outcomeId: number;
  stage: "hatching" | "result";
}>;

export type BreedStep = "buying" | "laying" | "hatching";

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

function pickCandidates(exclude: bigint | undefined, count = CANDIDATES) {
  const pool = WILD_POOL.filter(creature => creature.tokenId !== exclude);
  const picked: Creature[] = [], families = new Set<number>();
  // Prefer different families so every reroll feels fresh.
  for (let guard = 0; picked.length < count && guard < 200; guard++) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (picked.includes(candidate) || (families.has(candidate.familyId) && guard < 100)) continue;
    picked.push(candidate); families.add(candidate.familyId);
  }
  return picked;
}

/** Deterministic stand-in mate for plays whose original mate choice was lost (child reload). */
function restoredMate(playId: bigint, exclude: bigint | undefined) {
  const pool = WILD_POOL.filter(creature => creature.tokenId !== exclude);
  return pool[Number(playId % BigInt(pool.length))];
}

export function makeBaby(friendId: bigint, a: Creature, b: Creature, playId: bigint, tier: TierId): Creature {
  const result = breed({ a, b, tier, playId, seed: breedSeed(friendId, a.key, b.key, playId) });
  return Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId,
  });
}

export function useRareBreeds({ friendId, client, paused }: { friendId: bigint; client: GameClient; paused: boolean }) {
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
  const definition = client.definition;

  const remember = (creature: Creature) => { lineage.current.set(creature.key, creature); return creature; };

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
    locked.current = false; lineage.current = new Map();
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
            ?? remember(makeBaby(friendId, player, remember(restoredMate(play.id, friendId)), play.id, tier)));
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

  const eggs = snapshot?.consumables ?? 0n;
  const needsEgg = eggs === 0n;
  const blocker = snapshot && needsEgg ? purchaseBlocker(snapshot, definition) : null;
  const canAfford = !!snapshot && !blocker;
  const blockerText = blocker === "balance" ? "Not enough simulated RF for an egg. Send a baby to the Sanctuary to earn some back."
    : blocker === "backing" ? "The hatchery is out of prize backing right now." : "";
  const pendingPlay = snapshot?.plays.find(play => play.outcomeId === null) ?? null;

  /** Buy an egg if needed, lay it, and settle it. Resolves with the hatch state (stage "hatching"). */
  const breedPair = useCallback(async (a: Creature, b: Creature, onLaid?: () => Promise<void>) => {
    return run("buying", async () => {
      const version = epoch.current;
      let play = pendingPlay;
      if (!play) {
        if ((await client.read()).consumables === 0n) { setStep("buying"); await client.buy(1n); }
        setStep("laying");
        play = (await client.play(1n))[0];
      }
      setStep("hatching");
      const [settled] = await Promise.all([client.settle(play.id), onLaid?.()]);
      if (settled.outcomeId === null) throw new Error("The egg has not hatched yet. Try again in a moment.");
      const tier = TIER_ORDER[settled.outcomeId - 1];
      remember(a); remember(b);
      const baby = remember(makeBaby(friendId, a, b, settled.id, tier));
      const state: HatchState = { baby, parentA: a, parentB: b, outcomeId: settled.outcomeId, stage: "hatching" };
      if (version === epoch.current) {
        setBabies(current => new Map(current).set(baby.key, baby));
        setHatch(state);
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
  const brood = useMemo(() => [...babies.values()].sort((x, y) => Number((x.playId ?? 0n) - (y.playId ?? 0n))), [babies]);
  const creature = useCallback((key: string) => lineage.current.get(key) ?? null, []);

  return {
    definition, snapshot, player, loadError, retryLoad: load, error, clearError: () => setError(""), busy,
    eggs, needsEgg, canAfford, blockerText, buyEggs, pendingPlay, brood, candidates, reroll, hatch, breedPair, finishHatch, closeHatch,
    release, creature,
  };
}
