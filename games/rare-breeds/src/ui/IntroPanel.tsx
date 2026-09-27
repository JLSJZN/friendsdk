import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatChance } from "../economy.ts";
import { LAUNCH_ZONES, multiplierLabel } from "../slingshot.ts";
import type { Creature } from "../types.ts";
import { DnaRail } from "./BabyCard.tsx";
import { ALL_FAMILIES, familyOf } from "./collection.ts";
import { INTRO_TITLES, exampleBabies, singleParentDna } from "./intro.ts";
import { HudLegend, MULTIPLIER_RANGE, StationLegend, type HudSample } from "./Legend.tsx";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, pixelMetrics, tierLabel, tierVars, useDevicePixelRatio, useReducedMotion, useRootSize, type TierInfo } from "./shared.ts";

/** "x0 (the pond, 40%)" and "x10 (the Moon, 2%)" for the slingshot choice card. */
const zoneSummary = (index: number) => {
  const zone = LAUNCH_ZONES[index];
  return { label: multiplierLabel(zone.multiplierBps), chance: `(${zone.id === "moon" ? "the Moon" : `the ${zone.id}`}, ${formatChance(zone.chanceBps)})` };
};
const NEAREST = zoneSummary(0), FARTHEST = zoneSummary(LAUNCH_ZONES.length - 1);

export type IntroPanelProps = Readonly<{
  /** The player's verified Friend. */
  player: Creature;
  /** A real wild Friend used as the example mate (ideally from another family). */
  mate: Creature;
  /** Chance and fixed Sanctuary value per tier, in TIER_ORDER. */
  tiers: readonly TierInfo[];
  /** Preformatted egg price, e.g. "1 RF". */
  price: string;
  /** Preformatted simulated balance the session started with, e.g. "20 RF". */
  startBalance: string;
  /** Live HUD values for the "Your screen" legend. */
  hud: HudSample;
  /** Hearts a kept Common baby earns per minute (shown on the Keep card). */
  keepHeartsPerMinute: number;
  /** Skip, Escape or "Start breeding". */
  onClose: () => void;
  /** Called when the visible step changes (e.g. to play a sound). */
  onStepChange?: (step: number) => void;
  /** Start on another step (0-5), e.g. for screenshots. */
  initialStep?: number;
  reducedMotion?: boolean;
}>;

const TITLES = INTRO_TITLES;
const PARENT_A_DNA = singleParentDna(0), PARENT_B_DNA = singleParentDna(1);

/** Sprite scales per step for the current game area: big on desktop, still readable in a 360 x 240 frame. */
function scalesFor({ width, height }: { width: number; height: number }) {
  if (width >= 600 && height >= 560) return { hero: 9, pair: 6, row: 3, mini: 3 };
  if (width >= 600 && height >= 400) return { hero: 6, pair: 4, row: 2, mini: 2 };
  if (height >= 440) return { hero: height >= 560 ? 7 : 6, pair: width >= 380 ? 4 : 3, row: 2, mini: 3 };
  return { hero: 4, pair: 2, row: 2, mini: 2 };
}

/** A sprite with its 16-row DNA ribbon, drawn at one scale so ribbon rows line up with sprite rows. */
function Figure({ creature, dna, scale, clip = "walk", facing = "down", tag }: {
  creature: Creature; dna?: Creature["dna"]; scale: number; clip?: "idle" | "walk"; facing?: "down" | "left" | "right"; tag?: ReactNode;
}) {
  const pixel = pixelMetrics(scale, useDevicePixelRatio()).css;
  return <span className="rb-intro-figure">
    {dna && <DnaRail dna={dna} pixel={pixel} />}
    <SpriteThumb creature={creature} scale={scale} clip={clip} facing={facing} label="" />
    {tag}
  </span>;
}

/** One of the three things to do with a baby: title, a small scene with its payoff, one line. */
function Choice({ icon, title, value, scene, children }: { icon: "heart" | "sprout" | "moon"; title: string; value: ReactNode; scene: ReactNode; children: ReactNode }) {
  return <section className="rb-intro-choice rb-intro-option">
    <h3><PixelIcon name={icon} />{title}</h3>
    <span className="rb-intro-mini" aria-hidden="true">{scene}</span>
    <span className="rb-intro-value">{value}</span>
    <p>{children}</p>
  </section>;
}

/**
 * First-run tour in six short steps: what the game is (pixels are DNA), the nursery and its four stations on a
 * picture of the real room, how breeding works (the player's Friend and a real wild mate), the exact odds, what to do
 * with a baby (Keep, Sanctuary, Moon Slingshot) and what every HUD chip means, ending on the goal and the first action.
 * "Skip intro" on every step and Escape close it. Example babies are presentation only.
 */
export function IntroPanel({ player, mate, tiers, price, startBalance, hud, keepHeartsPerMinute, onClose, onStepChange, initialStep = 0, reducedMotion }: IntroPanelProps) {
  const [step, setStep] = useState(() => Math.max(0, Math.min(TITLES.length - 1, initialStep)));
  const node = useRef<HTMLDivElement>(null);
  const size = useRootSize(node);
  const scale = scalesFor(size);
  const reduced = useReducedMotion(reducedMotion);
  const examples = useMemo(() => exampleBabies(player, mate), [player, mate]);
  const example = examples.spotted;
  const last = step === TITLES.length - 1;
  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(TITLES.length - 1, next));
    if (clamped === step) return;
    setStep(clamped);
    onStepChange?.(clamped);
  };

  // Every step starts at its top, however far the previous one was scrolled (the panel body is shared).
  useLayoutEffect(() => { node.current?.parentElement?.scrollTo(0, 0); }, [step]);

  // Arrow keys page through the tour (the world behind is paused, so they never move the Friend).
  const keys = useRef({ step, go });
  keys.current = { step, go };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight") { event.preventDefault(); keys.current.go(keys.current.step + 1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); keys.current.go(keys.current.step - 1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const footer = <div className="rb-intro-foot">
    <ol className="rb-intro-dots" aria-label={`Step ${step + 1} of ${TITLES.length}`}>
      {TITLES.map((title, index) => <li key={title} className={cx(index === step && "rb-on", index < step && "rb-done")} aria-hidden="true" />)}
    </ol>
    <span className="rb-intro-count" aria-hidden="true">{step + 1}/{TITLES.length}</span>
    <div className="rb-intro-nav">
      {step > 0 && <button type="button" className="rb-button rb-button-ghost rb-button-lg rb-intro-back" onClick={() => go(step - 1)} aria-label="Back">
        <PixelIcon name="back" /><span>Back</span></button>}
      {last
        ? <button type="button" className="rb-button rb-button-primary rb-button-lg rb-intro-next" onClick={onClose} data-autofocus>
          <PixelIcon name="heart" /><span>Start breeding</span></button>
        : <button type="button" className="rb-button rb-button-primary rb-button-lg rb-intro-next" onClick={() => go(step + 1)} data-autofocus>
          <span>Next</span><PixelIcon name="back" className="rb-flip" /></button>}
    </div>
  </div>;

  const mateLabel = `${mate.name} · ${familyOf(mate)}`;
  const mutant = tiers.find(row => row.tier === "mutant");
  const steps: ReactNode[] = [
    // 1. What this is: pixels are DNA
    <>
      <figure className="rb-intro-stage rb-intro-hero">
        <Figure creature={player} dna={PARENT_A_DNA} scale={scale.hero} />
        <figcaption className="rb-intro-caption">
          <strong>{player.name}</strong>
          <span>{familyOf(player)} family · your Friend</span>
          <span className="rb-intro-chip"><PixelIcon name="dna" />16 rows × 16 = 256 pixels</span>
        </figcaption>
      </figure>
      <div className="rb-intro-copy">
        <p className="rb-intro-lead">Rare Breeds: pair your Friend with other Rare Friends and hatch one-of-a-kind babies.</p>
        <p>Every Rare Friend is 256 on-chain pixels. Here they are its DNA: each of its 16 rows is a gene it can pass on.</p>
      </div>
    </>,
    // 2. The nursery and its stations, on the real room
    <>
      <p className="rb-intro-lead">Four stations, one room.</p>
      <StationLegend player={player} price={price} />
    </>,
    // 3. Find a match, hatch an egg
    <>
      <figure className="rb-intro-stage rb-intro-pair">
        <span className="rb-intro-slot">
          <Figure creature={player} dna={PARENT_A_DNA} scale={scale.pair} facing="right" />
          <span className="rb-intro-name"><strong>Your Friend</strong><span>{player.name}</span><span>{familyOf(player)}</span></span>
        </span>
        <span className="rb-intro-op" aria-hidden="true"><PixelIcon name="heart" pixel={scale.pair >= 4 ? 3 : 2} /></span>
        <span className="rb-intro-slot">
          <Figure creature={mate} dna={PARENT_B_DNA} scale={scale.pair} facing="left" />
          <span className="rb-intro-name"><strong>Wild mate</strong><span>{mate.name}</span><span>{familyOf(mate)}</span></span>
        </span>
        <span className="rb-intro-op" aria-hidden="true"><PixelIcon name="egg" pixel={scale.pair >= 4 ? 3 : 2} /></span>
        <span className="rb-intro-slot rb-intro-baby">
          <Figure creature={example} dna={example.dna} scale={scale.pair} tag={<span className="rb-tag rb-intro-example">Example</span>} />
          <span className="rb-intro-name"><strong>Example baby</strong><span className="rb-intro-family">{example.family}</span></span>
        </span>
        <figcaption className="rb-sr-only">Your Friend {player.name} and the wild mate {mateLabel} make an example baby. Its DNA ribbon shows which rows came from each parent.</figcaption>
      </figure>
      <ul className="rb-intro-legend" aria-hidden="true">
        <li><span className="rb-dna-swatch rb-dna-a" />Rows from your Friend</li>
        <li><span className="rb-dna-swatch rb-dna-b" />Rows from the mate</li>
      </ul>
      <div className="rb-intro-copy">
        <p className="rb-intro-lead">Pick a mate from three real Rare Friends. New faces are free.</p>
        <p>Each breed uses one egg. The baby inherits whole pixel rows from both parents, walk cycle included, so every egg hatches a one-of-a-kind mix.</p>
        <p>Spend Hearts on a Wish to choose a mate's family.</p>
      </div>
    </>,
    // 4. Odds
    <>
      <table className="rb-intro-odds">
        <caption className="rb-sr-only">Hatch odds per egg</caption>
        <thead><tr><th scope="col">Tier</th><th scope="col">Chance</th><th scope="col">Sanctuary value</th></tr></thead>
        <tbody>{tiers.map(row => <tr key={row.tier} className={`rb-tier-${row.tier}`} style={tierVars(row.tier)}>
          <th scope="row">
            <span className="rb-slot rb-intro-thumb"><SpriteThumb creature={examples[row.tier]} scale={scale.row} label="" animate={row.tier === "prismatic"} /></span>
            <span className="rb-tier-badge rb-tier-badge-sm">{tierLabel(row.tier)}</span>
          </th>
          <td>{row.chance}</td>
          <td>{row.value}</td>
        </tr>)}</tbody>
      </table>
      <div className="rb-intro-copy">
        <p className="rb-intro-lead">Same odds for every pair. Parents only decide the look.</p>
        <p>An egg costs {price} and you start with {startBalance}. RF means $RAREFRIENDS, and here it is all simulated: no real money, no transactions, and a reload starts over.</p>
      </div>
    </>,
    // 5. What to do with a baby
    <>
      <p className="rb-intro-lead">After the hatch you pick Keep or Sanctuary. A kept baby can ride the Moon Slingshot later.</p>
      <div className="rb-intro-options">
        <Choice icon="heart" title="Keep" value={<><PixelIcon name="heart" />{keepHeartsPerMinute}/min</>} scene={<>
          <SpriteThumb creature={player} scale={scale.mini} clip="walk" facing="right" label="" />
          <SpriteThumb creature={examples.common} scale={Math.max(2, scale.mini - 1)} clip="walk" facing="right" label="" />
        </>}>It follows your Friend, earns Hearts and can breed again. Each generation counts up: F1, F2, F3...</Choice>
        <Choice icon="sprout" title="Sanctuary" value={`+${mutant?.value ?? "RF"}`} scene={<SpriteThumb creature={examples.mutant} scale={scale.mini} label="" />}>
          Trade it in for its tier's fixed value in simulated RF. Rarer pays more.</Choice>
        <Choice icon="moon" title="Moon Slingshot" value={MULTIPLIER_RANGE.replace(" to ", "-")} scene={<>
          <PixelIcon name="slingshotBig" pixel={scale.mini} className="rb-intro-fork" />
          <SpriteThumb creature={examples.spotted} scale={Math.max(2, scale.mini - 1)} clip="idle" label="" />
        </>}>Bet its value on the landing: {NEAREST.label} {NEAREST.chance} to {FARTHEST.label} {FARTHEST.chance}. Wins and losses go to a separate Slingshot net, not your balance. Gone either way.</Choice>
      </div>
    </>,
    // 6. The HUD, the goal and the first action
    <>
      <p className="rb-intro-lead">The bar at the top of the screen, part by part.</p>
      <HudLegend sample={hud} />
      <div className="rb-intro-goal">
        <p className="rb-intro-lead"><PixelIcon name="sparkle" />Goal: collect all {ALL_FAMILIES.length} families and all {tiers.length} tiers. Brood shows your set.</p>
        <p className="rb-intro-start">Start: tap <span className="rb-intro-cta"><PixelIcon name="heart" />Find a match</span><span className="rb-intro-start-more"> at the bottom, or walk to the Matchmaker</span>.</p>
      </div>
    </>,
  ];

  return <Panel eyebrow={`How it works · ${step + 1} of ${TITLES.length}`} title={TITLES[step]} onClose={onClose} closeLabel="Skip intro"
    dismissOnBackdrop={false} size="lg" focusKey={step} footer={footer} className="rb-intro">
    <div ref={node} key={step} className={cx("rb-intro-step", `rb-intro-step-${step + 1}`, !reduced && "rb-animate")}>{steps[step]}</div>
  </Panel>;
}
