// Economy presentation helpers for Rare Breeds. Pure module: type-only SDK imports,
// so node tests and every UI module can use it. All values come from the runtime
// definition (client.definition), never from hard-coded copies of game.json.
import type { ChanceGameDefinition, GameSnapshot } from "@rarefriends/friendsdk/game";
import { TIER_ORDER, TIER_STYLE, type TierId } from "./types.ts";

/** 1 RF in 18-decimal base units. */
export const RF_UNIT = 10n ** 18n;
const BPS_TOTAL = 10_000;

export type TierRow = Readonly<{
  tier: TierId;
  /** One-based SDK outcome ID (index in game.json + 1). */
  outcomeId: number;
  /** Short tier label from TIER_STYLE, e.g. "Prismatic". */
  label: string;
  /** Outcome name from the definition, e.g. "Prismatic hatchling". */
  name: string;
  chanceBps: number;
  /** "60%", "12.5%", "2.5%". */
  chancePercent: string;
  /** "3 in 5", "1 in 40"; "about 1 in N" when the reduced fraction is awkward. */
  odds: string;
  /** Fixed Sanctuary redemption value in RF base units. */
  reward: bigint;
  /** "0.5 RF". */
  rewardLabel: string;
  description: string;
  accent: string;
  glow: string | null;
}>;

// Matches what src/genetics.ts draws for each tier.
const DESCRIPTIONS: Readonly<Record<TierId, string>> = {
  common: "Pure ink: rows straight from both parents.",
  spotted: "A green pattern: spots, stripes or a patch.",
  mutant: "A violet pattern plus a head mutation.",
  prismatic: "Rainbow body, a mutation and a tail. The rarest hatch.",
};

export function tierForOutcome(outcomeId: number): TierId {
  if (!Number.isInteger(outcomeId) || outcomeId < 1 || outcomeId > TIER_ORDER.length) {
    throw new RangeError(`Unknown outcome ${outcomeId}.`);
  }
  return TIER_ORDER[outcomeId - 1];
}

export function outcomeForTier(tier: TierId): number {
  const index = TIER_ORDER.indexOf(tier);
  if (index < 0) throw new RangeError(`Unknown tier ${String(tier)}.`);
  return index + 1;
}

/**
 * Exact decimal RF with trailing zeros trimmed: 10n**18n -> "1 RF", 5n*10n**17n -> "0.5 RF".
 * Thousands are grouped like the runtime confirmations (SDK formatGameAmount): "1,000 RF".
 */
export function formatRF(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const value = amount < 0n ? -amount : amount;
  const whole = (value / RF_UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (value % RF_UNIT).toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""} RF`;
}

/** Basis points as a trimmed percentage: 6000 -> "60%", 1250 -> "12.5%", 25 -> "0.25%". */
export function formatChance(chanceBps: number): string {
  const whole = Math.floor(chanceBps / 100);
  const fraction = String(chanceBps % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

/** Reduced fraction when it reads well ("3 in 5", "1 in 40"), otherwise "about 1 in N". */
export function formatOdds(chanceBps: number): string {
  let a = chanceBps, b = BPS_TOTAL;
  while (b) [a, b] = [b, a % b];
  const numerator = chanceBps / a, denominator = BPS_TOTAL / a;
  return numerator <= 9 ? `${numerator} in ${denominator}` : `about 1 in ${Math.max(1, Math.round(BPS_TOTAL / chanceBps))}`;
}

function assertTierTable(definition: ChanceGameDefinition) {
  if (definition.outcomes.length !== TIER_ORDER.length) {
    throw new RangeError(`Expected ${TIER_ORDER.length} outcomes (${TIER_ORDER.join(", ")}), got ${definition.outcomes.length}.`);
  }
}

/** One row per tier in TIER_ORDER, combining the runtime definition with TIER_STYLE. */
export function describeTiers(definition: ChanceGameDefinition): readonly TierRow[] {
  assertTierTable(definition);
  return Object.freeze(TIER_ORDER.map((tier, index) => {
    const outcome = definition.outcomes[index], style = TIER_STYLE[tier];
    return Object.freeze({
      tier, outcomeId: index + 1, label: style.label, name: outcome.name,
      chanceBps: outcome.chanceBps, chancePercent: formatChance(outcome.chanceBps), odds: formatOdds(outcome.chanceBps),
      reward: outcome.reward, rewardLabel: formatRF(outcome.reward),
      description: DESCRIPTIONS[tier], accent: style.accent, glow: style.glow,
    });
  }));
}

/** Highest fixed reward; the SDK reserves this much backing for every purchased or pending egg. */
export function maxPrize(definition: ChanceGameDefinition): bigint {
  return definition.outcomes.reduce((max, outcome) => outcome.reward > max ? outcome.reward : max, 0n);
}

/** Exact weighted reward per egg, rounded down once to base units (same rule as the SDK's expectedReward). */
export function expectedValue(definition: ChanceGameDefinition): bigint {
  return definition.outcomes.reduce((sum, outcome) => sum + outcome.reward * BigInt(outcome.chanceBps), 0n) / BigInt(BPS_TOTAL);
}

/** "0.8875 RF per egg (88.75% of the 1 RF price)". */
export function expectedValueLabel(definition: ChanceGameDefinition): string {
  const ev = expectedValue(definition);
  // Percent of price with two decimals, truncated: ev * 10000 / price basis points of the price.
  const bps = Number(ev * BigInt(BPS_TOTAL) / definition.price);
  return `${formatRF(ev)} per ${definition.consumable.toLowerCase()} (${formatChance(bps)} of the ${formatRF(definition.price)} price)`;
}

export type PurchaseBlocker = "balance" | "backing" | null;

/**
 * Mirrors the SDK preview ledger's purchase rule for one egg: enough RF, and free
 * stake that covers the maximum prize before and after the purchase. Use it to
 * explain a disabled Buy button; client.canBuy(1n) remains the authority.
 */
export function purchaseBlocker(snapshot: Pick<GameSnapshot, "rfBalance" | "freeStake">, definition: ChanceGameDefinition, quantity = 1n): PurchaseBlocker {
  const cost = definition.price * quantity, reserve = maxPrize(definition) * quantity;
  if (snapshot.rfBalance < cost) return "balance";
  if (snapshot.freeStake < maxPrize(definition) || snapshot.freeStake + cost < reserve) return "backing";
  return null;
}
