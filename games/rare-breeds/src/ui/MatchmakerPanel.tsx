import { useId, useState } from "react";
import type { Creature } from "../types.ts";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { familyOf } from "./collection.ts";
import { cx, hashString, lineageLabel, tierLabel, tierVars, useReducedMotion } from "./shared.ts";

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
  initialParentA, onReroll, onBreed, onClose, collectedFamilies, reducedMotion }: MatchmakerPanelProps) {
  const id = useId();
  const reduced = useReducedMotion(reducedMotion);
  const [aKey, setAKey] = useState(initialParentA ?? parents[0]?.key ?? "");
  const [bKey, setBKey] = useState(candidates[0]?.key ?? "");
  const a = parents.find(creature => creature.key === aKey) ?? parents[0];
  const broodMates = parents.filter(creature => creature.kind === "baby" && creature.key !== a?.key);
  const b = [...candidates, ...broodMates].find(creature => creature.key === bKey) ?? candidates[0] ?? broodMates[0];
  const fun = a && b ? chemistry(a, b) : null;
  const isNew = (creature: Creature) => !!collectedFamilies && creature.kind !== "baby" && !collectedFamilies.includes(familyOf(creature));
  const newCount = collectedFamilies && a && b ? new Set([a, b].filter(isNew).map(familyOf)).size : 0;

  const reason = disabledReason
    ?? (needsEgg && !canAfford ? `Not enough Simulated RF. An egg costs ${price}.` : undefined)
    ?? (!a || !b ? "Pick two parents first." : undefined);
  const label = busy ? busyLabel ?? "Hatching…" : actionLabel ?? (needsEgg ? `Buy egg & breed · ${price}` : "Breed · uses 1 egg");
  const footer = <div className="rb-match-foot">
    <div className="rb-foot-info">
      <p className="rb-foot-meta">
        <PixelIcon name="egg" /><strong>{eggs}</strong> {eggs === 1 ? "egg" : "eggs"}
        <span className="rb-muted"> · {needsEgg ? `1 egg = ${price} Simulated` : "1 egg per hatch"}</span>
      </p>
      {error && <p className="rb-foot-msg rb-error" role="alert">{error}</p>}
      {reason ? <p className="rb-foot-msg rb-warn" role="status">{reason}</p>
        : !error && <p className={cx("rb-foot-msg rb-foot-hint", newCount ? "rb-foot-new" : "rb-muted")}>{newCount
          ? `This pair adds ${newCount === 1 ? "a new family" : `${newCount} new families`} to your collection.`
          : needsEgg ? "You confirm the purchase in the runtime." : "Pick a pair, then hatch."}</p>}
    </div>
    <button type="button" className="rb-button rb-button-primary rb-button-lg rb-breed" aria-busy={busy || undefined}
      disabled={busy || !!reason} onClick={() => a && b && onBreed(a, b)} data-autofocus>
      {busy ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="heart" />}
      <span>{label}</span>
    </button>
  </div>;

  return <Panel eyebrow="Matchmaker" title="Find a match" onClose={busy ? undefined : onClose} size="lg" footer={footer} className="rb-match">
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

    <div className="rb-match-pickers">
      <div className="rb-section rb-section-a">
        <div className="rb-section-head"><h3 className="rb-section-label" id={`${id}-a`}>Parent A</h3></div>
        <div className="rb-chip-list" role="radiogroup" aria-labelledby={`${id}-a`}>
          {parents.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-a`} variant="chip" disabled={busy}
            checked={creature.key === a?.key} onPick={() => setAKey(creature.key)} />)}
        </div>
      </div>

      <div className="rb-section rb-section-b">
        <div className="rb-section-head">
          <h3 className="rb-section-label" id={`${id}-b`}>Parent B</h3>
          <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-reroll" onClick={onReroll} disabled={busy}>
            <PixelIcon name="dice" /><span>New faces</span><span className="rb-tag">Free</span>
          </button>
        </div>
        <div role="radiogroup" aria-labelledby={`${id}-b`} className="rb-section-b-options">
          <div className="rb-card-row">
            {candidates.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-b`} variant="card" disabled={busy}
              checked={creature.key === b?.key} onPick={() => setBKey(creature.key)} isNew={isNew(creature)} />)}
          </div>
          {broodMates.length > 0 && <>
            <p className="rb-section-sub">Or one of your brood</p>
            <div className="rb-chip-list rb-chip-list-wrap">
              {broodMates.map(creature => <Pick key={creature.key} creature={creature} name={`${id}-parent-b`} variant="chip" disabled={busy}
                checked={creature.key === b?.key} onPick={() => setBKey(creature.key)} />)}
            </div>
          </>}
        </div>
      </div>
    </div>
  </Panel>;
}
