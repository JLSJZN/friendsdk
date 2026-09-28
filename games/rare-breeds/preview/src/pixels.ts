// Small pixel-art helpers for the page's own scenes, in the game's palette and lettering (src/scene/art.ts, font.ts).
import { GREEN, GRID, HEART, INK, MUTED, PAPER, SHADE, WHITE, clamp, makeCanvas, rect } from "../../src/scene/art.ts";
import { drawText, textWidth } from "../../src/scene/font.ts";
import { FRAME_SIZE, type Frame } from "../../src/types.ts";

export { GREEN, GRID, INK, MUTED, PAPER, SHADE, WHITE };
export const VIOLET = "#8A4DFF";
export const VIOLET_SOFT = "rgba(138, 77, 255, 0.28)";

/** Paper floor with the nursery's tile grid. */
export function paperFloor(ctx: CanvasRenderingContext2D, width: number, height: number, horizon = 0) {
  rect(ctx, 0, 0, width, height, PAPER);
  ctx.fillStyle = GRID;
  for (let x = 0; x <= width; x += 48) ctx.fillRect(x, horizon, 3, height - horizon);
  for (let y = horizon; y <= height; y += 48) ctx.fillRect(0, y, width, 3);
}

/** A soft ground shadow under feet at (x, y). */
export function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, halfWidth: number, alpha = 0.13) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK;
  const h = 9;
  for (let row = 0; row < h; row += 3) {
    const k = 1 - Math.abs(row - h / 2 + 1.5) / (h / 2 + 1);
    const w = Math.round(halfWidth * Math.sqrt(Math.max(0, k)) / 3) * 3;
    ctx.fillRect(Math.round(x - w), Math.round(y - h / 2 + row), w * 2, 3);
  }
  ctx.restore();
}

/** Pixel-font tag in a box: text centred on x, box top at y. Returns the box width. */
export function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, color = INK, scale = 3, border: string | null = INK) {
  const pad = scale * 2;
  const width = textWidth(text.toUpperCase(), scale) + pad * 2, height = 7 * scale + pad * 2;
  const left = Math.round(x - width / 2);
  if (border) rect(ctx, left - scale, y - scale, width + scale * 2, height + scale * 2, border);
  rect(ctx, left, y, width, height, fill);
  drawText(ctx, text, left + pad, y + pad, { scale, color });
  return width;
}

/** Plain pixel-font text (upper case), centred on x. */
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK, scale = 3, align: "left" | "center" | "right" = "center") {
  drawText(ctx, text, x, y, { scale, color, align });
}

/** One sprite row's ink pixels with the sticker halo. Box top-left at (left, top). */
export function drawRow(ctx: CanvasRenderingContext2D, frame: Frame, row: number, left: number, top: number, scale: number, ink = INK, halo: string | null = WHITE, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const y = top + row * scale;
  if (halo) {
    ctx.fillStyle = halo;
    for (let x = 0; x < FRAME_SIZE; x++) if (frame[row * FRAME_SIZE + x]) ctx.fillRect(left + (x - 1) * scale, y - scale, scale * 3, scale * 3);
  }
  ctx.fillStyle = ink;
  for (let x = 0; x < FRAME_SIZE; x++) if (frame[row * FRAME_SIZE + x]) ctx.fillRect(left + x * scale, y, scale, scale);
  ctx.restore();
}

/** Filled cells (sprite-space indices) drawn as flat squares, e.g. a shape in violet. */
export function drawCells(ctx: CanvasRenderingContext2D, cells: Iterable<number>, left: number, top: number, scale: number, color: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (const cell of cells) ctx.fillRect(left + (cell % FRAME_SIZE) * scale, top + ((cell / FRAME_SIZE) | 0) * scale, scale, scale);
  ctx.restore();
}

// ---------- The egg (same silhouette as the game's hatch: 24 x 30 egg pixels) ----------
const EGG_W = 24, EGG_H = 30, EGG_MID = 17;
const EGG_ROWS = Array.from({ length: EGG_H }, (_, y) => {
  const dy = (y + 0.5 - EGG_MID) / (y < EGG_MID ? EGG_MID : EGG_H - EGG_MID);
  return Math.max(0, Math.round((EGG_W / 2) * Math.sqrt(Math.max(0, 1 - dy * dy))));
});
export const CRACK_ROW = 14;
const CRACK = Array.from({ length: EGG_W }, (_, x) => [0, -1, -2, -1, 0, 1, 2, 1][x % 8]);
const SPOTS = [[7, 7], [15, 11], [9, 19], [16, 22], [6, 14], [12, 25]] as const;

function eggCanvas() {
  const { canvas, ctx } = makeCanvas(EGG_W + 2, EGG_H + 2);
  const inside = (x: number, y: number) => y >= 0 && y < EGG_H && Math.abs(x + 0.5 - EGG_W / 2) < EGG_ROWS[y];
  for (let y = 0; y < EGG_H; y++) for (let x = 0; x < EGG_W; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    rect(ctx, x + 1, y + 1, 1, 1, edge ? INK : x > EGG_W * 0.62 && y > 6 ? SHADE : WHITE);
  }
  for (const [sx, sy] of SPOTS) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (inside(sx + dx, sy + dy)) rect(ctx, sx + dx + 1, sy + dy + 1, 1, 1, GREEN);
  }
  // Shine.
  rect(ctx, 6, 5, 2, 3, WHITE);
  return canvas;
}
let egg: HTMLCanvasElement | null = null;

export type EggPose = Readonly<{
  /** Lean: each egg row slides sideways by lean x its height above the base (egg px). */
  lean: number;
  /** 0 to 1: how much of the crack is drawn, left to right. */
  crack: number;
  /** 0 to 1: the top shell lifts off and tumbles away. */
  open: number;
  alpha?: number;
}>;

/** The egg standing with its base centre at (x, y), `px` logical px per egg pixel. */
export function drawEgg(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, pose: EggPose) {
  egg ??= eggCanvas();
  const w = (EGG_W + 2) * px, top = y - (EGG_H + 1) * px, left = Math.round(x - w / 2);
  ctx.save();
  ctx.globalAlpha = pose.alpha ?? 1;
  for (let row = 0; row < EGG_H + 2; row++) {
    const aboveCrack = row <= CRACK_ROW + 1;
    const height = EGG_H + 1 - row;
    let dx = Math.round(pose.lean * height) * px, dy = 0;
    if (aboveCrack && pose.open > 0) { dy = -Math.round(pose.open * 34) * px; dx += Math.round(pose.open * 22) * px; }
    if (aboveCrack && pose.open >= 1) continue;
    ctx.drawImage(egg, 0, row, EGG_W + 2, 1, left + dx, top + row * px + dy, w, px);
  }
  // Crack zigzag across the shell.
  if (pose.crack > 0 && pose.open <= 0) {
    ctx.fillStyle = INK;
    const count = Math.round(clamp(pose.crack) * EGG_W);
    for (let cx = 0; cx < count; cx++) {
      const row = CRACK_ROW + CRACK[cx];
      if (Math.abs(cx + 0.5 - EGG_W / 2) >= EGG_ROWS[row]) continue;
      const height = EGG_H + 1 - (row + 1);
      ctx.fillRect(left + (cx + 1) * px + Math.round(pose.lean * height) * px, top + (row + 1) * px, px, px);
    }
  }
  ctx.restore();
}
export const EGG_SIZE = { w: EGG_W + 2, h: EGG_H + 2 } as const;

/** The game's small heart sprite (7 x 7 art px), bottom centre at (x, y). */
export function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(HEART, Math.round(x - (HEART.width * px) / 2), Math.round(y - HEART.height * px), HEART.width * px, HEART.height * px);
  ctx.restore();
}
