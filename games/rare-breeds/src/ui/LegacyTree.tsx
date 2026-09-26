import { useMemo } from "react";
import { buildLegacy, rowOrigins, type CreatureLookup, type Legacy, type LegacyNode } from "../legacy.ts";
import { FRAME_SIZE, type Creature } from "../types.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, lineageLabel, tierLabel, tierVars } from "./shared.ts";

export type LegacyTreeProps = Readonly<{
  /** The player's Friend, the root of the tree. */
  friend: Creature;
  /** Kept babies, oldest first. */
  babies: readonly Creature[];
  /** Resolves parent keys (baby.parents), including babies that were traded in and wild mates. */
  creature?: CreatureLookup;
  /** Precomputed buildLegacy(friend, babies, creature) result; computed when omitted. */
  legacy?: Legacy;
  /** Tapping a kept baby, e.g. to open its DNA card. Omit for a read-only tree. */
  onSelect?: (baby: Creature) => void;
  disabled?: boolean;
  reducedMotion?: boolean;
  className?: string;
}>;

const shortName = (creature: Creature) => creature.tokenId !== undefined ? `#${creature.tokenId}` : creature.name;

/** 16 cells, one per pixel row, lit where the row traces back to the Friend. */
export function RowStrip({ rows, className }: { rows: readonly boolean[]; className?: string }) {
  return <span className={cx("rb-rowstrip", className)} aria-hidden="true">
    {rows.slice(0, FRAME_SIZE).map((mine, row) => <i key={row} className={mine ? "rb-on" : undefined} />)}
  </span>;
}

type NodeProps = Readonly<{ node: LegacyNode; rowsOf: (creature: Creature) => readonly boolean[]; onSelect?: (baby: Creature) => void; disabled?: boolean; reducedMotion?: boolean }>;

function Node({ node, rowsOf, onSelect, disabled, reducedMotion }: NodeProps) {
  const { creature, mate, children } = node;
  const kept = node.role === "kept", mine = node.friendRows;
  const rows = rowsOf(creature);
  const label = `${creature.name}, ${tierLabel(creature.tier)}, ${lineageLabel(creature)}, ${mine} of 16 rows from your Friend` +
    (mate ? `, mate ${mate.name}` : "") + (kept ? "" : ", traded in");
  const body = <>
    <span className="rb-slot rb-tree-thumb"><SpriteThumb creature={creature} scale={2} animate={false} reducedMotion={reducedMotion} label="" /></span>
    <span className="rb-tree-text">
      <span className="rb-tree-name">{creature.name}</span>
      <span className="rb-tree-meta"><span className="rb-tier-dot" aria-hidden="true" />{lineageLabel(creature)} · {kept ? tierLabel(creature.tier) : "Traded in"}</span>
    </span>
    {mate && <span className="rb-tree-mate" aria-hidden="true">
      <span className="rb-tree-mate-x">×</span>
      <span className="rb-slot rb-tree-mate-thumb"><SpriteThumb creature={mate} scale={1} animate={false} reducedMotion={reducedMotion} label="" /></span>
      <span className="rb-tree-mate-name">{shortName(mate)}</span>
    </span>}
    <span className="rb-tree-rows" aria-hidden="true"><RowStrip rows={rows} /><span>{mine}/16</span></span>
  </>;
  return <li className="rb-tree-node">
    {kept && onSelect
      ? <button type="button" className={cx("rb-tree-item", `rb-tier-${creature.tier ?? "common"}`)} style={tierVars(creature.tier)}
        onClick={() => onSelect(creature)} disabled={disabled} aria-label={`${label}. Open DNA card`}>{body}</button>
      : <div className={cx("rb-tree-item", `rb-tier-${creature.tier ?? "common"}`, !kept && "rb-tree-ghost")} style={tierVars(creature.tier)}
        role="img" aria-label={label}>{body}</div>}
    {children.length > 0 && <ul className="rb-tree-sub">
      {children.map(child => <Node key={child.creature.key} node={child} rowsOf={rowsOf} onSelect={onSelect} disabled={disabled} reducedMotion={reducedMotion} />)}
    </ul>}
  </li>;
}

/**
 * Compact family tree rooted at the player's Friend: every kept baby under the parent that links it to the
 * Friend, its mate beside it, and a 16 cell strip of the rows that are the Friend's own. Scrolls sideways
 * when the family gets deep.
 */
export function LegacyTree({ friend, babies, creature, legacy, onSelect, disabled, reducedMotion, className }: LegacyTreeProps) {
  const nodes = useMemo(() => (legacy ?? buildLegacy(friend, babies, creature ?? (() => null))).tree.children, [legacy, friend, babies, creature]);
  // Same lookup as buildLegacy: brood entries first, then the resolver.
  const rowsOf = useMemo(() => {
    const kept = new Map(babies.map(baby => [baby.key, baby]));
    const find = (key: string) => key === friend.key ? friend : kept.get(key) ?? creature?.(key) ?? null;
    const memo = new Map<string, readonly boolean[]>();
    return (baby: Creature) => {
      let rows = memo.get(baby.key);
      if (!rows) memo.set(baby.key, rows = rowOrigins(baby, find).map(key => key === friend.key));
      return rows;
    };
  }, [friend, babies, creature]);
  return <div className={cx("rb-tree", className)}>
    <div className="rb-tree-root">
      <span className="rb-slot rb-tree-thumb"><SpriteThumb creature={friend} scale={2} clip="walk" reducedMotion={reducedMotion} label="" /></span>
      <span className="rb-tree-text">
        <span className="rb-tree-name">{friend.name}</span>
        <span className="rb-tree-meta"><PixelIcon name="heart" />Your Friend · {friend.family}</span>
      </span>
    </div>
    {nodes.length > 0 ? <ul className="rb-tree-sub" aria-label={`${friend.name}'s descendants`}>
      {nodes.map(node => <Node key={node.creature.key} node={node} rowsOf={rowsOf} onSelect={onSelect} disabled={disabled} reducedMotion={reducedMotion} />)}
    </ul> : <p className="rb-tree-empty rb-muted">No babies yet. Every baby you keep grows a branch here.</p>}
  </div>;
}
