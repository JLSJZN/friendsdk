// Moon Slingshot: launch a kept baby out of the nursery; the landing zone multiplies its
// Sanctuary value. Owned by the project lead.
//
// The baby's value goes through the SDK: a launch first redeems the baby (runtime confirmation,
// tier token burned, its fixed value lands in the RF balance). That value is the stake. SDK v0.1.2
// has one outcome table and no other RF actions, so the multiplier runs in this SIMULATED side
// ledger, which books only payout minus stake. It mirrors the SDK's rules: a launch needs free
// Moon Fund covering its highest payout, the zone is drawn once after the trade-in, and every
// result is final. On-chain it would be its own contract (take the tier token as stake, one Dice
// roll, pay from its own stake).
import { useCallback, useRef, useState } from "react";
import { samplePreviewRoll } from "@rarefriends/friendsdk/game";
import { RF_UNIT } from "./economy.ts";
import { LAUNCH_ZONE_ORDER, type LaunchZoneId } from "./types.ts";

const BPS_TOTAL = 10_000;

export type LaunchZone = Readonly<{
  id: LaunchZoneId;
  label: string;
  /** Chance in basis points; all zones sum to 10000. */
  chanceBps: number;
  /** Payout as basis points of the baby's value: 0 = x0, 10000 = x1, 100000 = x10. */
  multiplierBps: number;
  /** One short line for the result card. */
  line: string;
}>;

/** Nearest first, same order as LAUNCH_ZONE_ORDER. Rolls 0-3999 are the pond, 9800-9999 the Moon. */
export const LAUNCH_ZONES: readonly LaunchZone[] = Object.freeze(([
  { id: "pond", label: "Belly flop in the pond", chanceBps: 4000, multiplierBps: 0, line: "Splash! The ducks keep this one." },
  { id: "haystack", label: "Haystack", chanceBps: 2400, multiplierBps: 5000, line: "Soft landing. Half its value back." },
  { id: "rooftop", label: "Rooftop", chanceBps: 1800, multiplierBps: 10_000, line: "Bonk! Its full value back." },
  { id: "cloud", label: "Cloud nine", chanceBps: 1200, multiplierBps: 20_000, line: "Boing! Double its value." },
  { id: "orbit", label: "Orbit", chanceBps: 400, multiplierBps: 40_000, line: "Round and round. Four times its value." },
  { id: "moon", label: "The Moon", chanceBps: 200, multiplierBps: 100_000, line: "One small hop for a baby. Ten times its value!" },
] satisfies LaunchZone[]).map(zone => Object.freeze(zone)));

/** Simulated Moon Fund at session start: 10 x the highest payout (Prismatic 6 RF x10), the SDK preview-stake convention. */
export const MOON_FUND_START = 600n * RF_UNIT;

export function zoneInfo(id: LaunchZoneId): LaunchZone {
  const zone = LAUNCH_ZONES.find(item => item.id === id);
  if (!zone) throw new RangeError(`Unknown zone ${String(id)}.`);
  return zone;
}

/** "x0", "x0.5", "x1", "x10". */
export function multiplierLabel(multiplierBps: number): string {
  const whole = Math.floor(multiplierBps / BPS_TOTAL);
  const fraction = String(multiplierBps % BPS_TOTAL).padStart(4, "0").replace(/0+$/, "");
  return `x${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Roll in 0-9999 against the cumulative zone weights, like the SDK's outcomeForRoll. */
export function zoneForRoll(roll: number): LaunchZoneId {
  if (!Number.isInteger(roll) || roll < 0 || roll >= BPS_TOTAL) throw new RangeError(`Roll must be an integer 0-9999, got ${roll}.`);
  let cumulative = 0;
  for (const zone of LAUNCH_ZONES) {
    cumulative += zone.chanceBps;
    if (roll < cumulative) return zone.id;
  }
  throw new RangeError("Zone weights do not cover every roll.");
}

/** Exact payout in RF base units for a baby worth `value`. */
export function launchPayout(value: bigint, zone: LaunchZoneId): bigint {
  return value * BigInt(zoneInfo(zone).multiplierBps) / BigInt(BPS_TOTAL);
}

/** The Moon payout: what the fund must cover before this baby may fly. */
export function maxLaunchPayout(value: bigint): bigint {
  return launchPayout(value, LAUNCH_ZONE_ORDER[LAUNCH_ZONE_ORDER.length - 1]);
}

/** Weighted multiplier in basis points: 9000 = on average 0.9 x the baby's value comes back. */
export function expectedMultiplierBps(): number {
  return LAUNCH_ZONES.reduce((sum, zone) => sum + zone.chanceBps * zone.multiplierBps, 0) / BPS_TOTAL;
}

/** Exact expected payout for a baby worth `value`, rounded down once to base units. */
export function launchExpectedValue(value: bigint): bigint {
  return LAUNCH_ZONES.reduce((sum, zone) => sum + value * BigInt(zone.multiplierBps) * BigInt(zone.chanceBps), 0n) / BigInt(BPS_TOTAL * BPS_TOTAL);
}

export type LaunchResult = Readonly<{
  babyKey: string;
  zone: LaunchZoneId;
  /** The baby's Sanctuary value, the stake of this launch. */
  value: bigint;
  payout: bigint;
  roll: number;
}>;

export type SlingshotLedger = Readonly<{
  /** Simulated Moon Fund; pays every payout. */
  fund: bigint;
  /** Sum of payouts this session. */
  winnings: bigint;
  /** Sum of stakes (traded-in baby values) this session; net = winnings - staked. */
  staked: bigint;
  launches: number;
  /** Highest payout so far (ties keep the earlier one). */
  best: LaunchResult | null;
}>;

export const initialLedger = (): SlingshotLedger => Object.freeze({ fund: MOON_FUND_START, winnings: 0n, staked: 0n, launches: 0, best: null });

/** What the slingshot added to (or took from) the player on top of the traded-in values. */
export const slingshotNet = (ledger: SlingshotLedger) => ledger.winnings - ledger.staked;

export type LaunchBlocker = "worthless" | "backing" | null;

/** Why this baby may not fly right now, or null. "backing": the fund cannot cover its Moon payout. */
export function launchBlocker(ledger: SlingshotLedger, value: bigint): LaunchBlocker {
  if (value <= 0n) return "worthless";
  return ledger.fund < maxLaunchPayout(value) ? "backing" : null;
}

/** Pure launch: the roll picks the zone, the stake joins the fund, the fund pays the payout. */
export function resolveLaunch(ledger: SlingshotLedger, babyKey: string, value: bigint, roll: number): Readonly<{ result: LaunchResult; ledger: SlingshotLedger }> {
  const blocker = launchBlocker(ledger, value);
  if (blocker) throw new RangeError(blocker === "backing" ? "The Moon Fund cannot cover this launch." : "This baby has no value to launch.");
  const zone = zoneForRoll(roll);
  const payout = launchPayout(value, zone);
  const result: LaunchResult = Object.freeze({ babyKey, zone, value, payout, roll });
  return Object.freeze({
    result,
    ledger: Object.freeze({
      fund: ledger.fund + value - payout,
      winnings: ledger.winnings + payout,
      staked: ledger.staked + value,
      launches: ledger.launches + 1,
      best: !ledger.best || payout > ledger.best.payout ? result : ledger.best,
    }),
  });
}

/** Session-local slingshot ledger (resets on reload, like the SDK preview ledger). `draw` is injectable for tests. */
export function useSlingshot(draw: () => number = samplePreviewRoll) {
  const [ledger, setLedger] = useState<SlingshotLedger>(initialLedger);
  const live = useRef(ledger);
  live.current = ledger;

  const blocker = useCallback((value: bigint) => launchBlocker(live.current, value), [ledger]);

  /** Draws the zone now and books the result. Returns null (nothing changes) when blocked. */
  const launch = useCallback((babyKey: string, value: bigint): LaunchResult | null => {
    if (launchBlocker(live.current, value)) return null;
    const next = resolveLaunch(live.current, babyKey, value, draw());
    live.current = next.ledger;
    setLedger(next.ledger);
    return next.result;
  }, [draw]);

  return { ledger, blocker, launch };
}
