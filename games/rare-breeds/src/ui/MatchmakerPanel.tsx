import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { lockCount, NO_LOCKS, PASS_ON_ODDS, passableShapes } from "../genetics.ts";
import { FREE_LOCKS, LOCK_PRICE, lockCost, lockCostLabel } from "../hearts.ts";
import type { Dream } from "../dream.ts";
import type { Creature, RowLock } from "../types.ts";
import { DreamRows } from "./DreamPanel.tsx";
import { GeneLab, useLockOptions, usePrefetchLockOptions } from "./GeneLab.tsx";
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
  /** Explicit navigation to a mate (e.g. Find the mate) takes precedence over a stored design. */
  initialParentB?: string;
  onReroll: () => void;
  /** `locks`: the Gene Lab's row locks for this pair (all null without the lab). */
  onBreed: (parentA: Creature, parentB: Creature, locks: readonly RowLock[]) => void;
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
  /**
   * Gene Lab: lock rows of the chosen pair to one parent (lockOptions in src/genetics.ts), paid in Hearts when the breed
   * starts. `pair` and `locks` are the stored design: the panel reopens on that pair (unless `initialParentA` names another),
   * and a new pair starts free. `onChange` stores a new design; `freeLeft` is the session's free locked rows still unused.
   * Omit to hide the lab.
   */
  lab?: Readonly<{
    pair: readonly [string, string] | null; locks: readonly RowLock[];
    onChange: (pair: readonly [string, string] | null, locks: readonly RowLock[]) => void;
    freeLeft: number; hearts: number;
  }>;
  /** An egg already laid with this pair and these locks, `hearts` paid for them ("Finish hatching"): shown, not editable. */
  committed?: Readonly<{ a: Creature; b: Creature; locks: readonly RowLock[]; hearts: number }> | null;
  reducedMotion?: boolean;
  /** Your Friend's dream (src/dream.ts): its mate gets a dream tag, and with your Friend and that mate the lab shows the dream. */
  dream?: Dream | null;
  /** Open on the Gene Lab tab (e.g. "Find the mate" from the dream). Default: the Parents tab. */
  initialView?: "pair" | "lab";
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

type PickProps = Readonly<{ creature: Creature; name: string; checked: boolean; disabled?: boolean; onPick: () => void; variant: "card" | "chip"; isNew?: boolean; isDream?: boolean }>;

function Pick({ creature, name, checked, disabled, onPick, variant, isNew, isDream }: PickProps) {
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
        {isDream && <span className="rb-sr-only">, the mate of your Friend's dream</span>}
      </span>
      {isDream ? <span className="rb-tag rb-pick-dream" aria-hidden="true"><PixelIcon name="dream" />Dream</span>
        : isNew && <span className="rb-tag rb-pick-new" aria-hidden="true">New</span>}
      <span className="rb-pick-check" aria-hidden="true"><PixelIcon name="check" /></span>
    </span>
  </label>;
}

/** Choose two parents, reroll wild mates for free, and breed (buying an egg first when needed). */
export function MatchmakerPanel({ parents, candidates, eggs, price, needsEgg, canAfford, busy, busyLabel, actionLabel, error, disabledReason,
  initialParentA, initialParentB, onReroll, onBreed, onClose, collectedFamilies, odds, guide, onWish, wishPrice, preferredMateKey,
  onStockUp, stockUpQuantity = 5, stockUpPrice, stockUpDisabled, lab, committed, reducedMotion, dream, initialView }: MatchmakerPanelProps) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  const aList = useRef<HTMLDivElement>(null);
  const compact = useCompact(node);
  const reduced = useReducedMotion(reducedMotion);
  // A stored Gene Lab design reopens on its pair (e.g. after a cancelled confirmation), unless Parent A is named.
  const stored = lab?.pair && lockCount(lab.locks) > 0 && (!initialParentA || initialParentA === lab.pair[0])
    && (!initialParentB || initialParentB === lab.pair[1]) ? lab.pair : null;
  const [aKey, setAKey] = useState(initialParentA ?? stored?.[0] ?? parents[0]?.key ?? "");
  const [bKey, setBKey] = useState(initialParentB ?? stored?.[1] ?? preferredMateKey ?? candidates[0]?.key ?? "");
  const [view, setView] = useState<"pair" | "lab">(stored || committed?.locks.some(lock => lock !== null) || initialView === "lab" ? "lab" : "pair");
  const picked = parents.find(creature => creature.key === aKey) ?? parents[0];
  const broodMates = parents.filter(creature => creature.kind === "baby" && creature.key !== picked?.key);
  const offered = [...candidates, ...broodMates];
  // An egg already laid hatches its own pair.
  const a = committed?.a ?? picked;
  const b = committed?.b ?? offered.find(creature => creature.key === bKey) ?? offered.find(creature => creature.key === preferredMateKey)
    ?? candidates[0] ?? broodMates[0];
  const locked = !!busy || !!committed;
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
  // Gene Lab: the stored locks belong to one pair; any other pair starts free and clears them.
  const samePair = !!a && !!b && !!lab?.pair && lab.pair[0] === a.key && lab.pair[1] === b.key;
  const locks = committed?.locks ?? (samePair ? lab!.locks : NO_LOCKS);
  const count = lockCount(locks);
  useEffect(() => {
    if (lab && !committed && !samePair && lockCount(lab.locks)) lab.onChange(null, NO_LOCKS);
  }, [a?.key, b?.key]);
  // The first look at a pair assesses its 630 masks (tens of ms): warmed while idle on the Parents tab, and run after a
  // paint when rows are locked (the pass-on line keeps its plain odds until then).
  usePrefetchLockOptions(a, b, !!lab && view === "pair");
  const labOptions = useLockOptions(a, b, locks, !!lab && count > 0);
  const freeLeft = lab?.freeLeft ?? FREE_LOCKS;
  const labPrice = lockCost(count, freeLeft);
  const costLabel = !committed ? lockCostLabel(count, freeLeft)
    : count ? `${count} ${count === 1 ? "lock" : "locks"}, ${committed.hearts ? `${committed.hearts} Hearts paid` : "free"}` : "No locks";
  const shortOfHearts = !committed && !!lab && labPrice.hearts > lab.hearts;
  // Shape mutations the chosen parents can pass on (measured rate in tests/genetics.test.ts). With locks the lab knows
  // better: a shape whose rows are all locked to its parent will pass on, one the locks block cannot.
  const passOn = a && b ? passableShapes(a, b) : [];
  const sure = count && labOptions ? labOptions.shapes.filter(shape => shape.odds === "sure") : [];
  const chance = count && labOptions ? labOptions.shapes.filter(shape => shape.odds === "chance") : passOn;
  const passLine = [sure.length ? `Will pass on: ${sure.map(item => `${item.label} from ${item.name}`).join(", ")}` : "",
    chance.length ? `Can pass on: ${chance.map(item => `${item.label} from ${item.name}`).join(", ")} (${PASS_ON_ODDS}${chance.length > 1 ? " each" : ""})` : ""]
    .filter(Boolean).join(" · ");

  const reason = disabledReason
    ?? (needsEgg && !canAfford ? `Not enough simulated RF. An egg costs ${price}.` : undefined)
    ?? (!a || !b ? "Pick two parents first." : undefined)
    ?? (shortOfHearts ? `Not enough Hearts for your locks: ${labPrice.hearts} needed, ${lab!.hearts} on hand. Free a row or earn Hearts.` : undefined);
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
        : !error && (newCount || !count) && <p className={cx("rb-foot-msg rb-foot-hint", newCount ? "rb-foot-new" : "rb-muted")}>{newCount
          ? `This pair adds ${newCount === 1 ? "a new family" : `${newCount} new families`} to your collection.`
          : needsEgg ? "You confirm the purchase in Rare Friends." : "Pick a pair, then hatch."}</p>}
      {passLine && <p className="rb-foot-msg rb-foot-pass"><PixelIcon name="dna" /><span>{passLine}</span></p>}
      {count > 0 && view !== "lab" && <p className={cx("rb-foot-msg rb-foot-lab", shortOfHearts && "rb-warn")}><PixelIcon name="lock" /><span>Gene Lab: {costLabel}</span></p>}
    </div>
    {stockUp}
    <button type="button" className="rb-button rb-button-primary rb-button-lg rb-breed" aria-busy={busy || undefined}
      disabled={busy || !!reason} onClick={() => a && b && onBreed(a, b, locks)} data-autofocus>
      {busy ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="heart" />}
      <span>{label}</span>
    </button>
    </div>
  </>;

  const sectionA = <div key="a" className="rb-section rb-section-a">
    <div className="rb-section-head"><h3 className="rb-section-label" id={`${id}-a`}>Parent A{aRow && <span className="rb-section-hint">Yours · {parents.length}</span>}</h3></div>
    <div ref={aList} className={cx("rb-chip-list", aRow && "rb-chip-scroll")} role="radiogroup" aria-labelledby={`${id}-a`}>
      {parents.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-a`} variant="chip" disabled={locked}
        checked={creature.key === a?.key} onPick={() => setAKey(creature.key)} />)}
    </div>
  </div>;

  const broodChips = broodMates.length > 0 && <div className="rb-chip-list rb-chip-list-wrap rb-chip-scroll">
    {broodMates.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-b`} variant="chip" disabled={locked}
      checked={creature.key === b?.key} onPick={() => setBKey(creature.key)} />)}
  </div>;
  // Phones: Parent A, then Parent B (the real wild Friends), then kept babies as Parent B last, so the order reads like the guide.
  const broodSection = broodChips && <div key="brood" className="rb-section rb-section-brood" role="radiogroup" aria-labelledby={`${id}-brood`}>
    <p className="rb-section-sub" id={`${id}-brood`}>Or Parent B from your brood</p>
    {broodChips}
  </div>;

  const sectionB = (withBrood: boolean) => <div key="b" className="rb-section rb-section-b">
    <div className="rb-section-head">
      <h3 className="rb-section-label" id={`${id}-b`}>Parent B</h3>
      <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-reroll" onClick={onReroll} disabled={locked}>
        <PixelIcon name="dice" /><span>New faces</span><span className="rb-tag">Free</span>
      </button>
      {onWish && <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-wish" onClick={onWish} disabled={locked}
        aria-label={`Wish match: pick a family${wishPrice ? `, ${wishPrice} Hearts` : ""}`}>
        <PixelIcon name="sparkle" /><span>Wish</span>{wishPrice ? <span className="rb-wish-price"><PixelIcon name="heart" />{wishPrice}</span> : null}
      </button>}
    </div>
    <div role="radiogroup" aria-labelledby={`${id}-b`} className="rb-section-b-options">
      <div className="rb-card-row">
        {candidates.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-b`} variant="card" disabled={locked}
          checked={creature.key === b?.key} onPick={() => setBKey(creature.key)} isNew={isNew(creature)} isDream={creature.key === dream?.mate.key} />)}
      </div>
      {withBrood && broodChips && <>
        <p className="rb-section-sub">Or one of your brood</p>
        {broodChips}
      </>}
    </div>
  </div>;

  // Two views: the pickers, and the Gene Lab for the chosen pair. Left and Right move between the tabs (roving tabindex).
  // Wide frames put the tabs in the header, so the pickers and the mate cards fit the 960 x 640 panel without scrolling.
  const badge = count ? `${count} locked` : !committed && freeLeft > 0 ? `${freeLeft} free` : null;
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = event.key === "ArrowLeft" ? "pair" : "lab";
    setView(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
  };
  const tab = (key: "pair" | "lab", content: ReactNode) => <button type="button" role="tab" id={`${id}-tab-${key}`} data-view={key}
    aria-selected={view === key} aria-controls={view === key ? `${id}-view` : undefined} tabIndex={view === key ? 0 : -1}
    className={cx("rb-match-tab", view === key && "rb-on")} onClick={() => setView(key)}>{content}</button>;
  const tabs = lab && a && b ? <div className="rb-match-tabs" role="tablist" aria-label="Matchmaker" onKeyDown={tabKeys}>
    {tab("pair", <><PixelIcon name="heart" /><span>Parents</span></>)}
    {tab("lab", <><PixelIcon name="dna" /><span>Gene Lab</span>{badge && <span className="rb-tag rb-match-tab-tag">{badge}</span>}</>)}
  </div> : null;
  const inHead = !compact && tabs;
  const viewProps = tabs ? { role: "tabpanel", id: `${id}-view`, "aria-labelledby": `${id}-tab-${view}` } : {};

  if (view === "lab" && lab && a && b) return <Panel eyebrow="Matchmaker" title="Gene Lab" onClose={busy ? undefined : onClose} size="lg" footer={footer}
    headerEnd={inHead || null} className="rb-match rb-match-lab">
    {!inHead && tabs}
    <div className="rb-match-view" {...viewProps}>
      <GeneLab a={a} b={b} locks={locks} onChange={committed || busy ? undefined : next => lab.onChange([a.key, b.key], next)} cost={costLabel} short={shortOfHearts}
        costNote={committed ? (committed.hearts ? "Paid when the egg was laid." : "Set when the egg was laid.") : `${freeLeft > 0 ? `${freeLeft} ${freeLeft === 1 ? "row" : "rows"} free this session, then ` : ""}${LOCK_PRICE} Hearts a row, paid only when the egg is used.${labPrice.hearts ? ` You have ${lab.hearts}.` : ""}`}
        reducedMotion={reduced} aside={dream && a.key === dream.friendKey && b.key === dream.mate.key ? grid => <DreamRows dream={dream} {...grid} /> : undefined} />
    </div>
  </Panel>;

  return <Panel eyebrow="Matchmaker" title="Find a match" onClose={busy ? undefined : onClose} size="lg" footer={footer}
    headerEnd={inHead || null} className={cx("rb-match", guide && "rb-match-guided")}>
    {!inHead && tabs}
    <div className="rb-match-view" {...viewProps}>
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
              <span className="rb-chemistry-fine">Just for fun. Same odds for every pair.</span>
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

      {/* First visit only (until the first breed): one line, so the mate cards stay in view. */}
      {guide && <p className="rb-match-guide" role="note"><PixelIcon name="help" />
        <span><strong>Parent A</strong> is yours, <strong>Parent B</strong> is the mate: a real Rare Friend or one of your babies.</span>
      </p>}

      <div ref={node} className={cx("rb-match-pickers", "rb-match-v2", aRow && "rb-match-stacked", compact && "rb-match-phone")}>
        {compact ? [sectionA, sectionB(false), broodSection] : [sectionA, sectionB(true)]}
      </div>
    </div>
  </Panel>;
}
