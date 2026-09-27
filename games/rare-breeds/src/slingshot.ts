// Moon Slingshot: a kept baby rides a firework rocket out of the nursery and the player decides when it jumps,
// like the casino game Crash. Owned by the project lead.
//
// The baby's value goes through the SDK: a launch first redeems the baby (runtime confirmation, tier token burned,
// its fixed value lands in the RF balance). That value is the stake. SDK v0.1.2 has one outcome table and no other
// RF actions, so the multiplier runs in this SIMULATED side ledger, which books only payout minus stake. It mirrors
// the SDK's rules: a flight needs free Moon Fund covering its highest payout (x10), the crash point is drawn once at
// ignition and never redrawn, and every result is final. On-chain it would be its own contract (see the README).
//
// The flight: while the player holds, the multiplier grows from x1 as m(t) = e^(k t) = 10^(t / 9 s), k = ln(10) / 9 s
// (x2 at about 2.7 s, x4 at 5.4 s, x10 at 9 s). Letting go jumps at floor(m x 100) / 100. One roll in 0-9999 fixes the
// crash point C = floor(900000 / (roll + 1)) hundredths, capped at x10, so P(C >= h) = floor(900000 / h) / 10000
// exactly: 90% for x1, 45% for x2, 9% for x10. A jump at h wins iff C >= h and pays stake x h / 100, so any jump
// returns at most 0.9x on average. Below x1 (10%) the rocket fizzles on the pad; at x10 the baby jumps onto the Moon.
import { useCallback, useRef, useState } from "react";
import { samplePreviewRoll } from "@rarefriends/friendsdk/game";
import { RF_UNIT } from "./economy.ts";

const ROLLS = 10_000;
/** 0.9 x ROLLS x 100: the crash curve's numerator, so P(C >= h) = floor(CRASH_NUMERATOR / h) / ROLLS. */
const CRASH_NUMERATOR = 900_000;

/** Multipliers are whole hundredths: 100 = x1 (ignition), 1000 = x10 (the Moon, automatic jump). */
export const START_HUNDREDTHS = 100, MOON_HUNDREDTHS = 1000;
/** Flight time to x10: m(t) = 10^(t / FLIGHT_MS). */
export const FLIGHT_MS = 9000;
/** The most any jump pays back on average, in basis points of the stake (x0.9). */
export const MAX_RETURN_BPS = CRASH_NUMERATOR / 100;
/** The panel's exits ladder, nearest first: x1.5, x2, x4 and the automatic Moon jump at x10. */
export const LADDER_EXITS: readonly number[] = Object.freeze([150, 200, 400, MOON_HUNDREDTHS]);

/** Simulated Moon Fund at session start: 10 x the highest payout (Prismatic 6 RF x10), the SDK preview-stake convention. */
export const MOON_FUND_START = 600n * RF_UNIT;

function checkRoll(roll: number) {
  if (!Number.isInteger(roll) || roll < 0 || roll >= ROLLS) throw new RangeError(`Roll must be an integer 0-9999, got ${roll}.`);
}
function checkExit(hundredths: number) {
  if (!Number.isInteger(hundredths) || hundredths < START_HUNDREDTHS || hundredths > MOON_HUNDREDTHS) {
    throw new RangeError(`Exit must be whole hundredths from 100 to 1000, got ${hundredths}.`);
  }
}

/** Crash point in hundredths for a roll in 0-9999: floor(900000 / (roll + 1)), at most x10. Below 100 (rolls 9000-9999) it fizzles on the pad. */
export function crashPoint(roll: number): number {
  checkRoll(roll);
  return Math.min(MOON_HUNDREDTHS, Math.floor(CRASH_NUMERATOR / (roll + 1)));
}

/** Rolls (of 10000) whose rocket reaches `hundredths` (100-1000), which is also its chance in basis points: floor(900000 / h). */
export function reachBps(hundredths: number): number {
  checkExit(hundredths);
  return Math.floor(CRASH_NUMERATOR / hundredths);
}

/** Chance that the rocket fizzles on the pad (crash point below x1): 1000 bps. */
export const FIZZLE_BPS = ROLLS - reachBps(START_HUNDREDTHS);

/** The multiplier after `ms` of flight in whole hundredths: floor(100 x 10^(ms / 9000)), 100 (x1) at ignition up to 1000 (x10) at 9 s. */
export function flightHundredths(ms: number): number {
  if (!(ms > 0)) return START_HUNDREDTHS;
  if (ms >= FLIGHT_MS) return MOON_HUNDREDTHS;
  return Math.min(MOON_HUNDREDTHS, Math.floor(100 * 10 ** (ms / FLIGHT_MS)));
}

/** The first whole millisecond at which the multiplier shows `hundredths` (100-1000): 2710 for x2, 9000 for x10. */
export function msToReach(hundredths: number): number {
  checkExit(hundredths);
  let ms = Math.max(0, Math.ceil(FLIGHT_MS * Math.log10(hundredths / 100)) - 1);
  while (flightHundredths(ms) < hundredths) ms++;
  while (ms > 0 && flightHundredths(ms - 1) >= hundredths) ms--;
  return ms;
}

/** "x0.9", "x1.5", "x2", "x10"; `fixed` always shows two decimals for the live counter: "x2.37", "x2.00". */
export function multiplierLabel(hundredths: number, fixed = false): string {
  const whole = Math.floor(hundredths / 100), cents = String(hundredths % 100).padStart(2, "0");
  const fraction = fixed ? cents : cents.replace(/0+$/, "");
  return `x${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Payout of a jump at `hundredths` for a stake of `value` base units, rounded down to whole base units. */
export function exitPayout(value: bigint, hundredths: number): bigint {
  return value * BigInt(hundredths) / 100n;
}

/** The Moon payout (x10): what the fund must cover before this baby may fly. */
export function maxLaunchPayout(value: bigint): bigint {
  return exitPayout(value, MOON_HUNDREDTHS);
}

/** Exact expected payout of always jumping at `hundredths`, rounded down once: value x h x floor(900000 / h) / 10^6 <= 0.9 x value. */
export function exitExpectedValue(value: bigint, hundredths: number): bigint {
  return value * BigInt(hundredths) * BigInt(reachBps(hundredths)) / BigInt(100 * ROLLS);
}

/** How a flight ended: fizzled on the pad, crashed in the air (both land in the pond), jumped with the parachute, or reached the Moon. */
export type FlightEnd = "fizzle" | "crash" | "jump" | "moon";

export type LaunchResult = Readonly<{
  babyKey: string;
  /** The baby's Sanctuary value, the stake of this launch. */
  value: bigint;
  roll: number;
  /** Where the rocket gives out, in hundredths (90 to 1000); 1000 means it was good for the Moon. */
  crash: number;
  end: FlightEnd;
  /** Where the baby jumped, in hundredths (1000 on the Moon), or null when the rocket dropped it in the pond. */
  exit: number | null;
  payout: bigint;
  /** Its exit beats every earlier exit this session (a pond landing never does). */
  record: boolean;
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
  /** Highest exit so far in hundredths (a jump or the Moon), 0 before the first: the record to beat. */
  topExit: number;
}>;

export const initialLedger = (): SlingshotLedger => Object.freeze({ fund: MOON_FUND_START, winnings: 0n, staked: 0n, launches: 0, best: null, topExit: 0 });

/** What the slingshot added to (or took from) the player on top of the traded-in values. */
export const slingshotNet = (ledger: SlingshotLedger) => ledger.winnings - ledger.staked;

export type LaunchBlocker = "worthless" | "backing" | null;

/** Why this baby may not fly right now, or null. "backing": the fund cannot cover its Moon payout. */
export function launchBlocker(ledger: SlingshotLedger, value: bigint): LaunchBlocker {
  if (value <= 0n) return "worthless";
  return ledger.fund < maxLaunchPayout(value) ? "backing" : null;
}

/**
 * Pure flight: the roll fixes the crash point; `exit` is the jump in hundredths, or null when the player held to the end.
 * A jump at or below the crash point wins (x10 is the Moon); otherwise the rocket gave out first (x0, the pond), except
 * that a rocket good for the Moon jumps there by itself. The stake joins the fund, the fund pays the payout.
 */
export function resolveLaunch(ledger: SlingshotLedger, babyKey: string, value: bigint, roll: number, exit: number | null): Readonly<{ result: LaunchResult; ledger: SlingshotLedger }> {
  const blocker = launchBlocker(ledger, value);
  if (blocker) throw new RangeError(blocker === "backing" ? "The Moon Fund cannot cover this launch." : "This baby has no value to launch.");
  if (exit !== null) checkExit(exit);
  const crash = crashPoint(roll);
  const jumped = exit !== null && exit <= crash;
  const end: FlightEnd = jumped ? (exit === MOON_HUNDREDTHS ? "moon" : "jump") : crash >= MOON_HUNDREDTHS ? "moon" : crash < START_HUNDREDTHS ? "fizzle" : "crash";
  const at = end === "moon" ? MOON_HUNDREDTHS : jumped ? exit : null;
  const payout = at === null ? 0n : exitPayout(value, at);
  const result: LaunchResult = Object.freeze({ babyKey, value, roll, crash, end, exit: at, payout, record: at !== null && at > ledger.topExit });
  return Object.freeze({
    result,
    ledger: Object.freeze({
      fund: ledger.fund + value - payout,
      winnings: ledger.winnings + payout,
      staked: ledger.staked + value,
      launches: ledger.launches + 1,
      best: !ledger.best || payout > ledger.best.payout ? result : ledger.best,
      topExit: Math.max(ledger.topExit, at ?? 0),
    }),
  });
}

/**
 * The flight in the air, outside React: `ignite` draws its crash point once, `settle` books it once. `read` and
 * `write` hold the ledger. useSlingshot keeps one desk per session; the tests drive it directly.
 */
export function createFlightDesk(read: () => SlingshotLedger, write: (next: SlingshotLedger) => void, draw: () => number = samplePreviewRoll) {
  let pending: Readonly<{ babyKey: string; value: bigint; roll: number }> | null = null;
  return {
    /** Ignition: draws the crash point now (hundredths). Asking again for the same flight returns the same one. Null when blocked or another flight is in the air. */
    ignite(babyKey: string, value: bigint): number | null {
      if (pending) return pending.babyKey === babyKey ? crashPoint(pending.roll) : null;
      if (launchBlocker(read(), value)) return null;
      pending = Object.freeze({ babyKey, value, roll: draw() });
      return crashPoint(pending.roll);
    },
    /** Books the flight in the air, once: `exit` is the jump in hundredths, or null when it was held to the end. Null when nothing is in the air. */
    settle(exit: number | null): LaunchResult | null {
      const current = pending;
      if (!current) return null;
      pending = null;
      const next = resolveLaunch(read(), current.babyKey, current.value, current.roll, exit);
      write(next.ledger);
      return next.result;
    },
    /** A rocket is lit and not booked yet. */
    get flying() { return pending !== null; },
  };
}

/** Session-local slingshot ledger (resets on reload, like the SDK preview ledger). `draw` is injectable for tests. */
export function useSlingshot(draw: () => number = samplePreviewRoll) {
  const [ledger, setLedger] = useState<SlingshotLedger>(initialLedger);
  // The desk books into `live` at once, so it never reads a ledger React has not rendered yet.
  const live = useRef(ledger);
  const [desk] = useState(() => createFlightDesk(() => live.current, next => { live.current = next; setLedger(next); }, draw));
  const blocker = useCallback((value: bigint) => launchBlocker(ledger, value), [ledger]);
  return { ledger, blocker, ignite: desk.ignite, settle: desk.settle };
}
