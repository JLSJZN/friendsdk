// Cached creature frames. Each frame is rendered once with the shared drawCreature at scale 1
// (18 x 18 including the halo) and blitted with nearest-neighbour scaling afterwards.
import { drawCreature } from "../draw.ts";
import { FRAME_SIZE, type Clip, type Creature, type Facing } from "../types.ts";
import { INK, WHITE, makeCanvas } from "./art.ts";

const CELL = FRAME_SIZE + 2;
const frames = new WeakMap<Creature, Map<string, HTMLCanvasElement>>();
const plainCopies = new WeakMap<Creature, Creature>();

/** The creature without its tier pattern (used before the hatch reveal colours it in). */
export function withoutPattern(creature: Creature): Creature {
  if (!creature.dna) return creature;
  let copy = plainCopies.get(creature);
  if (!copy) {
    copy = Object.freeze({ ...creature, dna: Object.freeze({ ...creature.dna, pattern: new Uint8Array(0) }) });
    plainCopies.set(creature, copy);
  }
  return copy;
}

export function creatureFrame(creature: Creature, clip: Clip, facing: Facing, frame: number, ink = INK, halo: string | null = WHITE) {
  let byKey = frames.get(creature);
  if (!byKey) { byKey = new Map(); frames.set(creature, byKey); }
  const key = `${clip}|${facing}|${frame & 7}|${ink}|${halo}`;
  let canvas = byKey.get(key);
  if (!canvas) {
    const made = makeCanvas(CELL, CELL);
    drawCreature(made.ctx, creature, { clip, facing, frame: frame & 7, x: CELL / 2, y: CELL - 1, scale: 1, ink, halo, time: 0 });
    canvas = made.canvas;
    byKey.set(key, canvas);
  }
  return canvas;
}

export type PaintCreature = Readonly<{
  clip: Clip; facing: Facing; frame: number;
  /** Feet anchor in logical pixels. */
  x: number; y: number;
  scale: number;
  alpha?: number;
  /** Squash / stretch multipliers around the feet anchor (1 = none). */
  sx?: number; sy?: number;
  time?: number;
  ink?: string; halo?: string | null;
  /** Draw the tier pattern (default true). */
  pattern?: boolean;
}>;

/** Draws a creature with the canonical sticker look. Prismatic patterns shimmer live when unsquashed. */
export function paintCreature(ctx: CanvasRenderingContext2D, creature: Creature, options: PaintCreature) {
  const { clip, facing, frame, x, y, scale, alpha = 1, sx = 1, sy = 1, time = 0, ink = INK, halo = WHITE, pattern = true } = options;
  if (alpha <= 0.001) return;
  const source = pattern ? creature : withoutPattern(creature);
  const live = pattern && creature.tier === "prismatic" && !!creature.dna?.pattern.length && sx === 1 && sy === 1 && ink === INK;
  if (live) {
    drawCreature(ctx, creature, { clip, facing, frame, x, y, scale, ink, halo, time, alpha });
    return;
  }
  const canvas = creatureFrame(source, clip, facing, frame, ink, halo);
  const w = Math.max(1, Math.round(CELL * scale * sx)), h = Math.max(1, Math.round(CELL * scale * sy));
  // Feet anchor: bottom of the 16 px box sits one halo pixel above the cell bottom.
  const left = Math.round(x - w / 2), top = Math.round(y + scale * sy - h);
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = previous * alpha;
  ctx.drawImage(canvas, left, top, w, h);
  ctx.globalAlpha = previous;
}

/** Row of the lowest ink pixel of a frame (feet), used to seat shadows. */
export function feetRow(creature: Creature) {
  const pixels = creature.sheet.idle.down[0];
  for (let y = FRAME_SIZE - 1; y >= 0; y--) for (let x = 0; x < FRAME_SIZE; x++) if (pixels[y * FRAME_SIZE + x]) return y;
  return FRAME_SIZE - 1;
}

/** Horizontal ink extent of the idle frame, used for shadow width. */
export function inkSpan(creature: Creature) {
  const pixels = creature.sheet.idle.down[0];
  let min = FRAME_SIZE, max = -1;
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) { const x = i % FRAME_SIZE; if (x < min) min = x; if (x > max) max = x; }
  return max < 0 ? { min: 4, max: 11 } : { min, max };
}
