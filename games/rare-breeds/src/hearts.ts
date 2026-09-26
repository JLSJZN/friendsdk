// Hearts: a session-local game-point currency earned by kept babies. Owned by the project lead.
// Hearts are never RF, cannot be redeemed and back no payout, so they need no prize reserve.
// They give "Keep" a real reason next to the Sanctuary's fixed RF value.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACCESSORIES } from "./accessories.ts";
import { FAMILY_NAMES } from "./sprites.ts";
import type { AccessoryId, Creature, TierId } from "./types.ts";

/** Hearts each kept baby earns per cycle, by tier. */
export const HEART_RATE: Readonly<Record<TierId, number>> = { common: 1, spotted: 2, mutant: 4, prismatic: 10 };
export const HEART_CYCLE_SECONDS = 10;
/** One-off Hearts when a baby is kept. */
export const KEEP_BONUS = 5;
/** Price of a Wish match: three candidates from a chosen family. */
export const WISH_PRICE = 15;

export const heartsPerMinute = (tier: TierId | undefined) => HEART_RATE[tier ?? "common"] * (60 / HEART_CYCLE_SECONDS);
export const accessoryInfo = (id: AccessoryId) => ACCESSORIES.find(item => item.id === id)!;

/** Stable per-creature phase (0 to cycle-1) so babies pop hearts at different moments. */
function phaseOf(key: string) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % HEART_CYCLE_SECONDS;
}

export type HeartsOptions = Readonly<{
  brood: readonly Creature[];
  /** No income while false (runtime paused, tab hidden, loading). */
  active: boolean;
  /** Visual hook: a creature earned hearts this second. */
  onEarn?: (key: string, amount: number) => void;
}>;

export function useHearts({ brood, active, onEarn }: HeartsOptions) {
  const [hearts, setHearts] = useState(0);
  const [earned, setEarned] = useState(0);
  const [owned, setOwned] = useState<ReadonlySet<AccessoryId>>(new Set());
  const [equipped, setEquipped] = useState<ReadonlyMap<string, AccessoryId>>(new Map());
  const clock = useRef(0), live = useRef({ brood, active, onEarn }), balance = useRef(0);
  live.current = { brood, active, onEarn };
  balance.current = hearts;

  useEffect(() => {
    const timer = window.setInterval(() => {
      const { brood: babies, active: on, onEarn: earn } = live.current;
      if (!on || document.visibilityState !== "visible") return;
      const second = clock.current++ % HEART_CYCLE_SECONDS;
      let total = 0;
      for (const baby of babies) if (phaseOf(baby.key) === second) {
        const amount = HEART_RATE[baby.tier ?? "common"];
        total += amount;
        earn?.(baby.key, amount);
      }
      if (total) { setHearts(value => value + total); setEarned(value => value + total); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const grant = useCallback((amount: number) => {
    setHearts(value => value + amount); setEarned(value => value + amount);
  }, []);

  /** Spend Hearts. Returns false (and spends nothing) when there are not enough. */
  const spend = useCallback((amount: number) => {
    if (balance.current < amount) return false;
    balance.current -= amount;
    setHearts(value => value - amount);
    return true;
  }, []);

  const buy = useCallback((id: AccessoryId) => {
    if (owned.has(id) || !spend(accessoryInfo(id).price)) return false;
    setOwned(current => new Set(current).add(id));
    return true;
  }, [owned, spend]);

  /** Equip an owned accessory on one creature (each accessory is worn by one creature at a time), or remove with null. */
  const equip = useCallback((key: string, id: AccessoryId | null) => {
    setEquipped(current => {
      const next = new Map([...current].filter(([, value]) => value !== id));
      if (id) next.set(key, id); else next.delete(key);
      return next;
    });
  }, []);

  const dress = useCallback((creature: Creature): Creature => {
    const accessory = equipped.get(creature.key);
    return accessory === creature.accessory ? creature : Object.freeze({ ...creature, accessory });
  }, [equipped]);

  const perMinute = useMemo(() => brood.reduce((sum, baby) => sum + heartsPerMinute(baby.tier), 0), [brood]);

  return { hearts, earned, perMinute, owned, equipped, grant, spend, buy, equip, dress };
}

export const wishFamilies = FAMILY_NAMES.map((name, familyId) => ({ familyId, name }));
