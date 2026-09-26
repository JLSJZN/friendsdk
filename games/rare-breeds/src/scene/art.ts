// Pixel art primitives shared by the nursery and the hatch overlay. Browser only (Canvas 2D).
// All helpers draw whole pixels in the current transform, so callers pick the pixel size with ctx.scale.

export const INK = "#111111";
export const PAPER = "#F4F1EA";
export const GRID = "#E6E1D6";
export const WHITE = "#FFFFFF";
export const GREEN = "#CCFF00";
export const MUTED = "#8C877D";
/** Slightly darker paper for wall panels and soft fills. */
export const SHADE = "#DAD4C7";
/** Deep green used only as an ink companion to the signal green (leaf veins, grass tufts). */
export const MOSS = "#7FA300";

/** Parent row tints: parent A glows signal green, parent B glows paper white. */
export const SOURCE_TINT = [GREEN, PAPER] as const;

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Filled box with a one pixel outline. Pass cut = true to trim the four corner pixels. */
export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string | null, line: string = INK, cut = false) {
  if (fill) rect(ctx, x + 1, y + 1, w - 2, h - 2, fill);
  rect(ctx, x + (cut ? 1 : 0), y, w - (cut ? 2 : 0), 1, line);
  rect(ctx, x + (cut ? 1 : 0), y + h - 1, w - (cut ? 2 : 0), 1, line);
  rect(ctx, x, y + 1, 1, h - 2, line);
  rect(ctx, x + w - 1, y + 1, 1, h - 2, line);
}

/** Pixel ellipse spans: calls span(y, x0, x1) for each row, inclusive bounds. */
function ellipseSpans(cx: number, cy: number, rx: number, ry: number, span: (y: number, x0: number, x1: number) => void) {
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
    if (t < 0) continue;
    const half = Math.floor((rx + 0.5) * Math.sqrt(t));
    span(cy + dy, cx - half, cx + half);
  }
}

export function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  ellipseSpans(cx, cy, rx, ry, (y, x0, x1) => ctx.fillRect(x0, y, x1 - x0 + 1, 1));
}

/** Filled ellipse with a one pixel outline (outline drawn as a slightly larger ellipse). */
export function ellipseBox(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill: string | null, line: string = INK) {
  ellipse(ctx, cx, cy, rx, ry, line);
  if (fill) ellipse(ctx, cx, cy, rx - 1, ry - 1, fill);
}

/** Checkerboard dither. density 2 = 50 %, 4 = 25 %, 8 = 12.5 %. */
export function ditherOn(px: number, py: number, density: 2 | 4 | 8, phase = 0) {
  py += phase;
  if (density === 2) return (px + py) % 2 === 0;
  if (density === 4) return py % 2 === 0 && (px + ((py >> 1) & 1)) % 2 === 0;
  return py % 2 === 0 && (px + ((py >> 1) & 1) * 2) % 4 === 0;
}

export function dither(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, density: 2 | 4 | 8 = 2, phase = 0) {
  ctx.fillStyle = color;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (ditherOn(x + i, y + j, density, phase)) ctx.fillRect(x + i, y + j, 1, 1);
  }
}

/** Dithered ellipse, used for soft pixel shadows. */
export function ditherEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, density: 2 | 4 | 8 = 2) {
  ctx.fillStyle = color;
  ellipseSpans(cx, cy, rx, ry, (y, x0, x1) => {
    for (let x = x0; x <= x1; x++) if (ditherOn(x, y, density)) ctx.fillRect(x, y, 1, 1);
  });
}

export type Palette = Readonly<Record<string, string>>;
export const ART_PALETTE: Palette = {
  "#": INK, w: WHITE, p: PAPER, g: GRID, s: SHADE, m: MUTED, G: GREEN, v: MOSS,
};

/**
 * Parse ASCII pixel art into a canvas at 1 canvas pixel per art pixel.
 * "." (and space) is transparent, ":" is a 50 % ink dither, other characters map through the palette.
 */
export function bitmap(rows: readonly string[], palette: Palette = ART_PALETTE) {
  const width = Math.max(...rows.map(row => row.length));
  const { canvas, ctx } = makeCanvas(width, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const char = row[x];
      if (char === "." || char === " ") continue;
      if (char === ":") { if ((x + y) % 2 === 0) rect(ctx, x, y, 1, 1, INK); continue; }
      const color = palette[char];
      if (color) rect(ctx, x, y, 1, 1, color);
    }
  });
  return canvas;
}

// Small shared sprites (art pixels).
export const HEART = bitmap([
  ".##.##.",
  "#GG#GG#",
  "#GGGGG#",
  "#GGGGG#",
  ".#GGG#.",
  "..#G#..",
  "...#...",
]);
export const HEART_WHITE = bitmap([
  ".##.##.",
  "#ww#ww#",
  "#wwwww#",
  "#wwwww#",
  ".#www#.",
  "..#w#..",
  "...#...",
]);

// Easing.
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp(t), 3);
export const easeOutBack = (t: number, s = 1.70158) => { t = clamp(t) - 1; return 1 + (s + 1) * t * t * t + s * t * t; };

/** Deterministic small PRNG (mulberry32) so ambient effects look the same on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
