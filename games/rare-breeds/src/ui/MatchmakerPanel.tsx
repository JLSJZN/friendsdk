import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Creature } from "../types.ts";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { familyOf } from "./collection.ts";
import { cx, hashString, lineageLabel, tierLabel, tierVars, useCompact, useReducedMotion, type TierInfo } from "./shared.ts";

export type MatchmakerPanelProps = Readonly<{
  /** Parent A options: the player's Friend first, then kept babies. */
  parents: readonly Creature[];
  /** Wild mates on offer (usually 3). Kept babies from `parents` are offered as parent B too. */
  candidates: readonly Creature[];
  eggs: number;
  /** Preformatted egg price, e.g. "1 RF". */
  price: string;
  /** No egg waiting: the button buys one first ("Buy egg & breed · 1 RF"). */
  needsEgg: boolean;
  /** Enough Simulated RF to buy an egg (only checked when needsEgg). */
  canAfford: boolean;
  busy?: boolean;
  /** Button text while busy, e.g. "Buying egg…". Default "Hatching…". */
  busyLabel?: string;
  /** Overrides the idle button text, e.g. "Finish hatching" when a paid play is still pending. */
  actionLabel?: string;
  error?: string;
  /** Any other reason breeding is unavailable right now; disables the button and is shown. */
  disabledReason?: string;
  /** Preselect parent A by key. Defaults to the first of `parents`. */
  initialParentA?: string;
  onReroll: () => void;
  onBreed: (parentA: Creature, parentB: Creature) => void;
  /** Omit while busy so the panel cannot be dismissed mid-action. */
  onClose?: () => void;
  /** Families already in the collection. Wild mates from any other family get a "New" tag. Omit to hide the tags. */
  collectedFamilies?: readonly string[];
  /** "What can hatch" strip above the button: chance and fixed Sanctuary value per tier. */
  odds?: readonly TierInfo[];
  /** First-time help: explains Parent A / Parent B and the runtime confirmations that follow. */
  guide?: boolean;
  /** Opens the Wish match (pick a family for Parent B). Shown next to New faces with its price. */
  onWish?: () => void;
  /** Wish match price in Hearts, e.g. 15. */
  wishPrice?: number;
  /**
   * Preselect Parent B by key (a wild mate on offer or a kept baby), e.g. one from a family not collected yet.
   * The player's own pick wins while it is still on offer; after a reroll the new preferred mate is picked.
   */
  preferredMateKey?: string;
  /**
   * With no egg waiting: a secondary "Stock up: 5 eggs · 5 RF" action next to "Buy egg & breed"
   * (one runtime confirmation for the whole pack). Called with the pack size.
   */
  onStockUp?: (quantity: bigint) => void;
  /** Eggs in the stock-up pack. Default 5. */
  stockUpQuantity?: number;
  /** Preformatted pack price, e.g. "5 RF". */
  stockUpPrice?: string;
  /** Disables the stock-up action, e.g. when the pack is not affordable. */
  stockUpDisabled?: boolean;
  reducedMotion?: boolean;
}>;

const LINES = [
  "Both love a good nap.",
  "Matching pixel energy.",
  "Opposites attract.",
  "It's the silhouettes. Definitely the silhouettes.",
  "They met at the snack table.",
  "Same favourite colour: black.",
  "Sparks! Mostly static, but still.",
  "Two families, one weird little baby.",
  "A very tidy pair of outlines.",
  "Honestly? Iconic.",
  "Their walk cycles are in sync.",
  "Mutual respect for crisp edges.",
];

/** Playful, deterministic flavour. Never affects odds. */
function chemistry(a: Creature, b: Creature) {
  const hash = hashString(`${a.key}|${b.key}`);
  const hearts = 3 + (hash % 3);
  const line = a.familyId === b.familyId ? "Keeping it in the family."
    : a.kind === "baby" && b.kind === "baby" ? "A brood romance. Adorable."
    : LINES[(hash >>> 3) % LINES.length];
  return { hearts, line };
}

function meta(creature: Creature) {
  if (creature.kind === "baby") return `${lineageLabel(creature)} · ${tierLabel(creature.tier)}`;
  return creature.kind === "friend" ? `You · ${creature.family}` : creature.family;
}

type PickProps = Readonly<{ creature: Creature; name: string; checked: boolean; disabled?: boolean; onPick: () => void; variant: "card" | "chip"; isNew?: boolean }>;

function Pick({ creature, name, checked, disabled, onPick, variant, isNew }: PickProps) {
  const card = variant === "card";
  return <label className={cx("rb-pick", card ? "rb-pick-card" : "rb-pick-chip")} style={tierVars(creature.tier)}>
    <input type="radio" className="rb-sr-only" name={name} value={creature.key} checked={checked} disabled={disabled} onChange={onPick} />
    <span className="rb-pick-body">
      <span className="rb-slot"><SpriteThumb creature={creature} scale={card ? 4 : 2} compactScale={2} clip={card ? "walk" : "idle"} label="" /></span>
      <span className="rb-pick-text">
        <span className="rb-pick-name">{creature.kind === "friend" && !card
          ? <><span className="rb-pick-long">{creature.name}</span><span className="rb-pick-short">You</span></> : creature.name}</span>
        <span className="rb-pick-meta">{meta(creature)}</span>
        {isNew && <span className="rb-sr-only">, new family for your collection</span>}
      </span>
      {isNew && <span className="rb-tag rb-pick-new" aria-hidden="true">New</span>}
      <span className="rb-pick-check" aria-hidden="true"><PixelIcon name="check" /></span>
    </span>
  </label>;
}

/** Choose two parents, reroll wild mates for free, and breed (buying an egg first when needed). */
export function MatchmakerPanel({ parents, candidates, eggs, price, needsEgg, canAfford, busy, busyLabel, actionLabel, error, disabledReason,
  initialParentA, onReroll, onBreed, onClose, collectedFamilies, odds, guide, onWish, wishPrice, preferredMateKey,
  onStockUp, stockUpQuantity = 5, stockUpPrice, stockUpDisabled, reducedMotion }: MatchmakerPanelProps) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  const aList = useRef<HTMLDivElement>(null);
  const compact = useCompact(node);
  const reduced = useReducedMotion(reducedMotion);
  const [aKey, setAKey] = useState(initialParentA ?? parents[0]?.key ?? "");
  const [bKey, setBKey] = useState(preferredMateKey ?? candidates[0]?.key ?? "");
  const a = parents.find(creature => creature.key === aKey) ?? parents[0];
  const broodMates = parents.filter(creature => creature.kind === "baby" && creature.key !== a?.key);
  const offered = [...candidates, ...broodMates];
  const b = offered.find(creature => creature.key === bKey) ?? offered.find(creature => creature.key === preferredMateKey)
    ?? candidates[0] ?? broodMates[0];
  // Parent A becomes one sideways-scrolling row once there is a choice; keep the picked one in view.
  const aRow = parents.length > 1;
  useLayoutEffect(() => {
    const list = aList.current, picked = list?.querySelector<HTMLElement>("input:checked")?.closest<HTMLElement>(".rb-pick");
    if (!list || !picked || list.scrollWidth <= list.clientWidth) return;
    const left = picked.offsetLeft - list.offsetLeft, right = left + picked.offsetWidth;
    if (left < list.scrollLeft || right > list.scrollLeft + list.clientWidth) list.scrollLeft = Math.max(0, left - 8);
  }, [aRow, compact]);
  const fun = a && b ? chemistry(a, b) : null;
  const isNew = (creature: Creature) => !!collectedFamilies && creature.kind !== "baby" && !collectedFamilies.includes(familyOf(creature));
  const newCount = collectedFamilies && a && b ? new Set([a, b].filter(isNew).map(familyOf)).size : 0;

  const reason = disabledReason
    ?? (needsEgg && !canAfford ? `Not enough simulated RF. An egg costs ${price}.` : undefined)
    ?? (!a || !b ? "Pick two parents first." : undefined);
  const label = busy ? busyLabel ?? "Hatching…" : actionLabel ?? (needsEgg ? `Buy egg & breed · ${price}` : "Breed · uses 1 egg");
  const stockUp = needsEgg && onStockUp && !actionLabel && !busy
    ? <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-stock" onClick={() => onStockUp(BigInt(stockUpQuantity))}
      disabled={stockUpDisabled || !!disabledReason} aria-label={`Stock up: ${stockUpQuantity} eggs${stockUpPrice ? ` for ${stockUpPrice}` : ""}, one confirmation`}>
      <PixelIcon name="egg" /><span><span className="rb-stock-long">Stock up: </span>{stockUpQuantity}<span className="rb-stock-eggs"> eggs</span>{stockUpPrice ? ` · ${stockUpPrice}` : ""}</span>
    </button> : null;
  const footer = <>
    {odds && odds.length > 0 && <div className="rb-odds-strip">
      <p className="rb-odds-strip-label"><span className="rb-long">What can hatch</span><span className="rb-short">Odds</span></p>
      <ul aria-label="What can hatch: chance and fixed Sanctuary value per tier">
        {odds.map(row => <li key={row.tier} className={`rb-tier-${row.tier}`} style={tierVars(row.tier)}>
          <span className="rb-tier-dot" aria-hidden="true" />
          <strong>{tierLabel(row.tier)}</strong>
          <span className="rb-odds-chance">{row.chance}</span>
          <span className="rb-odds-value">{row.value}</span>
        </li>)}
      </ul>
    </div>}
    {guide && !busy && <p className="rb-match-confirm" role="note"><PixelIcon name="sparkle" />
      <span className="rb-long">{needsEgg
        ? "Next, Rare Friends asks you to confirm twice: Buy egg, then Use egg. Both are simulated previews, no real RF moves."
        : "Next, Rare Friends asks you to confirm Use egg. It is a simulated preview, no real RF moves."}</span>
      <span className="rb-short">{needsEgg ? "Next: confirm Buy egg and Use egg (both simulated)." : "Next: confirm Use egg (simulated)."}</span>
    </p>}
    <div className={cx("rb-match-foot", stockUp && "rb-match-foot-stock")}>
    <div className="rb-foot-info">
      <p className="rb-foot-meta">
        <PixelIcon name="egg" /><strong>{eggs}</strong> {eggs === 1 ? "egg" : "eggs"}
        <span className="rb-muted"> · {needsEgg ? `1 egg = ${price} simulated` : "1 egg per hatch"}</span>
      </p>
      {error && <p className="rb-foot-msg rb-error" role="alert">{error}</p>}
      {reason ? <p className="rb-foot-msg rb-warn" role="status">{reason}</p>
        : !error && <p className={cx("rb-foot-msg rb-foot-hint", newCount ? "rb-foot-new" : "rb-muted")}>{newCount
          ? `This pair adds ${newCount === 1 ? "a new family" : `${newCount} new families`} to your collection.`
          : needsEgg ? "You confirm the purchase in Rare Friends." : "Pick a pair, then hatch."}</p>}
    </div>
    {stockUp}
    <button type="button" className="rb-button rb-button-primary rb-button-lg rb-breed" aria-busy={busy || undefined}
      disabled={busy || !!reason} onClick={() => a && b && onBreed(a, b)} data-autofocus>
      {busy ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="heart" />}
      <span>{label}</span>
    </button>
    </div>
  </>;

  const sectionA = <div key="a" className="rb-section rb-section-a">
    <div className="rb-section-head"><h3 className="rb-section-label" id={`${id}-a`}>Parent A{aRow && <span className="rb-section-hint">Yours · {parents.length}</span>}</h3></div>
    <div ref={aList} className={cx("rb-chip-list", aRow && "rb-chip-scroll")} role="radiogroup" aria-labelledby={`${id}-a`}>
      {parents.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-a`} variant="chip" disabled={busy}
        checked={creature.key === a?.key} onPick={() => setAKey(creature.key)} />)}
    </div>
  </div>;

  const broodChips = broodMates.length > 0 && <div className="rb-chip-list rb-chip-list-wrap rb-chip-scroll">
    {broodMates.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-b`} variant="chip" disabled={busy}
      checked={creature.key === b?.key} onPick={() => setBKey(creature.key)} />)}
  </div>;
  // Phones: kept babies as Parent B come last, after Parent A, so the real wild Friends and your own pick both show first.
  const broodSection = broodChips && <div key="brood" className="rb-section rb-section-brood" role="radiogroup" aria-labelledby={`${id}-brood`}>
    <p className="rb-section-sub" id={`${id}-brood`}>Or Parent B from your brood</p>
    {broodChips}
  </div>;

  const sectionB = (withBrood: boolean) => <div key="b" className="rb-section rb-section-b">
    <div className="rb-section-head">
      <h3 className="rb-section-label" id={`${id}-b`}>Parent B</h3>
      <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-reroll" onClick={onReroll} disabled={busy}>
        <PixelIcon name="dice" /><span>New faces</span><span className="rb-tag">Free</span>
      </button>
      {onWish && <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-wish" onClick={onWish} disabled={busy}
        aria-label={`Wish match: pick a family${wishPrice ? `, ${wishPrice} Hearts` : ""}`}>
        <PixelIcon name="sparkle" /><span>Wish</span>{wishPrice ? <span className="rb-wish-price"><PixelIcon name="heart" />{wishPrice}</span> : null}
      </button>}
    </div>
    <div role="radiogroup" aria-labelledby={`${id}-b`} className="rb-section-b-options">
      <div className="rb-card-row">
        {candidates.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-b`} variant="card" disabled={busy}
          checked={creature.key === b?.key} onPick={() => setBKey(creature.key)} isNew={isNew(creature)} />)}
      </div>
      {withBrood && broodChips && <>
        <p className="rb-section-sub">Or one of your brood</p>
        {broodChips}
      </>}
    </div>
  </div>;

  return <Panel eyebrow="Matchmaker" title="Find a match" onClose={busy ? undefined : onClose} size="lg" footer={footer} className={cx("rb-match", guide && "rb-match-guided")}>
    {a && b && fun && <section className={cx("rb-match-stage", !reduced && "rb-animate")} aria-label={`Chosen pair: ${a.name} and ${b.name}`}>
      <div className="rb-match-scene">
        <span className="rb-match-sprite"><SpriteThumb key={a.key} creature={a} scale={4} compactScale={2} clip="walk" facing="right" label="" /></span>
        <div className="rb-match-middle">
          <span className="rb-match-heart" aria-hidden="true"><PixelIcon name="heart" pixel={3} /></span>
          <p className="rb-chemistry">
            <span className="rb-eyebrow">Chemistry</span>
            <span className="rb-hearts" role="img" aria-label={`Chemistry ${fun.hearts} of 5 hearts`}>
              {[0, 1, 2, 3, 4].map(index => <PixelIcon key={index} name={index < fun.hearts ? "heart" : "heartOutline"} />)}
            </span>
            <span className="rb-chemistry-line">{fun.line}</span>
          </p>
        </div>
        <span className="rb-match-sprite"><SpriteThumb key={b.key} creature={b} scale={4} compactScale={2} clip="walk" facing="left" label="" /></span>
      </div>
      <div className="rb-match-captions">
        <p><strong>{a.name}</strong><span>{meta(a)}</span></p>
        <p className="rb-match-fine">Just for fun. Same odds for every pair.</p>
        <p><strong>{b.name}</strong><span>{meta(b)}</span></p>
      </div>
    </section>}

    {guide && <p className="rb-match-guide" role="note"><PixelIcon name="help" />
      <span><strong>Parent A</strong> is yours: your Friend or a kept baby. <strong>Parent B</strong> is the mate: a real Rare Friend or one of your babies.</span>
    </p>}

    <div ref={node} className={cx("rb-match-pickers", "rb-match-v2", aRow && "rb-match-stacked", compact && "rb-match-b-first")}>
      {compact ? [sectionB(false), sectionA, broodSection] : [sectionA, sectionB(true)]}
    </div>
  </Panel>;
}
