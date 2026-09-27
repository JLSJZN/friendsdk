import type { TierId } from "../types.ts";
import { ALL_BREEDS, ALL_FAMILIES, ALL_TIERS, familiesComplete, tiersComplete, type Collection } from "./collection.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { cx, tierLabel, tierVars } from "./shared.ts";

export type CollectionMeterProps = Readonly<{
  collection: Collection;
  /** Short explainer under the meters on wide layouts. Default true. */
  hint?: boolean;
  className?: string;
}>;

type Row = Readonly<{ id: string; label: string; items: readonly Readonly<{ key: string; name: string; found: boolean; tier?: TierId }>[]; complete: boolean }>;

/**
 * Collection progress: families bred (of 9) and tiers found (of 4). Wide layouts show named chips,
 * compact layouts turn them into pips (names stay available to screen readers). A finished set gets a badge.
 * Below them, the breed count (of 45) and a collapsible breed book in family order: found names over their family
 * pair, and for the rest the dimmed pair with "???", so the book says which parents to try.
 */
export function CollectionMeter({ collection, hint = true, className }: CollectionMeterProps) {
  const rows: Row[] = [
    { id: "families", label: "Families", complete: familiesComplete(collection),
      items: ALL_FAMILIES.map(name => ({ key: name, name, found: collection.families.includes(name) })) },
    { id: "tiers", label: "Tiers", complete: tiersComplete(collection),
      items: ALL_TIERS.map(tier => ({ key: tier, name: tierLabel(tier), found: collection.tiers.includes(tier), tier })) },
  ];
  return <section className={cx("rb-collection", className)} aria-label="Collection">
    {rows.map(row => {
      const found = row.items.filter(item => item.found).length;
      return <div key={row.id} className={cx("rb-collection-row", `rb-collection-${row.id}`, row.complete && "rb-collection-done")}>
        <p className="rb-collection-label">
          <span>{row.label}</span>
          <strong className="rb-collection-count">{found}<span>/{row.items.length}</span></strong>
          {row.complete && <span className="rb-set-badge"><PixelIcon name="sparkle" />Set complete</span>}
        </p>
        <ul className="rb-collection-items" aria-label={`${row.label}: ${found} of ${row.items.length}`}>
          {row.items.map(item => <li key={item.key} className={cx("rb-collection-item", item.found && "rb-found", item.tier && `rb-tier-${item.tier}`)}
            style={item.tier ? tierVars(item.tier) : undefined} title={`${item.name}${item.found ? "" : " (not yet)"}`}>
            <span className="rb-collection-name">{item.name}</span>
            <span className="rb-sr-only">{item.found ? ", found" : ", not yet"}</span>
          </li>)}
        </ul>
      </div>;
    })}
    <div className="rb-collection-row rb-collection-breeds">
      <p className="rb-collection-label">
        <span>Breeds</span>
        <strong className="rb-collection-count">{collection.breeds.length}<span>/{ALL_BREEDS.length}</span></strong>
      </p>
      <details className="rb-breed-book">
        <summary>Breed book</summary>
        <ul aria-label={`Breeds found: ${collection.breeds.length} of ${ALL_BREEDS.length}`}>
          {ALL_BREEDS.map(breed => {
            const found = collection.breeds.includes(breed.name), pair = breed.families[0] === breed.families[1] ? `Pure ${breed.families[0]}` : breed.families.join(" × ");
            return <li key={breed.name} className={cx(found && "rb-found")}>
              {found ? <><strong>{breed.name}</strong><span className="rb-breed-pair"><span className="rb-sr-only">, </span>{pair}</span></>
                : <><span className="rb-breed-pair">{pair}</span><span className="rb-breed-unknown" aria-hidden="true"> ???</span><span className="rb-sr-only">, not found yet</span></>}
            </li>;
          })}
        </ul>
      </details>
    </div>
    {hint && <p className="rb-collection-hint">Both families in a baby's family line count. Tiers come from the hatch odds. Every family pair is a named breed.</p>}
  </section>;
}
