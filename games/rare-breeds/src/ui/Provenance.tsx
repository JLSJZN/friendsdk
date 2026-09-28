import type { CSSProperties, ReactNode } from "react";
import type { RowOrigin, RowPath, RowSource } from "../legacy.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { cx } from "./shared.ts";

// Pixel provenance: every pixel row of a baby, through any number of generations, is one real on-chain Friend's row
// (rowPath and rowSources in src/legacy.ts). The card's row sources line, and the DNA trio's caption for a traced row.

/** The DNA trio's tap hint wherever a row traces to its real Friend; lit up as the first result card's tip. */
export const TRACE_HINT = "Tap a row to see which real Friend it came from.";

/** "#77949" for a Friend or wild Friend; otherwise its name, or its family when the lookup lost it. */
export function originLabel(origin: RowOrigin) {
  return origin.tokenId !== undefined ? `#${origin.tokenId}` : origin.creature?.name ?? origin.family;
}

/** "your Friend #7730", "Friend #4411", or "an unknown Mask ancestor". */
function originName(origin: RowOrigin) {
  if (!origin.creature) return `an unknown ${origin.family} ancestor`;
  if (origin.tokenId === undefined) return origin.creature.name;
  return `${origin.creature.kind === "friend" ? "your " : ""}Friend #${origin.tokenId}`;
}

/** "Pip (F1)", "Rimi (F2) and Pip (F1)", "Tofu (F3), Rimi (F2) and Pip (F1)". */
function viaLabel(path: RowPath) {
  const names = path.steps.slice(1).map(step => `${step.creature.name} (F${step.generation})`);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

/**
 * Where a baby's 16 rows come from, most rows first. Your own Friend leads, lit: "5 of 16 rows are your Friend #7730",
 * then the rest ("rest from #262837 x7 · #308601 x4"). Without a row of your Friend: "Rows from 3 real Friends: ...".
 */
export function RowSources({ sources }: { sources: readonly RowSource[] }) {
  const own = sources.find(source => source.creature?.kind === "friend" && source.tokenId !== undefined);
  const rest = sources.filter(source => source !== own), friends = sources.filter(source => source.tokenId !== undefined).length;
  const list = rest.map((source, index) => <span key={source.key}>{index > 0 && <span aria-hidden="true"> · </span>}
    <span className="rb-prov-source">{originLabel(source)} x{source.rows.length}</span></span>);
  if (!own) return <span><span>Rows from {friends} real {friends === 1 ? "Friend" : "Friends"}:</span>{" "}{list}</span>;
  return <span>
    <strong className="rb-prov-own"><PixelIcon name="heart" pixel={1} />{own.rows.length} of 16 rows are your Friend #{String(own.tokenId)}</strong>
    {rest.length > 0 && <>{" "}<span className="rb-prov-rest">rest from {list}</span></>}
  </span>;
}

/**
 * A traced baby row: the path, "Row 5 of Zibu: Friend #4411 (Hollow) via Pip (F1)", after the origin Friend's
 * `portrait` (drawn by the trio with that row lit) when given. The swatch is the side the row came in by
 * (PARENT_TINT); `note` (violet) says when the row carries an inherited shape or mutated. The tightest frames drop
 * the baby's name and the family (.rb-prov-more), so the line keeps its height.
 */
export function RowPathNote({ path, baby, portrait, note }: { path: RowPath; baby: string; portrait?: ReactNode; note?: string }) {
  const first = path.steps[0], via = viaLabel(path);
  return <span className="rb-prov-path">
    {portrait && <span className={cx("rb-prov-portrait", first && `rb-prov-from-${first.side ? "b" : "a"}`)} style={{ "--rb-row": path.row } as CSSProperties}
      aria-hidden="true">{portrait}</span>}
    <span className="rb-prov-text">
      <strong>Row {path.row + 1}</strong><span className="rb-prov-more"> of {baby}</span>:{" "}
      {first && <i className={`rb-trio-swatch rb-trio-swatch-${first.side ? "b" : "a"} rb-prov-swatch`} aria-hidden="true" />}
      <strong>{originName(path.origin)}</strong><span className="rb-prov-more"> ({path.origin.family})</span>
      {via ? ` via ${via}` : first ? `, from Parent ${first.side ? "B" : "A"}` : ""}
      {note && <span className="rb-prov-note">{note}</span>}.
    </span>
  </span>;
}
