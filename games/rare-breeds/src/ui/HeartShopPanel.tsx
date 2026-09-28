import { useId, useMemo, useRef, useState } from "react";
import type { AccessoryInfo } from "../accessories.ts";
import { FREE_LOCKS, LOCK_PRICE } from "../hearts.ts";
import type { AccessoryId, Creature } from "../types.ts";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, useCompact } from "./shared.ts";

export type ShopTab = "hats" | "wish";

export type HeartShopPanelProps = Readonly<{
  /** Current Hearts (game points, never RF). */
  hearts: number;
  /** Hearts the kept brood earns per minute. */
  perMinute: number;
  /** Who can wear a hat: the player's Friend first, then kept babies (already dressed). */
  wearers: readonly Creature[];
  /** Hat catalog, cheapest first (src/accessories.ts ACCESSORIES). */
  catalog: readonly AccessoryInfo[];
  owned: ReadonlySet<AccessoryId>;
  /** Creature key -> the accessory it wears. Each accessory is worn by one creature at a time. */
  equipped: ReadonlyMap<string, AccessoryId>;
  onBuy: (id: AccessoryId) => void;
  /** Put an owned accessory on a creature (moving it from whoever wore it), or take it off with null. */
  onEquip: (key: string, id: AccessoryId | null) => void;
  /** Wish match: families to wish for, the price, and what is already in the collection (for "New" tags). */
  families: readonly Readonly<{ familyId: number; name: string }>[];
  wishPrice: number;
  collectedFamilies?: readonly string[];
  onWish: (familyId: number) => void;
  initialTab?: ShopTab;
  onClose?: () => void;
  reducedMotion?: boolean;
}>;

const wearerName = (creature: Creature) => creature.kind === "friend" ? "your Friend" : creature.name;

/** Heart icon plus amount, e.g. for prices. */
function Hearts({ amount, className }: { amount: number; className?: string }) {
  return <span className={cx("rb-hearts-amount", className)}><PixelIcon name="heart" />{amount}<span className="rb-sr-only"> Hearts</span></span>;
}

/**
 * The Hearts shop: hats with a live preview on the chosen wearer (buy once, then put on your Friend or any kept
 * baby, move or take off at will) and Wish match (three Matchmaker mates from a chosen family).
 */
export function HeartShopPanel({ hearts, perMinute, wearers, catalog, owned, equipped, onBuy, onEquip, families, wishPrice,
  collectedFamilies, onWish, initialTab = "hats", onClose, reducedMotion }: HeartShopPanelProps) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  const compact = useCompact(node);
  const [tab, setTab] = useState<ShopTab>(initialTab);
  const [hatId, setHatId] = useState<AccessoryId>(() => catalog.find(item => owned.has(item.id))?.id ?? catalog[0].id);
  const [wearerKey, setWearerKey] = useState(wearers[0]?.key ?? "");
  const [familyId, setFamilyId] = useState<number | null>(null);
  const wearer = wearers.find(creature => creature.key === wearerKey) ?? wearers[0];
  const hat = catalog.find(item => item.id === hatId) ?? catalog[0];
  const wornBy = (accessory: AccessoryId) => wearers.find(creature => equipped.get(creature.key) === accessory);
  const preview = useMemo(() => wearer && Object.freeze({ ...wearer, accessory: hat.id }), [wearer, hat.id]);
  const shortBy = (price: number) => Math.max(0, price - hearts);
  const earnLine = perMinute > 0 ? `Your brood earns ${perMinute} a minute.` : "Keep a baby to start earning.";

  const hatOwned = owned.has(hat.id), hatWearer = wornBy(hat.id);
  const onThisWearer = !!wearer && hatWearer?.key === wearer.key;
  const hatAction = !wearer ? null : !hatOwned
    ? <button type="button" className="rb-button rb-button-primary rb-button-lg rb-shop-action" disabled={hearts < hat.price} onClick={() => onBuy(hat.id)} data-autofocus>
      <span>Buy {hat.name}</span><Hearts amount={hat.price} /></button>
    : onThisWearer
      ? <button type="button" className="rb-button rb-button-outline rb-button-lg rb-shop-action" onClick={() => onEquip(wearer.key, null)} data-autofocus>
        <PixelIcon name="close" /><span>Take off</span></button>
      : <button type="button" className="rb-button rb-button-primary rb-button-lg rb-shop-action" onClick={() => onEquip(wearer.key, hat.id)} data-autofocus>
        <PixelIcon name="check" /><span>Put on {wearerName(wearer)}</span></button>;
  const hatStatus = !hatOwned
    ? hearts >= hat.price ? `${hat.name}: yours for ${hat.price} Hearts. Wear it on anyone, move it any time.` : `Need ${shortBy(hat.price)} more Hearts. ${earnLine}`
    : onThisWearer ? `${wearer ? wearerName(wearer) : ""} is wearing the ${hat.name}.`.replace(/^./, char => char.toUpperCase())
      : hatWearer ? `Owned. Now worn by ${wearerName(hatWearer)}; putting it on moves it.` : "Owned. Pick who wears it.";

  const family = families.find(item => item.familyId === familyId) ?? null;
  const wishAction = <button type="button" className="rb-button rb-button-primary rb-button-lg rb-shop-action"
    disabled={!family || hearts < wishPrice} onClick={() => family && onWish(family.familyId)} data-autofocus>
    <PixelIcon name="sparkle" /><span>{family ? `Wish for ${family.name}` : "Pick a family"}</span><Hearts amount={wishPrice} />
  </button>;
  const wishStatus = hearts < wishPrice ? `Need ${shortBy(wishPrice)} more Hearts. ${earnLine}`
    : family ? `The Matchmaker will offer three ${family.name} mates.` : "Pick the family you want to breed with.";

  const footer = <div className="rb-shop-foot">
    <p className="rb-shop-status" role="status">{tab === "hats" ? hatStatus : wishStatus}</p>
    {tab === "hats" ? hatAction : wishAction}
  </div>;

  return <Panel eyebrow="Game points, not RF" title="Hearts shop" onClose={onClose} size="lg" footer={footer} focusKey={tab} className="rb-shop">
    <div ref={node} className="rb-shop-summary">
      <Hearts amount={hearts} className="rb-shop-balance" />
      <p>
        <strong>{perMinute > 0 ? `Your brood earns ${perMinute} Hearts per minute.` : "Kept babies earn Hearts every few seconds."}</strong>
        <span>Never RF, cannot be traded in. Gene Lab locks in the Matchmaker: {LOCK_PRICE} Hearts a row, first {FREE_LOCKS} free.</span>
      </p>
    </div>

    <div className="rb-tabs" role="tablist" aria-label="Shop">
      {([["hats", "Hats"], ["wish", "Wish match"]] as const).map(([value, label]) => <button key={value} type="button" role="tab"
        id={`${id}-${value}`} aria-selected={tab === value} aria-controls={`${id}-${value}-panel`} className={cx("rb-tab", tab === value && "rb-on")}
        onClick={() => setTab(value)}>{value === "hats" ? <PixelIcon name="sparkle" /> : <PixelIcon name="heart" />}{label}</button>)}
    </div>

    {/* Both tabs stay mounted in one grid cell, so the panel keeps the taller tab's height when switching. */}
    <div className="rb-shop-stack">
    {wearer && preview && <div className={cx("rb-shop-hats rb-shop-v2", tab !== "hats" && "rb-shop-away")} role="tabpanel" id={`${id}-hats-panel`}
      aria-labelledby={`${id}-hats`} inert={tab !== "hats" || undefined} aria-hidden={tab !== "hats" || undefined}>
      <figure className="rb-shop-stage">
        <SpriteThumb key={`${preview.key}|${hat.id}`} creature={preview} scale={compact ? 4 : 6} clip="walk" reducedMotion={reducedMotion}
          label={`${wearer.name} wearing the ${hat.name}`} />
        <figcaption><strong>{hat.name}</strong><span>{hat.blurb}</span></figcaption>
      </figure>
      <div className="rb-shop-grid" role="radiogroup" aria-label="Hats">
        {catalog.map(item => {
          const by = wornBy(item.id);
          return <label key={item.id} className="rb-pick rb-shop-item">
            <input type="radio" className="rb-sr-only" name={`${id}-hat`} value={item.id} checked={item.id === hat.id} onChange={() => setHatId(item.id)} />
            <span className="rb-pick-body">
              <span className="rb-slot"><SpriteThumb creature={Object.freeze({ ...wearer, accessory: item.id })} scale={2} label="" animate={false} /></span>
              <span className="rb-shop-item-name">{item.name}</span>
              <span className={cx("rb-shop-item-state", owned.has(item.id) && "rb-owned")}>
                {!owned.has(item.id) ? <Hearts amount={item.price} /> : by
                  ? <><span className="rb-worn-long">On {by.kind === "friend" ? "Friend" : by.name}</span><span className="rb-worn-short">Worn</span></> : "Owned"}
              </span>
            </span>
          </label>;
        })}
      </div>
      <div className="rb-shop-wearers" role="radiogroup" aria-labelledby={`${id}-wearers`}>
        <p className="rb-section-label" id={`${id}-wearers`}>Who wears it?</p>
        <div className="rb-shop-wearer-list">
          {wearers.map(creature => <label key={creature.key} className={cx("rb-pick", "rb-pick-chip", "rb-shop-wearer")}>
            <input type="radio" className="rb-sr-only" name={`${id}-wearer`} value={creature.key} checked={creature.key === wearer.key}
              onChange={() => setWearerKey(creature.key)} />
            <span className="rb-pick-body">
              <span className="rb-slot"><SpriteThumb creature={creature} scale={2} label="" animate={false} /></span>
              <span className="rb-pick-text">
                <span className="rb-pick-name">{creature.kind === "friend" ? "You" : creature.name}</span>
                <span className="rb-pick-meta">{equipped.get(creature.key) ? catalog.find(item => item.id === equipped.get(creature.key))?.name : "No hat"}</span>
              </span>
            </span>
          </label>)}
        </div>
      </div>
    </div>}

    <div className={cx("rb-shop-wish", tab !== "wish" && "rb-shop-away")} role="tabpanel" id={`${id}-wish-panel`} aria-labelledby={`${id}-wish`}
      inert={tab !== "wish" || undefined} aria-hidden={tab !== "wish" || undefined}>
      <p className="rb-shop-wish-lead">Pick a family and the Matchmaker offers three mates from it: the fastest way to fill your collection.
        Costs {wishPrice} Hearts; the hatch odds stay the same.</p>
      <div className="rb-shop-families" role="radiogroup" aria-label="Family">
        {families.map(item => {
          const isNew = collectedFamilies ? !collectedFamilies.includes(item.name) : false;
          return <label key={item.familyId} className="rb-pick rb-shop-family">
            <input type="radio" className="rb-sr-only" name={`${id}-family`} value={item.familyId} checked={item.familyId === familyId}
              onChange={() => setFamilyId(item.familyId)} />
            <span className="rb-pick-body">
              <span className="rb-pick-name">{item.name}</span>
              {isNew && <span className="rb-tag">New<span className="rb-sr-only"> for your collection</span></span>}
            </span>
          </label>;
        })}
      </div>
    </div>
    </div>
  </Panel>;
}
