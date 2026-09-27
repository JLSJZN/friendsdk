import { useId, useMemo, useState } from "react";
import { buildLegacy, type Legacy } from "../legacy.ts";
import type { Creature } from "../types.ts";
import { BabyCard } from "./BabyCard.tsx";
import { CollectionMeter } from "./Collection.tsx";
import type { Collection } from "./collection.ts";
import { FriendCard } from "./FriendCard.tsx";
import { LegacyTree } from "./LegacyTree.tsx";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, lineageLabel, tierLabel, tierVars, type TierInfo } from "./shared.ts";

export type BroodTab = "brood" | "legacy";

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
  /** Opened at the Sanctuary gate: explains trading a baby in. */
  sanctuary?: boolean;
  /** Hearts a kept baby earns per minute (game points, never RF). Shown per baby and as the brood total. */
  heartsRate?: (baby: Creature) => number;
  /** Opens the Hearts shop (hats and wish matches). */
  onOpenShop?: () => void;
  /** The player's Friend (dressed). Adds a "Legacy" tab: the Friend's card and a family tree of the brood. */
  friend?: Creature | null;
  /** Tab to open on. Default "brood". "legacy" needs `friend` (e.g. when the player taps their Friend). */
  initialTab?: BroodTab;
  /** Precomputed buildLegacy(friend, babies, creature) (src/legacy.ts); computed when omitted. */
  legacy?: Legacy;
  busy?: boolean;
  busyLabel?: string;
  error?: string;
  reducedMotion?: boolean;
}>;

/**
 * Grid of kept babies; selecting one shows its BabyCard with the Sanctuary action. With `friend`, a Legacy tab
 * shows the player's Friend (FriendCard) and a family tree rooted at it.
 */
export function BroodPanel({ babies, tiers, creature, initialSelectedKey, onRelease, onUseAsParent, onFindMatch, onClose,
  collection, sanctuary, heartsRate, onOpenShop, friend, initialTab = "brood", legacy, busy, busyLabel, error, reducedMotion }: BroodPanelProps) {
  const id = useId();
  const income = heartsRate ? babies.reduce((sum, baby) => sum + heartsRate(baby), 0) : 0;
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey ?? null);
  const [tab, setTab] = useState<BroodTab>(friend && initialTab === "legacy" ? "legacy" : "brood");
  const showLegacy = !!friend && tab === "legacy";
  const computed = useMemo(() => !showLegacy || !friend ? null : legacy ?? buildLegacy(friend, babies, creature ?? (() => null)),
    [showLegacy, legacy, friend, babies, creature]);
  const selected = babies.find(baby => baby.key === selectedKey) ?? null;
  const info = (baby: Creature) => tiers.find(row => row.tier === (baby.tier ?? "common"));

  if (selected) {
    const tier = info(selected);
    const back = <button type="button" className="rb-icon-button rb-panel-back" onClick={() => setSelectedKey(null)} disabled={busy}
      aria-label="Back to your brood"><PixelIcon name="back" /></button>;
    return <Panel eyebrow="Nursery" title={sanctuary ? "Sanctuary: pick a baby to trade in" : `Your brood · ${babies.length}`} onClose={busy ? undefined : onClose} headerStart={back} size="lg"
      focusKey={selected.key} className="rb-brood rb-brood-detail">
      <BabyCard baby={selected} mode="detail" chance={tier?.chance ?? "?"} value={tier?.value ?? "?"} creature={creature}
        parentA={selected.parents && creature ? creature(selected.parents[0]) : null}
        parentB={selected.parents && creature ? creature(selected.parents[1]) : null}
        onRelease={() => onRelease(selected)} onUseAsParent={onUseAsParent && (() => onUseAsParent(selected))}
        heartsPerMinute={heartsRate?.(selected)}
        busy={busy} busyLabel={busyLabel} error={error} reducedMotion={reducedMotion} />
    </Panel>;
  }

  const tabs = friend && <div className="rb-tabs rb-brood-tabs" role="tablist" aria-label="Brood and legacy">
    {([["brood", "Brood"], ["legacy", "Legacy"]] as const).map(([value, label]) => <button key={value} type="button" role="tab"
      id={`${id}-${value}`} aria-selected={tab === value} aria-controls={`${id}-${value}-panel`} className={cx("rb-tab", tab === value && "rb-on")}
      onClick={() => setTab(value)}>
      {value === "brood" ? <PixelIcon name="baby" /> : <PixelIcon name="dna" />}{label}
      {value === "brood" && <span className="rb-tab-count">{babies.length}</span>}
    </button>)}
  </div>;

  if (friend && showLegacy) return <Panel eyebrow="Your Friend" title={`${friend.name}'s legacy`} onClose={busy ? undefined : onClose} size="lg"
    focusKey="grid" className="rb-brood rb-brood-legacy">
    {tabs}
    <div className="rb-brood-pane" role="tabpanel" id={`${id}-legacy-panel`} aria-labelledby={`${id}-legacy`}>
      <FriendCard friend={friend} babies={babies} creature={creature} legacy={computed ?? undefined} onFindMatch={onFindMatch} reducedMotion={reducedMotion} />
      <section className="rb-legacy-tree" aria-labelledby={`${id}-tree`}>
        <h3 className="rb-section-label" id={`${id}-tree`}><PixelIcon name="dna" />Family tree</h3>
        <LegacyTree friend={friend} babies={babies} creature={creature} legacy={computed ?? undefined} onSelect={baby => setSelectedKey(baby.key)} disabled={busy}
          reducedMotion={reducedMotion} />
      </section>
    </div>
  </Panel>;

  return <Panel eyebrow={sanctuary ? "Sanctuary" : "Nursery"} title={`Your brood · ${babies.length}`} onClose={busy ? undefined : onClose} size="lg"
    focusKey="grid" className="rb-brood">
    {tabs}
    <div className={cx(friend && "rb-brood-pane")} role={friend ? "tabpanel" : undefined} id={friend ? `${id}-brood-panel` : undefined}
      aria-labelledby={friend ? `${id}-brood` : undefined} style={friend ? undefined : { display: "contents" }}>
    {sanctuary && <p className="rb-match-guide" role="note"><PixelIcon name="sprout" />
      <span><strong>The Sanctuary</strong> takes babies you trade in and pays their fixed simulated RF value. Tap a baby, then Trade in.</span></p>}
    {collection && <CollectionMeter collection={collection} />}
    {(heartsRate || onOpenShop) && babies.length > 0 && <div className="rb-brood-income">
      {heartsRate && <p><PixelIcon name="heart" /><span>Your brood earns <strong>{income} Hearts</strong> a minute.</span></p>}
      {onOpenShop && <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-brood-shop" onClick={onOpenShop} disabled={busy}>
        <PixelIcon name="sparkle" /><span>Hats &amp; wishes</span></button>}
    </div>}
    {babies.length === 0 ? <div className="rb-empty">
      <span className="rb-empty-art" aria-hidden="true"><PixelIcon name="eggBig" pixel={5} /></span>
      <p className="rb-empty-title">No babies yet</p>
      <p className="rb-muted">Find a match to hatch your first baby. Kept babies follow your Friend around the nursery.</p>
      {onFindMatch && <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onFindMatch} data-autofocus>
        <PixelIcon name="heart" /><span>Find a match</span></button>}
    </div> : <>
      {error && <p className="rb-error" role="alert">{error}</p>}
      <ul className="rb-brood-grid">
        {babies.map(baby => <li key={baby.key}>
          <button type="button" className={`rb-brood-item rb-tier-${baby.tier ?? "common"}`} style={tierVars(baby.tier)} onClick={() => setSelectedKey(baby.key)}
            aria-label={`${baby.name}, ${tierLabel(baby.tier)}, ${lineageLabel(baby)}${heartsRate ? `, earns ${heartsRate(baby)} Hearts a minute` : ""}. Show details`}>
            <span className="rb-slot"><SpriteThumb creature={baby} scale={4} compactScale={2} reducedMotion={reducedMotion} label="" /></span>
            <span className="rb-brood-name">{baby.name}</span>
            <span className="rb-brood-meta">
              <span className="rb-tier-dot" aria-hidden="true" />{tierLabel(baby.tier)} · {lineageLabel(baby)}
            </span>
            {heartsRate && <span className="rb-brood-rate"><PixelIcon name="heart" />{heartsRate(baby)}/min</span>}
          </button>
        </li>)}
      </ul>
      <p className="rb-muted rb-small rb-brood-note">Tap a baby for its DNA card. Breed it again, or trade it in at the Sanctuary for its fixed simulated RF value.</p>
    </>}
    </div>
  </Panel>;
}
