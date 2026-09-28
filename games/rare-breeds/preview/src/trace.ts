// Pixel provenance on the lab's baby card: a baby's row y is always row y of one parent, so every row, through any
// number of generations, is one real on-chain Friend's row. rowPath and rowSources (src/legacy.ts) do the tracing, as
// in the game's cards (src/ui/Provenance.tsx); this file only words and draws it for the page.
import { drawCreature, setupPixelCanvas } from "../../src/draw.ts";
import type { RowOrigin, RowPath, RowSource } from "../../src/legacy.ts";
import { FRAME_SIZE, type Creature } from "../../src/types.ts";

/** The first card's tip, as in the game. */
export const TRACE_HINT = "Tap a row to see which real Friend it came from.";

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

/** "#77949" for a Friend; otherwise its name, or its family when the lookup lost it. */
const originLabel = (origin: RowOrigin) => origin.tokenId !== undefined ? `#${origin.tokenId}` : origin.creature?.name ?? origin.family;

/** "Row 5 of Tofu: Friend #4411 (Hollow) via Pip (F1)", or ", from Parent B" for an F1. */
export function pathText(path: RowPath, baby: Creature) {
  const first = path.steps[0], via = path.steps.slice(1).map(step => `${step.creature.name} (F${step.generation})`);
  const origin = path.origin.creature ? (path.origin.tokenId !== undefined ? `Friend #${path.origin.tokenId}` : path.origin.creature.name) : `an unknown ${path.origin.family} ancestor`;
  const tail = via.length ? ` via ${via.length > 1 ? `${via.slice(0, -1).join(", ")} and ${via[via.length - 1]}` : via[0]}` : first ? `, from Parent ${first.side ? "B" : "A"}` : "";
  return `<b>Row ${path.row + 1}</b> of ${escapeHtml(baby.name)}: <b>${escapeHtml(origin)}</b> (${escapeHtml(path.origin.family)})${escapeHtml(tail)}.`;
}

/** "Rows from 3 real Friends: #77949 x10 · #4411 x4 · #812 x2", most rows first. */
export function sourcesText(sources: readonly RowSource[]) {
  const friends = sources.filter(source => source.tokenId !== undefined).length;
  return `Rows from ${friends} real ${friends === 1 ? "Friend" : "Friends"}: ${sources.map(source => `${escapeHtml(originLabel(source))} x${source.rows.length}`).join(" · ")}`;
}

/** The chain a row took, traced baby first: each baby it passed through, then the real Friend, with the side it came in by. */
export function chainOf(path: RowPath) {
  const links = path.steps.map((step, i) => ({ creature: step.creature, label: `${step.creature.name} F${step.generation}`, side: i ? path.steps[i - 1].side : null }));
  if (path.origin.creature) links.push({ creature: path.origin.creature, label: originLabel(path.origin), side: path.steps.at(-1)?.side ?? null });
  return links;
}

/**
 * A still portrait with row `row` lit (a signal band behind it, ink rules above and below). A Side-walker line shows its
 * right-facing frames, because that is what its rows are copied from.
 */
export function paintTraced(canvas: HTMLCanvasElement, creature: Creature, row: number, sideWalker: boolean, scale = 3) {
  const box = (FRAME_SIZE + 2) * scale;
  const { ctx } = setupPixelCanvas(canvas, box, box);
  ctx.clearRect(0, 0, box, box);
  ctx.fillStyle = "rgba(204, 255, 0, .7)";
  ctx.fillRect(0, (1 + row) * scale, box, scale);
  drawCreature(ctx, creature, { clip: "idle", facing: sideWalker ? "right" : "down", frame: 0, x: box / 2, y: box - scale, scale, accessory: null });
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, (1 + row) * scale - 1, box, 1);
  ctx.fillRect(0, (2 + row) * scale, box, 1);
}
