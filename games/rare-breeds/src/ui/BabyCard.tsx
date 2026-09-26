import { useId, useMemo, useRef, type CSSProperties } from "react";
import { familyLine, type CreatureLookup } from "../legacy.ts";
import { FRAME_SIZE, type Creature, type Dna } from "../types.ts";
import { DnaTrio, mutatedRows } from "./DnaTrio.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, hashString, lineageLabel, tierLabel, tierVars, useCompact, useReducedMotion } from "./shared.ts";

export type BabyCardProps = Readonly<{
  baby: Creature;
  /** Resolved parents (from baby.parents keys). Missing parents show as "Parent A" / "Parent B" with a placeholder. */
  parentA?: Creature | null;
  parentB?: Creature | null;
  /**
   * Resolves ancestor keys (e.g. the controller's `creature`). From F2 on the card then lists the baby's whole
   * family line (familyLine in src/legacy.ts) as chips under its two-name family label.
   */
  creature?: CreatureLookup;
  /** Preformatted chance of this baby's tier, e.g. "12%". */
  chance: string;
  /** Preformatted fixed Sanctuary value, e.g. "3 RF". */
  value: string;
  /** "reveal" right after hatching (Keep / Sanctuary), "detail" inside the brood. Default "reveal". */
  mode?: "reveal" | "detail";
  onKeep?: () => void;
  /** Send to the Sanctuary (redeem). Omit to hide the button. */
  onRelease?: () => void;
  /** Detail mode: breed again with this baby as parent A. */
  onUseAsParent?: () => void;
  /** Reveal mode: what this baby added to the collection, e.g. ["New family: Hollow · 3/9"] (see discoveriesOf). */
  discoveries?: readonly string[];
  /**
   * First-run line above the buttons explaining the choice. Only shown when `heartsPerMinute` is omitted:
   * with it, the card writes its own Keep vs trade-in line ("Keep: +5 Hearts now, 12 Hearts/min. ...").
   */
  hint?: string;
  /** Hearts this baby earns per minute while kept (game points, never RF). Shown next to the Sanctuary value. */
  heartsPerMinute?: number;
  /** Reveal mode: one-off Hearts for keeping it, shown on the Keep button. */
  keepBonus?: number;
  busy?: boolean;
  /** Text for the Sanctuary button while busy. Default "Trading in…". */
  busyLabel?: string;
  error?: string;
  reducedMotion?: boolean;
  className?: string;
}>;

/**
 * Vertical DNA ribbon: one segment per sprite row, ink = parent A, green = parent B, violet pip = mutated.
 * `pixel` is the CSS size of one sprite pixel of the SpriteThumb it sits next to (pixelMetrics(scale, ratio).css).
 * Used by the intro tour; the result card shows the full DnaTrio instead.
 */
export function DnaRail({ dna, pixel, className }: { dna: Dna; pixel: number; className?: string }) {
  const mutated = new Set(mutatedRows(dna.mutations));
  return <span className={cx("rb-dna-rail", className)} style={{ "--rb-px": `${pixel}px` } as CSSProperties} aria-hidden="true">
    {Array.from({ length: FRAME_SIZE }, (_, row) => <span key={row}
      className={cx("rb-dna-seg", dna.rowSource[row] === 1 ? "rb-dna-b" : "rb-dna-a", mutated.has(row) && "rb-dna-mut")} />)}
  </span>;
}

function Confetti({ seed }: { seed: string }) {
  const bits = useMemo(() => {
    let hash = hashString(seed);
    const next = () => { hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0; return hash / 4294967296; };
    return Array.from({ length: 18 }, (_, index) => {
      const angle = (index / 18) * Math.PI * 2 + next() * 0.5;
      const distance = 60 + next() * 70;
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance * 0.8 - 20, delay: next() * 120, tone: index % 3 };
    });
  }, [seed]);
  return <span className="rb-confetti" aria-hidden="true">
    {bits.map((bit, index) => <i key={index} className={`rb-confetti-bit rb-tone-${bit.tone}`}
      style={{ "--dx": `${bit.x.toFixed(0)}px`, "--dy": `${bit.y.toFixed(0)}px`, animationDelay: `${bit.delay.toFixed(0)}ms` } as CSSProperties} />)}
  </span>;
}

/**
 * The shareable result card: the baby between its two parents on one 16 row grid (every row traced to the
 * parent it came from), tier, lineage, traits, chance / value / Hearts, and the Keep vs trade-in choice.
 */
export function BabyCard({ baby, parentA, parentB, creature, chance, value, mode = "reveal", onKeep, onRelease, onUseAsParent, discoveries, hint, heartsPerMinute, keepBonus,
  busy, busyLabel, error, reducedMotion, className }: BabyCardProps) {
  const id = useId();
  const node = useRef<HTMLElement>(null);
  const compact = useCompact(node);
  const reduced = useReducedMotion(reducedMotion);
  const tier = baby.tier ?? "common";
  const dna = baby.dna;
  const traits = dna?.traits ?? [];
  const reveal = mode === "reveal";
  const hasRate = heartsPerMinute !== undefined;
  const line = useMemo(() => {
    if (!creature) return [];
    const known = new Map([parentA, parentB].filter((parent): parent is Creature => !!parent).map(parent => [parent.key, parent]));
    return familyLine(baby, key => known.get(key) ?? creature(key));
  }, [baby, parentA, parentB, creature]);

  const keepParts = [keepBonus ? `+${keepBonus} Hearts now` : "", hasRate ? `${heartsPerMinute} Hearts/min` : ""].filter(Boolean);
  const choice = !hasRate ? null : reveal
    ? <><strong>Keep:</strong> {keepParts.join(", ")}. <span className="rb-choice-long">You can still trade it in later for <strong>{value}</strong>.</span>
      <span className="rb-choice-short">Trade in later for <strong>{value}</strong>.</span></>
    : <><strong>Kept:</strong> earns {heartsPerMinute} Hearts/min and can breed again. <span className="rb-choice-long">Trade it in any time for <strong>{value}</strong>.</span>
      <span className="rb-choice-short">Trade in for <strong>{value}</strong>.</span></>;

  const releaseButton = onRelease && <button type="button" className="rb-button rb-button-outline rb-button-lg rb-release"
    onClick={onRelease} disabled={busy} aria-busy={busy || undefined}>
    {busy ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="sprout" />}
    <span>{busy ? busyLabel ?? "Trading in…" : <><span className="rb-long">Trade in at the Sanctuary · </span><span className="rb-short">Sanctuary </span><strong>+{value}</strong></>}</span>
  </button>;

  return <article ref={node} className={cx("rb-card", "rb-card-v2", `rb-card-${mode}`, `rb-tier-${tier}`, !reduced && "rb-animate", className)}
    style={tierVars(tier)} aria-labelledby={`${id}-name`}>
    <div className="rb-card-surface">
      <div className="rb-card-scroll">
        <header className="rb-card-head">
          <p className="rb-eyebrow">{reveal ? "It hatched!" : "In your brood"}</p>
          <div className="rb-card-titlebar">
            <h2 className="rb-card-name" id={`${id}-name`}>{baby.name}</h2>
            <p className="rb-card-badges">
              <span className="rb-tier-badge"><PixelIcon name="sparkle" />{tierLabel(tier)}</span>
              <span className="rb-lineage" title="Generation">{lineageLabel(baby)}</span>
              <span className="rb-card-family">{baby.family}</span>
            </p>
          </div>
          {line.length > 2 && <ul className="rb-card-line" aria-label={`Family line: ${line.join(", ")}`}>
            {line.map(name => <li key={name}>{name}</li>)}
          </ul>}
          {discoveries && discoveries.length > 0 && <ul className="rb-card-news" aria-label="New in your collection">
            {discoveries.map(line => <li key={line}><PixelIcon name="sparkle" /><span>{line}</span></li>)}
          </ul>}
        </header>

        {dna ? <DnaTrio baby={baby} parentA={parentA} parentB={parentB} reveal={reveal} reducedMotion={reduced}
          maxScale={reveal ? 8 : 6} babyExtra={reveal && !reduced ? <Confetti seed={baby.key} /> : null} />
          : <div className="rb-card-hero"><SpriteThumb creature={baby} scale={compact ? 4 : 7} clip="walk" reducedMotion={reduced}
            label={`${baby.name}, ${tierLabel(tier)} baby`} className="rb-card-sprite" /></div>}

        <div className="rb-card-facts">
          <section className="rb-card-traits" aria-label="Traits">
            {traits.length ? <ul className="rb-chips">{traits.map(trait => <li key={trait} className="rb-chip"><PixelIcon name="sparkle" />{trait}</li>)}</ul>
              : <p className="rb-muted rb-small">No mutations. A timeless classic.</p>}
          </section>
          <dl className={cx("rb-card-stats-row", hasRate && "rb-stats-3")}>
            <div><dt>Chance</dt><dd>{chance}</dd></div>
            <div><dt>Sanctuary</dt><dd>{value}</dd></div>
            {hasRate && <div className="rb-card-hearts">
              <dt>{reveal ? "If kept" : "Earning"}</dt>
              <dd><PixelIcon name="heart" />{heartsPerMinute}<span>/min</span></dd>
            </div>}
          </dl>
        </div>
        <p className="rb-card-stats-note">{tierLabel(tier)} eggs hatch {chance} of the time, whatever the parents.
          {hasRate ? " Values are simulated RF; Hearts are game points, not RF." : " Values are simulated RF."}</p>
      </div>

      <footer className="rb-card-actions">
        {error && <p className="rb-error rb-card-error" role="alert">{error}</p>}
        {!error && (choice ? <p className="rb-card-choice"><PixelIcon name="heart" /><span>{choice}</span></p>
          : hint ? <p className="rb-card-hint"><PixelIcon name="sparkle" /><span>{hint}</span></p> : null)}
        <div className="rb-card-buttons">
          {reveal && onKeep && <button type="button" className="rb-button rb-button-primary rb-button-lg rb-keep" onClick={onKeep}
            disabled={busy} data-autofocus><PixelIcon name="heart" /><span>Keep</span>
            {keepBonus ? <span className="rb-keep-bonus">+{keepBonus}<span className="rb-sr-only"> Hearts</span></span> : null}</button>}
          {!reveal && onUseAsParent && <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onUseAsParent}
            disabled={busy} data-autofocus><PixelIcon name="heart" /><span><span className="rb-long">Breed with {baby.name}</span><span className="rb-short">Breed</span></span></button>}
          {releaseButton}
        </div>
        {!choice && <p className="rb-card-fine rb-muted">{reveal ? "Keep: it follows your Friend and can breed again. " : "Kept babies can breed again. "}Sanctuary: trade it in for a fixed simulated RF value that never expires.</p>}
      </footer>
    </div>
  </article>;
}
