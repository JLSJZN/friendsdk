import { useMemo, useRef } from "react";
import { buildLegacy, type CreatureLookup, type Legacy } from "../legacy.ts";
import type { Creature } from "../types.ts";
import { ALL_FAMILIES } from "./collection.ts";
import { LegacyTree } from "./LegacyTree.tsx";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, useCompact } from "./shared.ts";

export type FriendCardProps = Readonly<{
  /** The player's Friend (dressed, so its hat shows). */
  friend: Creature;
  /** Kept babies, oldest first. */
  babies: readonly Creature[];
  /** Resolves parent keys (baby.parents), including babies that were traded in and wild mates. */
  creature?: CreatureLookup;
  /** Precomputed buildLegacy(friend, babies, creature) result (src/legacy.ts); computed when omitted. */
  legacy?: Legacy;
  /** Empty-state call to action. */
  onFindMatch?: () => void;
  reducedMotion?: boolean;
  className?: string;
}>;

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** "Your Friend's legacy": the player's Friend big, its token and family, and how far its pixels have spread. */
export function FriendCard({ friend, babies, creature, legacy, onFindMatch, reducedMotion, className }: FriendCardProps) {
  const node = useRef<HTMLElement>(null);
  const compact = useCompact(node);
  const computed = useMemo(() => legacy ?? buildLegacy(friend, babies, creature ?? (() => null)), [legacy, friend, babies, creature]);
  const { descendants, deepestLineage: deepest, friendRows: rowsFromFriend, totalRows: rowsTotal, legacyShare: share, families } = computed;
  const token = friend.tokenId !== undefined ? `#${friend.tokenId}` : null;
  const none = descendants === 0;
  return <section ref={node} className={cx("rb-friend", className)} aria-label={`${friend.name}'s legacy`}>
    <div className="rb-friend-hero">
      <span className="rb-card-floor" aria-hidden="true" />
      <SpriteThumb creature={friend} scale={compact ? 4 : 6} clip="walk" reducedMotion={reducedMotion} label={`${friend.name}, your Friend`} className="rb-friend-sprite" />
    </div>
    <div className="rb-friend-info">
      <p className="rb-eyebrow">Your Friend's legacy</p>
      <h3 className="rb-friend-name">{friend.name}</h3>
      <p className="rb-friend-meta">
        {token && <span className="rb-friend-token">Generations {token}</span>}
        <span>{friend.family} family</span>
      </p>
      <dl className="rb-friend-stats">
        <div><dt>Descendants</dt><dd>{descendants}</dd></div>
        <div><dt>Deepest</dt><dd>{none ? "None" : `F${deepest}`}</dd></div>
        <div className="rb-friend-share"><dt>Brood DNA</dt><dd>{none ? "0%" : percent(share)}</dd></div>
        <div><dt>Families</dt><dd>{families.length}<span>/{ALL_FAMILIES.length}</span></dd></div>
      </dl>
      {none ? <p className="rb-friend-line">Hatch a baby and your Friend's 256 on-chain pixels start to spread.</p>
        : <p className="rb-friend-line">
          <span className="rb-friend-bar" aria-hidden="true"><i style={{ width: percent(share) }} /></span>
          <span><strong>{rowsFromFriend} of {rowsTotal}</strong> pixel rows in your brood are {friend.name}'s own.</span>
        </p>}
      {families.length > 1 && <ul className="rb-friend-families" aria-label="Families in its line">
        {families.map((name, index) => <li key={name} className={cx(index === 0 && "rb-own")}>{name}{index === 0 && <span className="rb-sr-only"> (its own)</span>}</li>)}
      </ul>}
      {none && onFindMatch && <button type="button" className="rb-button rb-button-primary rb-button-sm rb-friend-cta" onClick={onFindMatch}>
        <PixelIcon name="heart" /><span>Find a match</span></button>}
    </div>
  </section>;
}

export type FriendPanelProps = Readonly<{
  friend: Creature;
  babies: readonly Creature[];
  creature?: CreatureLookup;
  legacy?: Legacy;
  /** Tapping a kept baby in the tree (e.g. open the brood on its DNA card). */
  onSelectBaby?: (baby: Creature) => void;
  onFindMatch?: () => void;
  onClose?: () => void;
  reducedMotion?: boolean;
}>;

/** Modal "Your Friend" view (e.g. when the player taps their Friend): FriendCard plus the family tree. */
export function FriendPanel({ friend, babies, creature, legacy, onSelectBaby, onFindMatch, onClose, reducedMotion }: FriendPanelProps) {
  const computed = useMemo(() => legacy ?? buildLegacy(friend, babies, creature ?? (() => null)), [legacy, friend, babies, creature]);
  return <Panel eyebrow="Your Friend" title={friend.name} onClose={onClose} size="lg" className="rb-friend-panel"
    footer={onFindMatch && babies.length > 0 ? <div className="rb-friend-foot">
      <p className="rb-muted rb-small">Every kept baby carries some of its rows. Breed again to spread them further.</p>
      <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onFindMatch} data-autofocus>
        <PixelIcon name="heart" /><span>Find a match</span></button>
    </div> : undefined}>
    <FriendCard friend={friend} babies={babies} creature={creature} legacy={computed} onFindMatch={onFindMatch} reducedMotion={reducedMotion} />
    <section className="rb-legacy-tree" aria-label="Family tree">
      <h3 className="rb-section-label"><PixelIcon name="dna" />Family tree</h3>
      <LegacyTree friend={friend} babies={babies} creature={creature} legacy={computed} onSelect={onSelectBaby} reducedMotion={reducedMotion} />
    </section>
  </Panel>;
}
