import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { formatChance, formatRF, type TierRow } from "../economy.ts";
import { FIZZLE_BPS, LADDER_EXITS, MAX_RETURN_BPS, MOON_HUNDREDTHS, exitPayout, multiplierLabel, reachBps, type LaunchBlocker } from "../slingshot.ts";
import type { LineageTitle } from "../titles.ts";
import type { Creature } from "../types.ts";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, tierLabel, tierVars, useReducedMotion } from "./shared.ts";

export type SlingshotPanelProps = Readonly<{
  /** Kept babies, oldest first (the brood). */
  brood: readonly Creature[];
  /** describeTiers(definition): each tier's fixed Sanctuary value, which is the stake of a launch (the baby is traded in first). */
  tiers: readonly TierRow[];
  /** Preselect this baby (e.g. opened from its DNA card). Defaults to the newest baby. */
  initialKey?: string | null;
  /** useSlingshot().blocker: why a baby worth `value` may not fly right now, or null. */
  blocker: (value: bigint) => LaunchBlocker;
  /** Simulated Moon Fund, useSlingshot().ledger.fund. */
  fund: bigint;
  /** The session's highest exit in hundredths (useSlingshot().ledger.topExit): "Best jump so far" once it is above 0. */
  bestExit?: number;
  /** A baby's lineage titles (lineageTitles in src/titles.ts): marked in the picker, so an Echo is never launched by accident. */
  titles?: (baby: Creature) => readonly LineageTitle[];
  /** Disables the launch, e.g. while the runtime's trade-in confirmation is open. */
  busy?: boolean;
  /** Button text while busy. Default 'Confirm "Redeem reward"…' ("Confirm…" on phones), the runtime dialog's title. */
  busyLabel?: string;
  /**
   * Any other reason launching is unavailable right now (e.g. the runtime is paused); disables the button and is shown
   * instead of the busy line. Leave it out while busy: the runtime also pauses during its own trade-in confirmation.
   */
  disabledReason?: string;
  /**
   * Launch pressed. The caller trades the baby in (runtime redeem confirmation) and then opens the flight, where the
   * player holds to fly and lets go to jump (the crash point is drawn at ignition, useSlingshot().ignite).
   */
  onLaunch: (babyKey: string) => void;
  /** Empty state: open the Matchmaker. */
  onFindMatch: () => void;
  /** Omit while busy so the panel cannot be dismissed mid-launch. */
  onClose?: () => void;
  reducedMotion?: boolean;
}>;

/** The exits ladder, farthest first: the Moon (automatic jump), x4, x2, x1.5, and the fizzle on the pad. */
const RUNGS = [
  ...[...LADDER_EXITS].reverse().map(hundredths => hundredths === MOON_HUNDREDTHS
    ? { id: "moon", hundredths, name: "Moon, auto jump", short: "Moon", chanceBps: reachBps(hundredths) }
    : { id: `x${hundredths}`, hundredths, name: `Jump at ${multiplierLabel(hundredths)}`, short: multiplierLabel(hundredths), chanceBps: reachBps(hundredths) }),
  { id: "fizzle", hundredths: 0, name: "Fizzles on the pad", short: "Fizzle", chanceBps: FIZZLE_BPS },
] as const;
const MAX_CHANCE = Math.max(...RUNGS.map(rung => rung.chanceBps));
/** "0.9": the average share of a baby's value any jump pays back (a hair less between the round numbers). */
export const AVERAGE_BACK = multiplierLabel(MAX_RETURN_BPS / 100).slice(1);
/** Signed simulated RF for nets: "+4.5 RF", "-0.5 RF" (ASCII hyphen-minus), "0 RF". */
export const signedRF = (amount: bigint) => amount > 0n ? `+${formatRF(amount)}` : formatRF(amount);

/**
 * The Moon Slingshot station: pick a kept baby, see its exits (the chance the rocket gets that far and the exact
 * simulated payout for this baby), then launch: the trade-in confirmation, then the flight.
 */
export function SlingshotPanel({ brood, tiers, initialKey, blocker, fund, bestExit = 0, titles, busy, busyLabel, disabledReason, onLaunch, onFindMatch, onClose,
  reducedMotion }: SlingshotPanelProps) {
  const id = useId();
  const reduced = useReducedMotion(reducedMotion);
  const [key, setKey] = useState(() => initialKey && brood.some(baby => baby.key === initialKey) ? initialKey : null);
  const selected = brood.find(baby => baby.key === key) ?? brood[brood.length - 1] ?? null;
  const valueOf = (baby: Creature) => tiers.find(row => row.tier === (baby.tier ?? "common"))?.reward ?? 0n;
  const value = selected ? valueOf(selected) : 0n;
  const block = selected ? blocker(value) : null;
  const reason = disabledReason
    ?? (block === "backing" ? `The Moon Fund can't cover this baby's Moon payout right now.${brood.some(baby => !blocker(valueOf(baby))) ? " Try a cheaper baby." : ""}` : undefined)
    ?? (block === "worthless" ? "This baby has no Sanctuary value to launch." : undefined);
  const enabled = !!selected && !busy && !reason;
  const picks = useRef<HTMLDivElement>(null);
  // Open with the chosen baby in view: with many babies it can sit past the picker's visible rows.
  useEffect(() => {
    const box = picks.current, chip = box?.querySelector("input:checked")?.closest<HTMLElement>("label");
    if (!box || !chip || chip.offsetParent !== box) return;
    const ring = parseFloat(getComputedStyle(box).paddingBottom) || 0;
    const top = Math.max(0, chip.offsetTop + chip.offsetHeight + ring - box.clientHeight);
    const left = Math.max(0, chip.offsetLeft + chip.offsetWidth + ring - box.clientWidth);
    if (top || left) box.scrollTo({ top, left, behavior: reduced ? "auto" : "smooth" });
  }, []);

  if (!selected) return <Panel eyebrow="Moon Slingshot" title="Shoot for the Moon" onClose={onClose} size="md" focusKey="empty" className="rb-sling">
    <div className="rb-empty rb-sling-empty">
      <span className="rb-empty-art" aria-hidden="true"><PixelIcon name="slingshot" pixel={6} /></span>
      <p className="rb-empty-title">Nobody to launch yet</p>
      <p className="rb-muted">Hatch a baby first, then bring it here.<span className="rb-sling-more"> It rides a rocket: hold to fly, let go to jump. Up to x10, or the pond.</span></p>
      <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onFindMatch} data-autofocus>
        <PixelIcon name="heart" /><span>Find a match</span></button>
    </div>
  </Panel>;

  const stake = formatRF(value);
  // What the flight does to the Slingshot net: the stake is already in the balance (the trade-in).
  const pondNet = signedRF(-value), moonNet = signedRF(exitPayout(value, MOON_HUNDREDTHS) - value);
  const best = bestExit > 0 ? multiplierLabel(bestExit, true) : "";
  // What makes a baby special (its titles, shapes it can pass on): the launch loses it for good.
  const specialOf = (baby: Creature) => {
    const titled = (titles?.(baby) ?? []).map(title => title.label), shaped = (baby.dna?.shapes ?? []).map(shape => shape.label);
    return { titled: titled.length > 0, shaped: shaped.length > 0, labels: [...titled, ...shaped] };
  };
  const special = specialOf(selected).labels;
  const footer = <div className="rb-sling-foot">
    <p className={cx("rb-sling-status", reason && "rb-warn")} id={`${id}-status`} role="status">
      <PixelIcon name={reason ? "help" : "sparkle"} />
      {reason ? <span>{reason}</span> : busy ? <span>Confirm "Redeem reward" (the trade-in), then {selected.name} gets its rocket. Gone after, even in the pond.</span> : <>
        <span className="rb-sling-gone">{selected.name}{special.length ? ` (${special.join(", ")})` : ""} is gone after the launch, even in the pond.</span>
        <span className="rb-sling-tiny">{stake} trade-in to your balance, the flight moves your net. Gone after.</span>
      </>}
    </p>
    <button type="button" className="rb-button rb-button-primary rb-button-lg rb-sling-go" disabled={!enabled} aria-busy={busy || undefined}
      aria-describedby={`${id}-status`} onClick={() => { if (enabled) onLaunch(selected.key); }}>
      {busy ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="slingshot" />}
      <span className="rb-sr-only">Launch {selected.name}: </span>
      <span className="rb-sling-label">{busy ? <><span className="rb-long">{busyLabel ?? "Confirm \"Redeem reward\"…"}</span><span className="rb-short">{busyLabel ?? "Confirm…"}</span></>
        : <><span className="rb-long">Trade in {stake}, then fly</span><span className="rb-short">Trade in &amp; fly</span></>}</span>
    </button>
  </div>;

  return <Panel eyebrow="Moon Slingshot" title="Shoot for the Moon" onClose={busy ? undefined : onClose} size="lg" footer={footer}
    focusKey="grid" className="rb-sling">
    <p className="rb-sling-lead"><PixelIcon name="slingshot" />
      <span>Jump early for a likely small win, hold for a rare big one. <strong>On average every exit returns about {AVERAGE_BACK}x.</strong></span></p>

    <div className="rb-sling-main">
      <p className="rb-sling-stake">
        <span className="rb-long">Your balance gets <strong>{selected.name}</strong>'s <strong>{stake}</strong> either way (the trade-in, you confirm it).
          The flight only moves your <strong>Slingshot net</strong>: below x1 it takes, above x1 it adds (pond {pondNet}, Moon {moonNet}).{best && <> Best jump so far: <strong>{best}</strong>.</>}</span>
        <span className="rb-short">Balance +<strong>{stake}</strong> either way (the trade-in). The flight only moves your Slingshot net: pond {pondNet}, Moon {moonNet}.{best && <> Best: <strong>{best}</strong>.</>}</span>
      </p>
      <div className="rb-sling-pickers">
        <h3 className="rb-section-label" id={`${id}-who`}>Who flies?</h3>
        <div ref={picks} className="rb-sling-picks" role="radiogroup" aria-labelledby={`${id}-who`}>
          {brood.map(baby => { const { titled, shaped, labels: marks } = specialOf(baby);
            return <label key={baby.key} className={cx("rb-pick rb-pick-chip rb-sling-pick", `rb-tier-${baby.tier ?? "common"}`)} style={tierVars(baby.tier)}
              title={marks.length ? marks.join(", ") : undefined}>
            <input type="radio" className="rb-sr-only" name={`${id}-baby`} value={baby.key} checked={baby.key === selected.key}
              disabled={busy} onChange={() => setKey(baby.key)} />
            <span className="rb-pick-body">
              <span className="rb-slot"><SpriteThumb creature={baby} scale={2} label="" reducedMotion={reduced} /></span>
              <span className="rb-pick-text">
                <span className="rb-pick-name">{baby.name}{(titled || shaped) && <span className="rb-sling-marks" aria-hidden="true">
                  {titled && <PixelIcon name="sparkle" className="rb-sling-mark-title" />}{shaped && <PixelIcon name="dna" className="rb-sling-mark-shape" />}</span>}</span>
                <span className="rb-pick-meta"><span className="rb-tier-dot" aria-hidden="true" /><span className="rb-sling-tier">{tierLabel(baby.tier)}</span>
                  <span className="rb-sling-sep" aria-hidden="true"> · </span><span className="rb-sr-only">, worth </span>{formatRF(valueOf(baby))}</span>
                {marks.length > 0 && <span className="rb-sr-only">, {marks.join(", ")}</span>}
              </span>
              <span className="rb-pick-check" aria-hidden="true"><PixelIcon name="check" /></span>
            </span>
          </label>; })}
        </div>
      </div>

      <figure className={cx("rb-sling-stage", `rb-tier-${selected.tier ?? "common"}`, !reduced && "rb-animate")} style={tierVars(selected.tier)}>
        <span className="rb-sling-sky" aria-hidden="true"><PixelIcon name="moon" pixel={3} /><PixelIcon name="sparkle" /><PixelIcon name="sparkle" /></span>
        <span className="rb-sling-rig" aria-hidden="true">
          <PixelIcon name="slingshotBig" pixel={7} className="rb-sling-fork" />
          <span className="rb-sling-band" />
          <SpriteThumb key={selected.key} creature={selected} scale={3} label="" reducedMotion={reduced} className="rb-sling-baby" />
        </span>
        <figcaption className="rb-sling-caption">
          <strong>{selected.name}</strong>
          <span className="rb-tier-badge rb-tier-badge-sm">{tierLabel(selected.tier)}</span>
          <span className="rb-sling-worth">Worth {formatRF(value)}</span>
        </figcaption>
      </figure>

      <section className="rb-sling-ladder" aria-labelledby={`${id}-ladder`}>
        <h3 className="rb-section-label" id={`${id}-ladder`}><span className="rb-long">Where {selected.name} can jump · chance to get there · pays (total)</span><span className="rb-short">Jump at · chance · pays (total)</span></h3>
        <ol className="rb-sling-zones">
          {RUNGS.map(rung => {
            const payout = exitPayout(value, rung.hundredths);
            return <li key={rung.id} className={cx("rb-sling-zone", rung.id === "moon" ? "rb-zone-moon" : rung.id === "fizzle" && "rb-zone-pond")}
              style={{ "--rb-chance": (rung.chanceBps / MAX_CHANCE).toFixed(3) } as CSSProperties}>
              <span className="rb-sling-rung" aria-hidden="true">{rung.id === "moon" && <PixelIcon name="moon" />}</span>
              <span className="rb-sling-zone-name"><span className="rb-long">{rung.name}</span><span className="rb-short">{rung.short}</span>
                <span className="rb-sling-tiny">{rung.short}</span>
                {rung.id === "moon" && <span className="rb-tag rb-sling-jackpot">Jackpot</span>}</span>
              <span className="rb-sling-chance"><span className="rb-sr-only">: </span>{formatChance(rung.chanceBps)}<span className="rb-sr-only"> chance,</span></span>
              <span className="rb-sling-mult">{multiplierLabel(rung.hundredths)}</span>
              <span className={cx("rb-sling-pay", payout === 0n && "rb-sling-zero")}><span className="rb-sr-only">, pays </span>{formatRF(payout)}</span>
            </li>;
          })}
        </ol>
      </section>
    </div>

    <ul className="rb-sling-fine">
      <li>Simulated RF. The multiplier climbs from x1 (x2 at 2.7 s, x10 at 9 s); where the rocket gives out is drawn once, when you light it.</li>
      <li>Moon Fund: {formatRF(fund)} (simulated). It pays every win and must cover a baby's Moon payout (x10) before it flies.</li>
    </ul>
  </Panel>;
}
