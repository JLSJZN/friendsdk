import { useEffect, useId, useMemo, useRef, type CSSProperties, type Ref } from "react";
import { formatRF } from "../economy.ts";
import { multiplierLabel, zoneInfo, type LaunchResult } from "../slingshot.ts";
import type { Creature, LaunchZoneId } from "../types.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { signedRF } from "./SlingshotPanel.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, hashString, tierLabel, useModalFocus, useReducedMotion } from "./shared.ts";

export type LaunchOverlayProps = Readonly<{
  /** "flying" shows the flight canvas and Skip; "result" adds the result card over the landed frame. */
  stage: "flying" | "result";
  /**
   * Receives the flight canvas. Pass it to createLaunchSequence({ canvas, ... }).
   * A callback ref (e.g. a useState setter) tells you exactly when the canvas exists.
   */
  canvasRef: Ref<HTMLCanvasElement>;
  /** Jump to the landing (sequence.skip()). Also bound to Escape while flying. */
  onSkip?: () => void;
  /** The booked launch from useSlingshot().launch: zone, stake (`value`, the traded-in baby) and payout. The result card needs it. */
  result: LaunchResult | null;
  /** The launched baby. Keep your own copy: it has already left the brood. */
  baby: Creature | null;
  /** Babies remain in the brood: shows "Launch another". */
  canLaunchAgain: boolean;
  /** Usually reopens the Moon Slingshot panel. */
  onLaunchAgain: () => void;
  /** "Back to the nursery", and Escape on the result stage. */
  onClose: () => void;
  reducedMotion?: boolean;
}>;

/** Where the baby lives now: the launch is final, even in the pond. */
const HOME: Readonly<Record<LaunchZoneId, (name: string) => string>> = {
  pond: name => `${name} paddles with the ducks now.`,
  haystack: name => `${name} naps in the hay now.`,
  rooftop: name => `${name} rules the rooftop now.`,
  cloud: name => `${name} lives on cloud nine now.`,
  orbit: name => `${name} is a tiny satellite now.`,
  moon: name => `${name} lives on the Moon now.`,
};

/**
 * After the landing, keyboard closing (Escape, Enter or Space on the focused button) waits this long, so a double
 * press meant for Skip does not also close the card. Clicks and taps act at once.
 */
const SETTLE_MS = 400;

/** Pixel confetti for the big landings (same look as the hatch reveal). Decorative; not rendered with reduced motion. */
function Confetti({ seed }: { seed: string }) {
  const bits = useMemo(() => {
    let hash = hashString(seed);
    const next = () => { hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0; return hash / 4294967296; };
    return Array.from({ length: 24 }, (_, index) => {
      const angle = (index / 24) * Math.PI * 2 + next() * 0.4;
      const distance = 110 + next() * 110;
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance * 0.7 - 30, delay: next() * 160, tone: index % 3 };
    });
  }, [seed]);
  return <span className="rb-confetti" aria-hidden="true">
    {bits.map((bit, index) => <i key={index} className={`rb-confetti-bit rb-tone-${bit.tone}`}
      style={{ "--dx": `${bit.x.toFixed(0)}px`, "--dy": `${bit.y.toFixed(0)}px`, animationDelay: `${bit.delay.toFixed(0)}ms` } as CSSProperties} />)}
  </span>;
}

/**
 * Full-area overlay for the Moon Slingshot flight, then the result card over the landed frame: payout, stake, net, and
 * where the money went (the trade-in is in the balance, the net goes to the simulated Slingshot net).
 */
export function LaunchOverlay({ stage, canvasRef, onSkip, result, baby, canLaunchAgain, onLaunchAgain, onClose, reducedMotion }: LaunchOverlayProps) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion(reducedMotion);
  const flying = stage === "flying" || !result;
  const name = baby?.name ?? "Your baby";
  const landedAt = useRef(0);
  useEffect(() => { if (!flying) landedAt.current = performance.now(); }, [flying]);
  const settled = () => performance.now() - landedAt.current >= SETTLE_MS;
  useModalFocus(node, flying ? onSkip : () => { if (settled()) onClose(); }, flying ? "flying" : "result");
  const zone = result && zoneInfo(result.zone);
  const cheer = result?.zone === "moon" || result?.zone === "orbit";
  const mult = zone ? multiplierLabel(zone.multiplierBps) : "";
  const net = result ? result.payout - result.value : 0n;
  const stake = result ? formatRF(result.value) : "";
  // Where the money went: the trade-in is already in the balance, the landing only moves the simulated Slingshot net.
  const netLine = net > 0n ? `${signedRF(net)} goes to your Slingshot net (simulated, not spendable in this preview).`
    : net < 0n ? `${signedRF(net)} comes off your Slingshot net (simulated).` : "Your Slingshot net stays the same (simulated).";

  return <div ref={node} className={cx("rb-hatch rb-launch", !reduced && "rb-animate")} data-stage={flying ? "flying" : "result"} role="dialog" aria-modal="true"
    aria-label={flying ? `${name} is flying` : undefined} aria-labelledby={flying ? undefined : `${id}-zone`} tabIndex={-1}>
    <canvas ref={canvasRef} className="rb-hatch-canvas" aria-hidden="true" />
    <p className="rb-sr-only" role="status">{flying ? `${name} is flying…` : zone ? `${name} landed: ${zone.label}, ${mult}. Your ${stake} trade-in is in your balance. Slingshot net ${signedRF(net)}, simulated.` : ""}</p>
    {flying && onSkip && <button type="button" className="rb-button rb-button-dark rb-hatch-skip" onClick={onSkip}>
      <span>Skip</span><PixelIcon name="back" className="rb-flip" />
    </button>}
    {!flying && result && zone && <div className="rb-hatch-result">
      {cheer && !reduced && <Confetti seed={`${result.babyKey}:${result.roll}`} />}
      <article className={cx("rb-launch-card", `rb-zone-${result.zone}`, !reduced && "rb-animate")} aria-labelledby={`${id}-zone`}>
        <div className="rb-launch-top">
          {baby && <span className="rb-slot rb-launch-baby"><SpriteThumb creature={baby} scale={4} compactScale={2} label={`${baby.name}, ${tierLabel(baby.tier)} baby`} reducedMotion={reduced} /></span>}
          <div className="rb-launch-head">
            <p className="rb-eyebrow">Where {name} landed</p>
            <h2 className="rb-launch-zone" id={`${id}-zone`}>{zone.label}</h2>
            <p className="rb-launch-line">{zone.line}</p>
          </div>
          <span className="rb-launch-stamp" aria-hidden="true">{mult}</span>
        </div>
        <div className="rb-launch-payout">
          <dl className="rb-launch-sums">
            <div><dt>Payout</dt><dd>{formatRF(result.payout)}</dd></div>
            <div><dt>Stake</dt><dd>{formatRF(result.value)}<span className="rb-launch-note">your baby</span></dd></div>
            <div className={cx("rb-launch-net", net > 0n ? "rb-up" : net < 0n && "rb-down")}><dt>Net</dt><dd>{signedRF(net)}<span className="rb-launch-sim" aria-hidden="true">Sim</span><span className="rb-sr-only"> (simulated)</span></dd></div>
          </dl>
          <p className="rb-launch-math">{stake} {mult} = {formatRF(result.payout)} (simulated). {HOME[result.zone](name)}</p>
          <p className="rb-launch-money"><span className="rb-long">Your {stake} trade-in is in your balance. {netLine}</span>
            <span className="rb-short">Balance +{stake} (trade-in). Slingshot net {signedRF(net)} (simulated).</span></p>
        </div>
        <div className="rb-launch-buttons">
          <button type="button" className="rb-button rb-button-primary rb-button-lg rb-launch-back" onClick={event => { if (event.detail !== 0 || settled()) onClose(); }} data-autofocus>
            <PixelIcon name="back" /><span><span className="rb-long">Back to the nursery</span><span className="rb-short">Nursery</span></span></button>
          {canLaunchAgain && <button type="button" className="rb-button rb-button-outline rb-button-lg" onClick={onLaunchAgain}>
            <PixelIcon name="slingshot" /><span>Launch another</span></button>}
        </div>
      </article>
    </div>}
  </div>;
}
