import { useId, useMemo, useRef, type CSSProperties } from "react";
import { FRAME_SIZE, type Creature, type Dna } from "../types.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, hashString, lineageLabel, pixelMetrics, tierLabel, tierVars, useCompact, useDevicePixelRatio, useReducedMotion } from "./shared.ts";

export type BabyCardProps = Readonly<{
  baby: Creature;
  /** Resolved parents (from baby.parents keys). Missing parents show as "Parent A" / "Parent B" with a placeholder. */
  parentA?: Creature | null;
  parentB?: Creature | null;
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
  busy?: boolean;
  /** Text for the Sanctuary button while busy. Default "Sending…". */
  busyLabel?: string;
  error?: string;
  reducedMotion?: boolean;
  className?: string;
}>;

const PARENT_A_FALLBACK = "Parent A", PARENT_B_FALLBACK = "Parent B";

function rowsOf(indices: readonly number[]) {
  return [...new Set(indices.map(index => Math.floor(index / FRAME_SIZE)))].filter(row => row >= 0 && row < FRAME_SIZE).sort((x, y) => x - y);
}

/**
 * Vertical DNA ribbon: one segment per sprite row, ink = parent A, green = parent B, violet pip = mutated.
 * `pixel` is the CSS size of one sprite pixel of the SpriteThumb it sits next to (pixelMetrics(scale, ratio).css).
 */
export function DnaRail({ dna, pixel, className }: { dna: Dna; pixel: number; className?: string }) {
  const mutated = new Set(rowsOf(dna.mutations));
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
      const distance = 70 + next() * 70;
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance * 0.8 - 20, delay: next() * 120, tone: index % 3 };
    });
  }, [seed]);
  return <span className="rb-confetti" aria-hidden="true">
    {bits.map((bit, index) => <i key={index} className={`rb-confetti-bit rb-tone-${bit.tone}`}
      style={{ "--dx": `${bit.x.toFixed(0)}px`, "--dy": `${bit.y.toFixed(0)}px`, animationDelay: `${bit.delay.toFixed(0)}ms` } as CSSProperties} />)}
  </span>;
}

/** The shareable result card: big animated baby, tier, lineage, parents, DNA ribbon, traits, value and actions. */
export function BabyCard({ baby, parentA, parentB, chance, value, mode = "reveal", onKeep, onRelease, onUseAsParent, discoveries,
  busy, busyLabel, error, reducedMotion, className }: BabyCardProps) {
  const id = useId();
  const node = useRef<HTMLElement>(null);
  const compact = useCompact(node);
  const reduced = useReducedMotion(reducedMotion);
  const tier = baby.tier ?? "common";
  const dna = baby.dna;
  const heroScale = compact ? 4 : 8;
  const heroPixel = pixelMetrics(heroScale, useDevicePixelRatio()).css;
  const fromA = dna ? dna.rowSource.filter(source => source === 0).length : 0;
  const fromB = dna ? FRAME_SIZE - fromA : 0;
  const mutatedRows = dna ? rowsOf(dna.mutations) : [];
  const traits = dna?.traits ?? [];
  const nameA = parentA?.name ?? PARENT_A_FALLBACK, nameB = parentB?.name ?? PARENT_B_FALLBACK;
  const dnaSummary = dna ? `DNA: ${fromA} of 16 rows from ${nameA}, ${fromB} from ${nameB}` +
    (mutatedRows.length ? `, ${mutatedRows.length} mutated.` : ".") : "";

  const releaseButton = onRelease && <button type="button" className="rb-button rb-button-outline rb-button-lg rb-release"
    onClick={onRelease} disabled={busy} aria-busy={busy || undefined}>
    {busy ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="sprout" />}
    <span>{busy ? busyLabel ?? "Sending…" : <><span className="rb-long">Send to Sanctuary · </span><span className="rb-short">Sanctuary </span><strong>+{value}</strong></>}</span>
  </button>;

  return <article ref={node} className={cx("rb-card", `rb-card-${mode}`, `rb-tier-${tier}`, !reduced && "rb-animate", className)}
    style={tierVars(tier)} aria-labelledby={`${id}-name`} aria-describedby={dna ? `${id}-dna` : undefined}>
    <div className="rb-card-surface">
      <div className="rb-card-scroll">
        <div className="rb-card-top">
          <div className="rb-card-hero">
            <span className="rb-card-floor" aria-hidden="true" />
            {dna && <DnaRail dna={dna} pixel={heroPixel} />}
            <SpriteThumb creature={baby} scale={heroScale} reducedMotion={reduced} label={`${baby.name}, ${tierLabel(tier)} baby`} className="rb-card-sprite" />
            {mode === "reveal" && !reduced && <Confetti seed={baby.key} />}
          </div>
          <header className="rb-card-head">
            <p className="rb-eyebrow">{mode === "reveal" ? "It hatched!" : "In your brood"}</p>
            <h2 className="rb-card-name" id={`${id}-name`}>{baby.name}</h2>
            <p className="rb-card-badges">
              <span className="rb-tier-badge"><PixelIcon name="sparkle" />{tierLabel(tier)}</span>
              <span className="rb-lineage" title="Generation">{lineageLabel(baby)}</span>
            </p>
            <p className="rb-card-family">{baby.family}</p>
            {discoveries && discoveries.length > 0 && <ul className="rb-card-news" aria-label="New in your collection">
              {discoveries.map(line => <li key={line}><PixelIcon name="sparkle" /><span>{line}</span></li>)}
            </ul>}
          </header>
        </div>

        {dna && <section className="rb-card-dna" aria-labelledby={`${id}-dna-title`}>
          <h3 className="rb-section-label" id={`${id}-dna-title`}><PixelIcon name="dna" />DNA · 16 pixel rows</h3>
          <p className="rb-sr-only" id={`${id}-dna`}>{dnaSummary}</p>
          <ul className="rb-dna-legend" aria-hidden="true">
            {([[parentA, nameA, fromA, "a", "Parent A"], [parentB, nameB, fromB, "b", "Parent B"]] as const).map(([parent, name, rows, side, role]) =>
              <li key={side} className="rb-dna-parent">
                <span className={`rb-dna-swatch rb-dna-${side}`} />
                <span className="rb-slot rb-slot-mini">{parent ? <SpriteThumb creature={parent} scale={2} reducedMotion={reduced} label="" /> : <PixelIcon name="help" />}</span>
                <span className="rb-dna-parent-text"><strong>{name}</strong><span>{role}</span></span>
                <span className="rb-dna-count"><strong>{rows}</strong> {rows === 1 ? "row" : "rows"}</span>
              </li>)}
          </ul>
          {mutatedRows.length > 0 && <p className="rb-dna-mut-note"><span className="rb-dna-pip" aria-hidden="true" />
            {mutatedRows.length === 1 ? `Row ${mutatedRows[0] + 1} mutated` : `Rows ${mutatedRows.map(row => row + 1).join(", ")} mutated`}</p>}
        </section>}

        <section className="rb-card-traits" aria-label="Traits">
          {traits.length ? <ul className="rb-chips">{traits.map(trait => <li key={trait} className="rb-chip"><PixelIcon name="sparkle" />{trait}</li>)}</ul>
            : <p className="rb-muted rb-small">No mutations. A timeless classic.</p>}
        </section>

        <div className="rb-card-stats">
          <dl>
            <div><dt>Chance</dt><dd>{chance}</dd></div>
            <div><dt>Sanctuary</dt><dd>{value}</dd></div>
          </dl>
          <p className="rb-card-stats-note">{tierLabel(tier)} eggs hatch {chance} of the time. Values in Simulated RF.</p>
        </div>
      </div>

      <footer className="rb-card-actions">
        {error && <p className="rb-error rb-card-error" role="alert">{error}</p>}
        <div className="rb-card-buttons">
          {mode === "reveal" && onKeep && <button type="button" className="rb-button rb-button-primary rb-button-lg rb-keep" onClick={onKeep}
            disabled={busy} data-autofocus><PixelIcon name="heart" /><span>Keep</span></button>}
          {mode === "detail" && onUseAsParent && <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onUseAsParent}
            disabled={busy} data-autofocus><PixelIcon name="heart" /><span><span className="rb-long">Breed with {baby.name}</span><span className="rb-short">Breed</span></span></button>}
          {releaseButton}
        </div>
        <p className="rb-card-fine rb-muted">{mode === "reveal" ? "Kept babies follow you and can breed again. " : "Kept babies can breed again. "}The Sanctuary value is fixed and never expires.</p>
      </footer>
    </div>
  </article>;
}
