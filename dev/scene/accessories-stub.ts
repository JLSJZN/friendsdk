// Dev-only: stands in for games/rare-breeds/src/accessories.ts inside the scene harness bundle (see serve.mjs).
// Everything is the real module; accessoryPixels falls back to simple stub hats when the real art returns
// nothing and the harness asked for hats (?hats=1), so hat heights, hitboxes and framing can be judged early.
import { accessoryPixels as realPixels, type AccessoryPixel } from "../../games/rare-breeds/src/accessories.ts";
import { FRAME_SIZE, type AccessoryId, type Clip, type Facing, type SpriteSheet } from "../../games/rare-breeds/src/types.ts";

export * from "../../games/rare-breeds/src/accessories.ts";

const INK = "#111111", GREEN = "#CCFF00", WHITE = "#FFFFFF";

/** Rows of a stub hat, bottom row first; "#" ink, "G" green, "w" white, "." empty. Centred on the head. */
const SHAPES: Readonly<Record<AccessoryId, { rows: readonly string[]; float?: number }>> = {
  "party-hat": { rows: ["#GGG#", ".#G#.", ".#G#.", "..#..", "..w.."] },
  "bow": { rows: ["#G.G#", "#GGG#", "#G.G#"] },
  "flower": { rows: [".G.", "GwG", ".G."] },
  "beanie": { rows: ["#####", "#GGG#", ".###.", "..w.."] },
  "headphones": { rows: ["#.....#", "#.....#", ".#####."] },
  "top-hat": { rows: ["#######", ".#GGG#.", ".#####.", ".#####.", ".#####."] },
  "crown": { rows: ["#GGGGG#", "#G#G#G#", "#.#.#.#"] },
  "halo": { rows: [".wwwww.", "w.....w", ".wwwww."], float: 2 },
};

function stubPixels(pixels: ArrayLike<number>, id: AccessoryId): AccessoryPixel[] {
  let top = FRAME_SIZE, min = FRAME_SIZE, max = -1;
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) top = Math.min(top, (i / FRAME_SIZE) | 0);
  if (top === FRAME_SIZE) return [];
  for (let x = 0; x < FRAME_SIZE; x++) if (pixels[top * FRAME_SIZE + x] || pixels[(top + 1) * FRAME_SIZE + x]) { min = Math.min(min, x); max = Math.max(max, x); }
  const centre = Math.round((min + max) / 2);
  const { rows, float = 0 } = SHAPES[id];
  const out: AccessoryPixel[] = [];
  rows.forEach((row, j) => {
    const y = top - 1 - j - float;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === ".") continue;
      const x = centre - (row.length >> 1) + i;
      out.push({ x, y: Math.max(-8, y), color: char === "#" ? INK : char === "G" ? GREEN : WHITE });
    }
  });
  return out;
}

export function accessoryPixels(sheet: SpriteSheet, clip: Clip, facing: Facing, frame: number, id: AccessoryId): readonly AccessoryPixel[] {
  const real = realPixels(sheet, clip, facing, frame, id);
  if (real.length || !(globalThis as { __stubHats?: boolean }).__stubHats) return real;
  return stubPixels(sheet[clip][facing][frame & 7], id);
}
