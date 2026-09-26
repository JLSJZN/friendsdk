// Cached creature frames. Each frame is rendered once with the shared drawCreature at scale 1 and blitted
// with nearest-neighbour scaling afterwards. A cell holds the 16 x 16 box, its one-pixel halo and room
// for a head accessory (up to 8 cells above the box and 2 either side, plus that accessory's halo).
import { accessoryPixels } from "../accessories.ts";
import { drawCreature } from "../draw.ts";
import { FRAME_SIZE, type AccessoryId, type Clip, type Creature, type Facing } from "../types.ts";
import { INK, WHITE, makeCanvas } from "./art.ts";

/** Where the 16 x 16 box sits inside a cell, and the cell size (sprite pixels). */
export const BOX_X = 3, BOX_Y = 9;
const CELL_W = FRAME_SIZE + BOX_X * 2, CELL_H = FRAME_SIZE + BOX_Y + 1;
/**
 * Frames are cached by what decides their pixels (sprite sheet, tier pattern, tier, accessory), not by
 * object identity, so a UI that hands over fresh creature objects (say, re-dressed on every render)
 * reuses the same frames, and a real change of hat or pattern can never show a stale one.
 */
const NO_PATTERN = {};
const frames = new WeakMap<object, WeakMap<object, Map<string, HTMLCanvasElement>>>();
const plainCopies = new WeakMap<Creature, Creature>();
const headrooms = new WeakMap<object, Map<AccessoryId, number>>();

function frameCache(creature: Creature) {
  let bySheet = frames.get(creature.sheet);
  if (!bySheet) { bySheet = new WeakMap(); frames.set(creature.sheet, bySheet); }
  const pattern = creature.dna?.pattern.length ? creature.dna.pattern : NO_PATTERN;
  let byKey = bySheet.get(pattern);
  if (!byKey) { byKey = new Map(); bySheet.set(pattern, byKey); }
  return byKey;
}

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

/** Cached frame (cell canvas). `accessory` overrides the creature's own (null: none). */
export function creatureFrame(creature: Creature, clip: Clip, facing: Facing, frame: number, ink = INK, halo: string | null = WHITE, accessory?: AccessoryId | null) {
  const byKey = frameCache(creature);
  const worn = accessory === undefined ? creature.accessory ?? null : accessory;
  const key = `${creature.tier ?? "common"}|${clip}|${facing}|${frame & 7}|${ink}|${halo}|${worn ?? ""}`;
  let canvas = byKey.get(key);
  if (!canvas) {
    const made = makeCanvas(CELL_W, CELL_H);
    drawCreature(made.ctx, creature, { clip, facing, frame: frame & 7, x: BOX_X + FRAME_SIZE / 2, y: BOX_Y + FRAME_SIZE, scale: 1, ink, halo, time: 0, accessory: worn });
    canvas = made.canvas;
    byKey.set(key, canvas);
  }
  return canvas;
}

/** Sprite cells the creature's accessory rises above its 16 x 16 box (0 without one, at most 8). */
export function headroom(creature: Creature) {
  const accessory = creature.accessory;
  if (!accessory) return 0;
  let bySheet = headrooms.get(creature.sheet);
  if (!bySheet) { bySheet = new Map(); headrooms.set(creature.sheet, bySheet); }
  let cached = bySheet.get(accessory);
  if (cached === undefined) {
    let top = 0;
    for (const clip of ["idle", "walk"] as const) for (let frame = 0; frame < 8; frame++) {
      for (const cell of accessoryPixels(creature.sheet, clip, "down", frame, accessory)) top = Math.min(top, cell.y);
    }
    cached = Math.min(8, -top);
    bySheet.set(accessory, cached);
  }
  return cached;
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
  /** Override the creature's own accessory; null draws none. */
  accessory?: AccessoryId | null;
}>;

/** Draws a creature with the canonical sticker look. Prismatic patterns shimmer live when unsquashed. */
export function paintCreature(ctx: CanvasRenderingContext2D, creature: Creature, options: PaintCreature) {
  const { clip, facing, frame, x, y, scale, alpha = 1, sx = 1, sy = 1, time = 0, ink = INK, halo = WHITE, pattern = true, accessory } = options;
  if (alpha <= 0.001) return;
  const source = pattern ? creature : withoutPattern(creature);
  const live = pattern && creature.tier === "prismatic" && !!creature.dna?.pattern.length && sx === 1 && sy === 1 && ink === INK;
  if (live) {
    drawCreature(ctx, creature, { clip, facing, frame, x, y, scale, ink, halo, time, alpha, accessory });
    return;
  }
  const canvas = creatureFrame(source, clip, facing, frame, ink, halo, accessory);
  const w = Math.max(1, Math.round(CELL_W * scale * sx)), h = Math.max(1, Math.round(CELL_H * scale * sy));
  // Feet anchor: the box is centred in the cell and its bottom sits one halo pixel above the cell bottom.
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
