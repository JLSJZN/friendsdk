import { useState } from "react";
import type { Creature } from "../types.ts";
import { BabyCard } from "./BabyCard.tsx";
import { CollectionMeter } from "./Collection.tsx";
import type { Collection } from "./collection.ts";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { lineageLabel, tierLabel, tierVars, type TierInfo } from "./shared.ts";

export type BroodPanelProps = Readonly<{
  /** Kept babies, oldest first. */
  babies: readonly Creature[];
  /** Chance and Sanctuary value per tier (same rows as the settings odds table). */
  tiers: readonly TierInfo[];
  /** Resolves parent keys (baby.parents) to creatures for the detail card. */
  creature?: (key: string) => Creature | null;
  /** Open straight into one baby's details. */
  initialSelectedKey?: string | null;
  onRelease: (baby: Creature) => void;
  /** Detail view: open the Matchmaker with this baby as parent A. */
  onUseAsParent?: (baby: Creature) => void;
  /** Empty state call to action. */
  onFindMatch?: () => void;
  /** Omit while busy so the panel cannot be dismissed mid-action. */
  onClose?: () => void;
  /** Collection progress (families bred, tiers found), shown above the grid. */
  collection?: Collection;
  busy?: boolean;
  busyLabel?: string;
  error?: string;
  reducedMotion?: boolean;
}>;

/** Grid of kept babies; selecting one shows its BabyCard with the Sanctuary action. */
export function BroodPanel({ babies, tiers, creature, initialSelectedKey, onRelease, onUseAsParent, onFindMatch, onClose,
  collection, busy, busyLabel, error, reducedMotion }: BroodPanelProps) {
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey ?? null);
  const selected = babies.find(baby => baby.key === selectedKey) ?? null;
  const info = (baby: Creature) => tiers.find(row => row.tier === (baby.tier ?? "common"));

  if (selected) {
    const tier = info(selected);
    const back = <button type="button" className="rb-icon-button rb-panel-back" onClick={() => setSelectedKey(null)} disabled={busy}
      aria-label="Back to your brood"><PixelIcon name="back" /></button>;
    return <Panel eyebrow="Nursery" title={`Your brood · ${babies.length}`} onClose={busy ? undefined : onClose} headerStart={back} size="lg"
      focusKey={selected.key} className="rb-brood rb-brood-detail">
      <BabyCard baby={selected} mode="detail" chance={tier?.chance ?? "?"} value={tier?.value ?? "?"}
        parentA={selected.parents && creature ? creature(selected.parents[0]) : null}
        parentB={selected.parents && creature ? creature(selected.parents[1]) : null}
        onRelease={() => onRelease(selected)} onUseAsParent={onUseAsParent && (() => onUseAsParent(selected))}
        busy={busy} busyLabel={busyLabel} error={error} reducedMotion={reducedMotion} />
    </Panel>;
  }

  return <Panel eyebrow="Nursery" title={`Your brood · ${babies.length}`} onClose={busy ? undefined : onClose} size="lg"
    focusKey="grid" className="rb-brood">
    {collection && <CollectionMeter collection={collection} />}
    {babies.length === 0 ? <div className="rb-empty">
      <span className="rb-empty-art" aria-hidden="true"><PixelIcon name="eggBig" pixel={5} /></span>
      <p className="rb-empty-title">No babies yet</p>
      <p className="rb-muted">Find a match to hatch your first baby. Kept babies follow you around the nursery.</p>
      {onFindMatch && <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onFindMatch} data-autofocus>
        <PixelIcon name="heart" /><span>Find a match</span></button>}
    </div> : <>
      {error && <p className="rb-error" role="alert">{error}</p>}
      <ul className="rb-brood-grid">
        {babies.map(baby => <li key={baby.key}>
          <button type="button" className={`rb-brood-item rb-tier-${baby.tier ?? "common"}`} style={tierVars(baby.tier)} onClick={() => setSelectedKey(baby.key)}
            aria-label={`${baby.name}, ${tierLabel(baby.tier)}, ${lineageLabel(baby)}. Show details`}>
            <span className="rb-slot"><SpriteThumb creature={baby} scale={4} compactScale={2} reducedMotion={reducedMotion} label="" /></span>
            <span className="rb-brood-name">{baby.name}</span>
            <span className="rb-brood-meta">
              <span className="rb-tier-dot" aria-hidden="true" />{tierLabel(baby.tier)} · {lineageLabel(baby)}
            </span>
          </button>
        </li>)}
      </ul>
      <p className="rb-muted rb-small rb-brood-note">Tap a baby for its DNA card. The Sanctuary pays a fixed Simulated RF value for each tier.</p>
    </>}
  </Panel>;
}
