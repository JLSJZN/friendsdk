import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type Ref } from "react";
import type { LaunchSequence } from "../api.ts";
import { formatRF } from "../economy.ts";
import { MOON_HUNDREDTHS, exitPayout, flightHundredths, multiplierLabel, type FlightEnd, type LaunchResult } from "../slingshot.ts";
import type { Creature } from "../types.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { signedRF } from "./SlingshotPanel.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, hashString, tierLabel, useModalFocus, useReducedMotion } from "./shared.ts";

export type LaunchOverlayProps = Readonly<{
  /**
   * Receives the flight canvas. Pass it to createLaunchSequence({ canvas, ... }).
   * A callback ref (e.g. a useState setter) tells you exactly when the canvas exists.
   */
  canvasRef: Ref<HTMLCanvasElement>;
  /** The flight scene on that canvas, once it exists. The overlay drives it (ignite, fly, end); it only draws. */
  sequence: LaunchSequence | null;
  /** The launched baby. Keep your own copy: it has already left the brood. */
  baby: Creature;
  /** Its Sanctuary value: the stake, already traded in. */
  value: bigint;
  /** The runtime paused the game: a rocket in the air jumps at once, and a new one cannot be lit. */
  paused?: boolean;
  /** Ignition: draws the crash point now, once (useSlingshot().ignite). Null: this flight cannot start. */
  onIgnite: () => number | null;
  /** The flight is decided: the jump in hundredths, or null when the rocket ended it. Books it (useSlingshot().settle). */
  onSettle: (exit: number | null) => LaunchResult | null;
  /** The result card is up (the HUD may count the launch now). */
  onLanded?: (result: LaunchResult) => void;
  /** Leave before lighting the rocket: no flight, the trade-in stands and nothing else is booked. */
  onCancel: () => void;
  /** Babies remain in the brood: shows "Launch another". */
  canLaunchAgain: boolean;
  /** The session's highest exit in hundredths (useSlingshot().ledger.topExit), for "Best so far" on the result card. */
  bestExit?: number;
  /** Usually reopens the Moon Slingshot panel. */
  onLaunchAgain: () => void;
  /** "Back to the nursery", and Escape on the result card. */
  onClose: () => void;
  reducedMotion?: boolean;
}>;

type Phase = "ready" | "flying" | "ending" | "result";
type Via = "pointer" | "key" | "click";

/** Where the baby lives now: the launch is final, even in the pond. */
const HOME: Readonly<Record<FlightEnd, (name: string) => string>> = {
  fizzle: name => `${name} paddles with the ducks now.`,
  crash: name => `${name} paddles with the ducks now.`,
  jump: name => `${name} naps in the hay now.`,
  moon: name => `${name} lives on the Moon now.`,
};
const TITLE: Readonly<Record<FlightEnd, (result: LaunchResult) => string>> = {
  fizzle: () => "Pfff! Into the pond",
  crash: () => "Splash! Into the pond",
  jump: result => `Jumped at ${multiplierLabel(result.exit ?? 0, true)}`,
  moon: () => "The Moon!",
};
/** The crash point, revealed. "Fizzle" only ever means the x0 failure on the pad. */
function crashLine(result: LaunchResult) {
  const at = multiplierLabel(result.crash, true);
  if (result.end === "fizzle") return "The rocket fizzled on the pad.";
  if (result.end === "crash") return `The rocket gave out at ${at}, before the jump.`;
  if (result.end === "moon") return "Your rocket was good for the Moon: auto jump at x10.";
  return result.crash >= MOON_HUNDREDTHS ? "Your rocket was good for the Moon." : `Your rocket would have given out at ${at}.`;
}
/** The record to chase: "New record: x5.23!" or "Best so far: x5.23", or nothing before the first jump. */
function recordLine(result: LaunchResult, best: number) {
  if (result.record && result.exit !== null) return `New record: ${multiplierLabel(result.exit, true)}!`;
  return best > 0 ? `Best so far: ${multiplierLabel(best, true)}` : "";
}

/**
 * After the landing, keyboard closing (Escape, Enter or Space on the focused button) waits this long, so a double
 * press meant for Skip does not also close the card. Clicks and taps act at once.
 */
const SETTLE_MS = 400;
/** A click this soon after a pointer or key press belongs to that press (not a separate assistive-tech activation). */
const CLICK_GRACE_MS = 500;

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
 * The Moon Slingshot flight, like the casino game Crash: the baby waits strapped to its rocket; pressing lights it
 * (the crash point is drawn at that moment), holding climbs, letting go jumps. Pointer, touch, Space or Enter hold;
 * Skip, Escape or a second plain click (assistive tech) also jump. Then the result card: payout, stake, net, where
 * the money went and the revealed crash point.
 */
export function LaunchOverlay({ canvasRef, sequence, baby, value, paused, onIgnite, onSettle, onLanded, onCancel, canLaunchAgain, bestExit = 0, onLaunchAgain,
  onClose, reducedMotion }: LaunchOverlayProps) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null), counter = useRef<HTMLSpanElement>(null), live = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion(reducedMotion);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [said, setSaid] = useState("");
  // The rocket would not light (onIgnite returned null): the hold button says so instead of doing nothing.
  const [stuck, setStuck] = useState(false);
  // `key`: the Space or Enter held on the hold button, until its keyup.
  const flight = useRef({ phase: "ready" as Phase, via: null as Via | null, key: null as string | null, start: 0, crash: 0, raf: 0, shown: 0, pressedAt: -Infinity, landedAt: 0 });
  // A key held down through the end of the flight (the rocket gave out or reached the Moon) must not press Skip or close
  // the card: its auto-repeat and its release are swallowed until a real keyup.
  const held = useRef(false);
  const props = useRef({ sequence, onIgnite, onSettle, onLanded });
  props.current = { sequence, onIgnite, onSettle, onLanded };
  const name = baby.name;
  const stake = formatRF(value);

  const go = (next: Phase) => { flight.current.phase = next; setPhase(next); };
  /** The live multiplier and payout, written straight into the DOM every frame (no re-render). */
  const paint = (hundredths: number, text = multiplierLabel(hundredths, true)) => {
    if (counter.current) counter.current.textContent = text;
    if (live.current) live.current.textContent = formatRF(exitPayout(value, hundredths));
  };

  function tick(now: number) {
    const f = flight.current;
    if (f.phase !== "flying") return;
    const ms = now - f.start, hundredths = flightHundredths(ms);
    // The rocket gives out above its crash point; a rocket good for the Moon jumps there by itself at x10.
    if (hundredths > f.crash || hundredths >= MOON_HUNDREDTHS) { finish(null); return; }
    props.current.sequence?.fly(ms);
    if (hundredths !== f.shown) {
      for (const mark of [200, 400]) if (f.shown < mark && hundredths >= mark) setSaid(`${multiplierLabel(mark)} reached. ${name} is still climbing.`);
      f.shown = hundredths;
      paint(hundredths);
    }
    f.raf = requestAnimationFrame(tick);
  }

  function ignite(via: Via) {
    const f = flight.current;
    if (f.phase !== "ready" || paused || stuck) return;
    const crash = props.current.onIgnite();
    if (crash === null) {
      setStuck(true);
      setSaid(`The rocket won't light right now. Don't fly keeps ${name} a plain trade-in.`);
      return;
    }
    Object.assign(f, { via, crash, start: performance.now(), shown: 100, pressedAt: performance.now() });
    go("flying");
    paint(100);
    props.current.sequence?.ignite();
    setSaid(`Lift-off! ${name} is flying at x1.00. Let go to jump.`);
    f.raf = requestAnimationFrame(tick);
  }

  /**
   * Let go: jump at the multiplier showing at `at` (if the rocket has not given out already). Input events pass their own
   * timeStamp, so a slow frame between the release and this handler cannot book more than was showing.
   */
  function jump(at = performance.now()) {
    const f = flight.current;
    if (f.phase !== "flying") return;
    const now = performance.now();
    f.pressedAt = now;
    finish(flightHundredths(Math.max(f.start, Math.min(at, now)) - f.start));
  }

  function finish(exit: number | null) {
    const f = flight.current;
    cancelAnimationFrame(f.raf);
    held.current = f.via === "key" && f.key !== null && document.hasFocus();
    f.via = null;
    f.phase = "ending";
    const booked = props.current.onSettle(exit);
    // Nothing in the air to book (cannot happen after a lit rocket): leave, the trade-in stands.
    if (!booked) { onCancel(); return; }
    go("ending");
    setResult(booked);
    const pond = booked.end === "fizzle" || booked.end === "crash";
    paint(booked.exit ?? 0, pond ? (booked.end === "fizzle" ? "x0" : multiplierLabel(booked.crash, true)) : multiplierLabel(booked.exit ?? 0, true));
    setSaid(booked.end === "jump" ? `${name} jumped at ${multiplierLabel(booked.exit ?? 0, true)}: ${formatRF(booked.payout)}.`
      : booked.end === "moon" ? `The Moon! ${name} jumped at x10: ${formatRF(booked.payout)}.`
      : booked.end === "fizzle" ? `Pfff. The rocket fizzled on the pad and ${name} plopped into the pond.`
      : `The rocket gave out at ${multiplierLabel(booked.crash, true)}. ${name} plopped into the pond.`);
    const sequence = props.current.sequence;
    void (sequence ? sequence.end(booked.end, booked.exit) : Promise.resolve()).then(() => land(booked));
  }

  function land(booked: LaunchResult) {
    const f = flight.current;
    if (f.phase !== "ending") return;
    f.landedAt = performance.now();
    go("result");
    props.current.onLanded?.(booked);
  }

  function skip() {
    const f = flight.current;
    if (f.phase === "flying") jump();
    else if (f.phase === "ending") { if (props.current.sequence) props.current.sequence.skip(); else if (result) land(result); }
  }

  // The counter starts at x1 with the stake; after that paint() owns its text (React never renders into it).
  useLayoutEffect(() => paint(100), []);
  // The runtime paused (menu, confirmation) or the tab went away mid-flight: jump at once.
  useEffect(() => { if (paused) jump(); }, [paused]);
  useEffect(() => {
    const away = () => { if (document.visibilityState === "hidden") jump(); };
    // A key's release goes elsewhere once the window loses focus: stop waiting for it.
    const blur = () => { held.current = false; flight.current.key = null; jump(); };
    document.addEventListener("visibilitychange", away);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("blur", blur);
      const f = flight.current;
      cancelAnimationFrame(f.raf);
      // Unmounted mid-air (the game frame went away): book the jump at the multiplier showing, like a pause, so the side
      // ledger never keeps a lit rocket that would block the next launch.
      if (f.phase === "flying") { f.phase = "ending"; props.current.onSettle(flightHundredths(performance.now() - f.start)); }
    };
  }, []);

  const settled = () => performance.now() - flight.current.landedAt >= SETTLE_MS;
  useModalFocus(node, () => {
    const current = flight.current.phase;
    if (current === "ready") onCancel();
    else if (current === "result") { if (settled()) onClose(); }
    else skip();
  }, stuck ? "stuck" : phase);

  const isKey = (key: string) => key === " " || key === "Enter";
  /** While a key is held from the flight, Space and Enter do nothing (Enter would click on every repeat, Space on release). */
  const swallow = {
    onKeyDownCapture: (event: KeyboardEvent) => { if (held.current && isKey(event.key)) event.preventDefault(); },
    onKeyUpCapture: (event: KeyboardEvent) => { if (held.current && isKey(event.key)) { event.preventDefault(); held.current = false; } },
  };
  const letGo = (event: PointerEvent<HTMLButtonElement>) => { if (flight.current.via === "pointer") jump(event.timeStamp); };
  const holdHandlers = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      ignite("pointer");
    },
    onPointerUp: letGo,
    // The system took the touch (scroll, gesture, call): that is a let-go too.
    onPointerCancel: letGo,
    onLostPointerCapture: letGo,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isKey(event.key)) return;
      event.preventDefault();
      if (event.repeat) return;
      flight.current.key = event.key;
      ignite("key");
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isKey(event.key)) return;
      event.preventDefault();
      flight.current.key = null;
      if (flight.current.via === "key") jump(event.timeStamp);
    },
    onBlur: () => { if (flight.current.via === "key") jump(); },
    // Assistive tech may activate with a bare click (no pointer or key events): the first lights the rocket, the next jumps.
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail !== 0 || performance.now() - flight.current.pressedAt < CLICK_GRACE_MS) return;
      if (flight.current.phase === "ready") ignite("click"); else jump();
    },
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
  };

  const flying = phase === "flying";
  const aloft = phase === "ready" || flying;
  const ended = result && phase !== "ready" && phase !== "flying" ? result : null;
  const net = ended ? ended.payout - ended.value : 0n;
  const pond = ended?.end === "fizzle" || ended?.end === "crash";
  const mult = ended ? (pond ? "x0" : multiplierLabel(ended.exit ?? 0)) : "";
  const cheer = ended && (ended.end === "moon" || (ended.exit ?? 0) >= 400);
  // Where the money went: the trade-in is already in the balance, the flight only moves the simulated Slingshot net.
  const netLine = net > 0n ? `${signedRF(net)} goes to your Slingshot net (simulated, not spendable in this preview).`
    : net < 0n ? `${signedRF(net)} comes off your Slingshot net (simulated).` : "Your Slingshot net stays the same (simulated).";
  const record = ended ? recordLine(ended, bestExit) : "";
  const label = phase === "ready" ? `${name} is strapped to a rocket` : flying ? `${name} is flying` : phase === "ending" ? `${name}'s flight is over` : undefined;

  return <div ref={node} className={cx("rb-hatch rb-launch", !reduced && "rb-animate", aloft && "rb-launch-aloft")} data-stage={phase} role="dialog" aria-modal="true"
    aria-label={label} aria-labelledby={label ? undefined : `${id}-title`} tabIndex={-1} {...swallow}>
    <canvas ref={canvasRef} className="rb-hatch-canvas" aria-hidden="true" />
    <p className="rb-sr-only" role="status" aria-live="polite">{phase === "result" && ended
      ? `${name}: ${TITLE[ended.end](ended).replace(/[^.!?]$/, "$&.")} Payout ${formatRF(ended.payout)}. ${crashLine(ended)}${ended.record ? ` ${record}` : ""} Your ${stake} trade-in is in your balance. Slingshot net ${signedRF(net)}, simulated.`
      : said}</p>

    {phase !== "result" && <div className={cx("rb-flight-meter", phase === "ready" && "rb-idle", ended && (pond ? "rb-down" : "rb-up"))} aria-hidden="true">
      <span ref={counter} className="rb-flight-mult" />
      <span className="rb-flight-pay"><span ref={live} /><span className="rb-flight-sim">Sim</span></span>
      <span className="rb-flight-hint">{phase === "ready" ? stuck ? "This rocket won't light right now." : paused ? "The game is paused." : <>Hold to fly, let go to jump<span className="rb-long"> (Space or Enter works too)</span>. Up to x10, or the pond.</>
        : flying ? "if you jump now" : ended?.end === "jump" || ended?.end === "moon" ? "Jumped!" : "The rocket gave out"}</span>
    </div>}

    {phase === "ready" && <div className="rb-flight-cancel">
      <button type="button" className="rb-button rb-button-dark" onClick={onCancel} aria-describedby={`${id}-stay`} data-autofocus={stuck || undefined}><span>Don't fly</span><PixelIcon name="close" /></button>
      <p id={`${id}-stay`}>{name} stays a plain trade-in: +{stake}, no flight.</p>
    </div>}
    {phase === "ready" && <p className="rb-flight-stay" aria-hidden="true">Don't fly: {name} stays a plain trade-in (+{stake}).</p>}
    {(flying || phase === "ending") && <button type="button" className="rb-button rb-button-dark rb-hatch-skip" onClick={skip}
      aria-label={flying ? "Skip: jump now" : "Skip to the result"} data-autofocus={phase === "ending" || undefined}>
      <span>Skip</span><PixelIcon name="back" className="rb-flip" />
    </button>}

    {aloft && <div className="rb-flight-controls">
      {/* aria-disabled, not disabled: a paused (or unlit) hold button keeps focus, so Space never lands on Don't fly. */}
      <button type="button" className={cx("rb-button rb-button-primary rb-flight-hold", flying && "rb-holding")} aria-disabled={(!flying && (paused || stuck)) || undefined}
        aria-describedby={`${id}-how`} data-autofocus={!stuck || undefined} {...holdHandlers}>
        <PixelIcon name="rocket" pixel={3} />
        <span className="rb-flight-hold-text">{flying ? "Let go to jump!" : "Hold to fly"}</span>
      </button>
      <p className="rb-sr-only" id={`${id}-how`}>Press and hold this button, or hold Space or Enter, to fly. Let go to jump with the payout shown.
        Skip and Escape also jump. At x10 {name} jumps onto the Moon by itself; if the rocket gives out first, it lands in the pond.</p>
    </div>}

    {phase === "result" && ended && <div className="rb-hatch-result">
      {cheer && !reduced && <Confetti seed={`${ended.babyKey}:${ended.roll}`} />}
      <article className={cx("rb-launch-card", `rb-end-${pond ? "pond" : ended.end}`, !reduced && "rb-animate")} aria-labelledby={`${id}-title`}>
        <div className="rb-launch-top">
          <span className="rb-slot rb-launch-baby"><SpriteThumb creature={baby} scale={4} compactScale={2} label={`${name}, ${tierLabel(baby.tier)} baby`} reducedMotion={reduced} /></span>
          <div className="rb-launch-head">
            <p className="rb-eyebrow">{name}'s flight</p>
            <h2 className="rb-launch-zone" id={`${id}-title`}>{TITLE[ended.end](ended)}</h2>
            <p className="rb-launch-line">{crashLine(ended)}</p>
            {record && <p className={cx("rb-launch-record", ended.record && "rb-new")}>{ended.record && <PixelIcon name="sparkle" />}{record}</p>}
          </div>
          <span className="rb-launch-stamp" aria-hidden="true">{mult}</span>
        </div>
        <div className="rb-launch-payout">
          <dl className="rb-launch-sums">
            <div><dt>Payout</dt><dd>{formatRF(ended.payout)}</dd></div>
            <div><dt>Stake</dt><dd>{stake}<span className="rb-launch-note">your baby</span></dd></div>
            <div className={cx("rb-launch-net", net > 0n ? "rb-up" : net < 0n && "rb-down")}><dt>Net</dt><dd>{signedRF(net)}<span className="rb-launch-sim" aria-hidden="true">Sim</span><span className="rb-sr-only"> (simulated)</span></dd></div>
          </dl>
          <p className="rb-launch-math">{stake} {mult} = {formatRF(ended.payout)} (simulated). {HOME[ended.end](name)}</p>
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
