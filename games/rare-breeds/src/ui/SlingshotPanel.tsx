import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { formatChance, formatRF, type TierRow } from "../economy.ts";
import { LAUNCH_ZONES, expectedMultiplierBps, launchExpectedValue, launchPayout, multiplierLabel, type LaunchBlocker } from "../slingshot.ts";
import type { Creature, LaunchZoneId } from "../types.ts";
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
   * The band was let go. `pull` is 0.3 to 1 and cosmetic only. The caller trades the baby in (runtime redeem
   * confirmation), and only after that draws the zone (useSlingshot().launch) and starts the flight.
   */
  onLaunch: (babyKey: string, pull: number) => void;
  /** Empty state: open the Matchmaker. */
  onFindMatch: () => void;
  /** Omit while busy so the panel cannot be dismissed mid-launch. */
  onClose?: () => void;
  reducedMotion?: boolean;
}>;

/** Short zone names for phone layouts, and tiny ones for the phone-landscape zone strip. */
export const ZONE_SHORT: Readonly<Record<LaunchZoneId, string>> = {
  pond: "Pond", haystack: "Haystack", rooftop: "Rooftop", cloud: "Cloud nine", orbit: "Orbit", moon: "Moon",
};
const ZONE_TINY: Readonly<Record<LaunchZoneId, string>> = { pond: "Pond", haystack: "Hay", rooftop: "Roof", cloud: "Cloud", orbit: "Orbit", moon: "Moon" };

const FAR_FIRST = [...LAUNCH_ZONES].reverse();
const MAX_CHANCE = Math.max(...LAUNCH_ZONES.map(zone => zone.chanceBps));
/** "0.9": the average share of a baby's value that comes back. */
export const AVERAGE_BACK = multiplierLabel(expectedMultiplierBps()).slice(1);
/** Signed simulated RF for nets: "+4.5 RF", "-0.5 RF" (ASCII hyphen-minus), "0 RF". */
export const signedRF = (amount: bigint) => amount > 0n ? `+${formatRF(amount)}` : formatRF(amount);
const PULL_MS = 900, MIN_PULL = 0.3;

type Phase = "idle" | "pulling" | "full";

/**
 * Hold-to-pull: pointer or Space/Enter held down fills the pull over PULL_MS, letting go calls `onRelease`
 * with at least MIN_PULL (a quick tap still launches). Escape, losing focus or a cancelled pointer mid-pull cancels. The pull is
 * written to `--rb-pull` on the given elements every frame, so nothing re-renders while it fills.
 */
function usePull(enabled: boolean, onRelease: (pull: number) => void, targets: readonly { current: HTMLElement | null }[]) {
  const [phase, setPhase] = useState<Phase>("idle");
  const state = useRef({ via: null as "pointer" | "key" | null, start: 0, raf: 0, releasedAt: -Infinity });
  const release = useRef(onRelease);
  release.current = onRelease;
  const paint = (value: number) => { for (const target of targets) target.current?.style.setProperty("--rb-pull", value.toFixed(3)); };
  const stop = () => {
    cancelAnimationFrame(state.current.raf);
    state.current.via = null;
    paint(0);
    setPhase("idle");
  };
  const start = (via: "pointer" | "key") => {
    if (!enabled || state.current.via) return;
    state.current.via = via;
    state.current.start = performance.now();
    setPhase("pulling");
    const tick = (now: number) => {
      const value = Math.min(1, (now - state.current.start) / PULL_MS);
      paint(value);
      if (value >= 1) { setPhase("full"); return; }
      state.current.raf = requestAnimationFrame(tick);
    };
    state.current.raf = requestAnimationFrame(tick);
  };
  const letGo = (via: "pointer" | "key") => {
    if (state.current.via !== via) return;
    const pull = Math.max(MIN_PULL, Math.min(1, (performance.now() - state.current.start) / PULL_MS));
    stop();
    state.current.releasedAt = performance.now();
    release.current(pull);
  };
  const cancel = () => { if (state.current.via) stop(); };
  useEffect(() => { if (!enabled) cancel(); }, [enabled]);
  useEffect(() => () => cancelAnimationFrame(state.current.raf), []);

  const isKey = (key: string) => key === " " || key === "Enter";
  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      start("pointer");
    },
    onPointerUp: () => letGo("pointer"),
    // The system took the touch (scroll, gesture, call): that is not a let-go.
    onPointerCancel: () => { if (state.current.via === "pointer") cancel(); },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (isKey(event.key)) { event.preventDefault(); if (!event.repeat) start("key"); }
      // Handled here, so the panel's Escape (close) does not also fire.
      else if (event.key === "Escape" && state.current.via) { event.preventDefault(); cancel(); }
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isKey(event.key)) return;
      event.preventDefault();
      letGo("key");
    },
    onBlur: () => { if (state.current.via === "key") cancel(); },
    // Assistive tech may activate with a bare click (no pointer or key events): launch with the minimum pull.
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail !== 0 || state.current.via || performance.now() - state.current.releasedAt < 500 || !enabled) return;
      state.current.releasedAt = performance.now();
      release.current(MIN_PULL);
    },
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
  };
  return { phase, handlers };
}

/**
 * The Moon Slingshot station: pick a kept baby, see where it can land (chance, multiplier and the exact
 * simulated payout for this baby), then hold the button to pull the band and let go to launch.
 */
export function SlingshotPanel({ brood, tiers, initialKey, blocker, fund, busy, busyLabel, disabledReason, onLaunch, onFindMatch, onClose,
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
  const stage = useRef<HTMLElement>(null), button = useRef<HTMLButtonElement>(null), picks = useRef<HTMLDivElement>(null);
  const { phase, handlers } = usePull(enabled, pull => { if (selected) onLaunch(selected.key, pull); }, [stage, button]);
  const pulling = phase !== "idle";
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
      <p className="rb-muted">Hatch a baby first, then bring it here.<span className="rb-sling-more"> Where it lands multiplies its value, from x0 to x10.</span></p>
      <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onFindMatch} data-autofocus>
        <PixelIcon name="heart" /><span>Find a match</span></button>
    </div>
  </Panel>;

  const stake = formatRF(value);
  // What the landing does to the Slingshot net: the stake is already in the balance (the trade-in).
  const pondNet = signedRF(launchPayout(value, "pond") - value), moonNet = signedRF(launchPayout(value, "moon") - value);
  // [wide, phone] button text per phase.
  const [label, short] = busy ? [busyLabel ?? "Confirm \"Redeem reward\"…", busyLabel ?? "Confirm…"] : phase === "full" ? ["Full stretch! Let go!", "Full stretch! Let go!"]
    : pulling ? ["Pulling… let go to launch", "Let go to launch"] : ["Hold to pull, let go to launch", "Hold to pull"];
  const footer = <div className="rb-sling-foot">
    <p className={cx("rb-sling-status", reason && "rb-warn")} id={`${id}-status`} role="status">
      <PixelIcon name={reason ? "help" : "sparkle"} />
      {reason ? <span>{reason}</span> : busy ? <span>Confirm "Redeem reward" (the trade-in), then {selected.name} flies. Gone after, even in the pond.</span> : <>
        <span className="rb-sling-gone">{selected.name} is gone after the launch, even in the pond.</span>
        <span className="rb-sling-tiny">{stake} trade-in to your balance, the landing moves your net. Gone after.</span>
      </>}
    </p>
    <button ref={button} type="button" className={cx("rb-button rb-button-primary rb-button-lg rb-sling-pull", pulling && "rb-pulling")}
      disabled={!enabled} aria-busy={busy || undefined} aria-describedby={`${id}-status`} {...handlers}>
      <span className="rb-sling-meter" aria-hidden="true" />
      {busy ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="slingshot" />}
      <span className="rb-sr-only">Launch {selected.name}: </span>
      <span className="rb-sling-label"><span className="rb-long">{label}</span><span className="rb-short">{short}</span></span>
    </button>
  </div>;

  return <Panel eyebrow="Moon Slingshot" title="Shoot for the Moon" onClose={busy ? undefined : onClose} size="lg" footer={footer}
    focusKey="grid" className="rb-sling">
    <p className="rb-sling-lead"><PixelIcon name="slingshot" />
      <span>Launch a kept baby out of the nursery. Where it lands multiplies its value, <strong>from x0 to x10</strong>.</span></p>

    <div className="rb-sling-main">
      <p className="rb-sling-stake">
        <span className="rb-long">Launching trades <strong>{selected.name}</strong> in for its <strong>{stake}</strong> (into your balance as usual, you'll confirm).
          Where it lands then adds to or takes from your <strong>Slingshot net</strong>: pond {pondNet}, Moon {moonNet}.</span>
        <span className="rb-short">{selected.name}'s <strong>{stake}</strong> trade-in goes to your balance (you confirm). Slingshot net: pond {pondNet}, Moon {moonNet}.</span>
      </p>
      <div className="rb-sling-pickers">
        <h3 className="rb-section-label" id={`${id}-who`}>Who flies?</h3>
        <div ref={picks} className="rb-sling-picks" role="radiogroup" aria-labelledby={`${id}-who`}>
          {brood.map(baby => <label key={baby.key} className={cx("rb-pick rb-pick-chip rb-sling-pick", `rb-tier-${baby.tier ?? "common"}`)} style={tierVars(baby.tier)}>
            <input type="radio" className="rb-sr-only" name={`${id}-baby`} value={baby.key} checked={baby.key === selected.key}
              disabled={busy || pulling} onChange={() => setKey(baby.key)} />
            <span className="rb-pick-body">
              <span className="rb-slot"><SpriteThumb creature={baby} scale={2} label="" reducedMotion={reduced} /></span>
              <span className="rb-pick-text">
                <span className="rb-pick-name">{baby.name}</span>
                <span className="rb-pick-meta"><span className="rb-tier-dot" aria-hidden="true" /><span className="rb-sling-tier">{tierLabel(baby.tier)}</span>
                  <span className="rb-sling-sep" aria-hidden="true"> · </span><span className="rb-sr-only">, worth </span>{formatRF(valueOf(baby))}</span>
              </span>
              <span className="rb-pick-check" aria-hidden="true"><PixelIcon name="check" /></span>
            </span>
          </label>)}
        </div>
      </div>

      <figure ref={stage} className={cx("rb-sling-stage", `rb-tier-${selected.tier ?? "common"}`, !reduced && "rb-animate", pulling && "rb-pulling", phase === "full" && "rb-full")}
        style={tierVars(selected.tier)}>
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
        <h3 className="rb-section-label" id={`${id}-ladder`}><span className="rb-long">Where {selected.name} can land · what it pays</span><span className="rb-short">Where it lands · pays</span></h3>
        <ol className="rb-sling-zones">
          {FAR_FIRST.map(zone => {
            const payout = launchPayout(value, zone.id);
            return <li key={zone.id} className={cx("rb-sling-zone", `rb-zone-${zone.id}`)} style={{ "--rb-chance": (zone.chanceBps / MAX_CHANCE).toFixed(3) } as CSSProperties}>
              <span className="rb-sling-rung" aria-hidden="true">{zone.id === "moon" && <PixelIcon name="moon" />}</span>
              <span className="rb-sling-zone-name"><span className="rb-long">{zone.label}</span><span className="rb-short">{ZONE_SHORT[zone.id]}</span>
                <span className="rb-sling-tiny">{ZONE_TINY[zone.id]}</span>
                {zone.id === "moon" && <span className="rb-tag rb-sling-jackpot">Jackpot</span>}</span>
              <span className="rb-sling-chance"><span className="rb-sr-only">: </span>{formatChance(zone.chanceBps)}<span className="rb-sr-only"> chance,</span></span>
              <span className="rb-sling-mult">{multiplierLabel(zone.multiplierBps)}</span>
              <span className={cx("rb-sling-pay", payout === 0n && "rb-sling-zero")}><span className="rb-sr-only">, pays </span>{formatRF(payout)}</span>
            </li>;
          })}
        </ol>
        <p className="rb-sling-ev">On average {AVERAGE_BACK}x its value comes back: {formatRF(launchExpectedValue(value))} for a {stake} stake.</p>
      </section>
    </div>

    <ul className="rb-sling-fine">
      <li>Payouts are simulated RF. Where it lands is random with the odds shown; how hard you pull is just for fun.</li>
      <li>Moon Fund: {formatRF(fund)} (simulated). It pays every win and must cover a baby's Moon payout before it flies.</li>
    </ul>
  </Panel>;
}
