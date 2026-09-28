// The dream bubble over the player's Friend: a 1-bit thought cloud (lavender paper, ink edge) with the dream child walking
// inside it in violet ink (src/dream.ts), floating gently; still with reduced motion. Browser only, presentation only.
import type { Creature } from "../types.ts";
import { HEART, INK, WHITE, ellipse } from "./art.ts";
import { paintCreature } from "./creatures.ts";
import type { Rect } from "./room.ts";

/** Same pair as the UI's DREAM_PAPER / DREAM_INK (src/ui/DreamPanel.tsx). */
const DREAM_PAPER = "#EFE9FF", DREAM_INK = "#4B34B8";

/** The cloud in sprite cells around its centre: a wide body and two bumps on top (rx, ry, dx, dy). */
const PUFFS: readonly (readonly [number, number, number, number])[] = [[13, 10, 0, 1], [6, 5, -5, -7], [6, 5, 5, -8]];

export type DreamBubble = Readonly<{
  child: Creature;
  /** Head of the Friend (logical px): the small trailing puffs point there. */
  headX: number; headY: number;
  /** The visible region (logical px) the bubble stays inside. */
  left: number; top: number; right: number;
  /** Logical px per sprite cell (an integer, so the pixels stay crisp). */
  cell: number;
  time: number; reducedMotion: boolean; alpha: number;
  /** The dream came true: a small heart in the corner. */
  solved: boolean;
}>;

/** Draws the bubble beside the Friend's head (right side, or left when the right edge is too close). Returns its tap box. */
export function drawDreamBubble(ctx: CanvasRenderingContext2D, bubble: DreamBubble): Rect {
  const { child, headX, headY, left, top, right, cell: c, time, reducedMotion, alpha, solved } = bubble;
  const float = reducedMotion ? 0 : Math.round(Math.sin(time / 650) * 1.5);
  // The cloud spans 15 cells either side of its centre and 15 up, 13 down (puffs aside).
  const half = 15 * c;
  const toRight = headX + 9 * c + 2 * half <= right - 4;
  const cx = Math.round(toRight ? headX + 9 * c + half : Math.max(left + 4 + half, headX - 9 * c - half));
  const cy = Math.round(Math.max(top + 4 + half, headY - 20 * c) + float);
  const side = toRight ? -1 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(c, c);
  // Outline first (one cell wider), then the paper, so the three puffs read as one cloud.
  for (const [rx, ry, dx, dy] of PUFFS) ellipse(ctx, dx, dy, rx + 1, ry + 1, INK);
  for (const [rx, ry, dx, dy] of PUFFS) ellipse(ctx, dx, dy, rx, ry, DREAM_PAPER);
  // Two small puffs trail down to the Friend's head.
  ellipse(ctx, side * 11, 13, 3, 2, INK); ellipse(ctx, side * 11, 13, 2, 1, DREAM_PAPER);
  ellipse(ctx, side * 15, 17, 1, 1, INK);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  // The child walks in place (frame 0 with reduced motion), feet on the cloud's lower half.
  const frame = reducedMotion ? 0 : Math.floor(time / 140) % 8;
  paintCreature(ctx, child, { clip: "walk", facing: "down", frame, x: cx, y: cy + 8 * c, scale: c, ink: DREAM_INK, halo: WHITE, accessory: null });
  if (solved) ctx.drawImage(HEART, cx + 8 * c, cy - 12 * c, HEART.width * c, HEART.height * c);
  ctx.restore();
  return [cx - half, cy - half, cx + half, cy + 13 * c];
}
