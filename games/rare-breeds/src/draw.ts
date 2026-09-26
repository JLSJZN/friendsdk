// Shared creature drawing for the world renderer and UI thumbnails. Browser only (Canvas 2D).
import { accessoryPixels } from "./accessories.ts";
import { FRAME_SIZE, TIER_STYLE, type AccessoryId, type Clip, type Creature, type Facing } from "./types.ts";

export type DrawCreatureOptions = Readonly<{
  clip?: Clip;
  facing?: Facing;
  /** Animation frame 0-7. */
  frame?: number;
  /** Feet anchor: horizontal centre and bottom edge of the 16 x 16 box, in canvas pixels. */
  x: number;
  y: number;
  /** Integer canvas pixels per sprite pixel. */
  scale: number;
  ink?: string;
  /** One-sprite-pixel outline colour, null for none. */
  halo?: string | null;
  /** Milliseconds, drives the prismatic shimmer. */
  time?: number;
  alpha?: number;
  /** Override the creature's own accessory; null draws none. */
  accessory?: AccessoryId | null;
}>;

export function drawCreature(ctx: CanvasRenderingContext2D, creature: Creature, options: DrawCreatureOptions) {
  const { clip = "idle", facing = "down", frame = 0, x, y, scale, ink = "#111111", halo = "#ffffff", time = 0, alpha = 1 } = options;
  const accessory = options.accessory === undefined ? creature.accessory : options.accessory ?? undefined;
  const pixels = creature.sheet[clip][facing][frame & 7];
  const extras = accessory ? accessoryPixels(creature.sheet, clip, facing, frame & 7, accessory) : [];
  const pattern = creature.dna?.pattern;
  const tier = creature.tier ?? "common";
  const left = Math.round(x - (FRAME_SIZE / 2) * scale), top = Math.round(y - FRAME_SIZE * scale);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (halo) {
    ctx.fillStyle = halo;
    for (let i = 0; i < pixels.length; i++) if (pixels[i]) {
      const px = i % FRAME_SIZE, py = (i / FRAME_SIZE) | 0;
      ctx.fillRect(left + (px - 1) * scale, top + (py - 1) * scale, scale * 3, scale * 3);
    }
    for (const cell of extras) ctx.fillRect(left + (cell.x - 1) * scale, top + (cell.y - 1) * scale, scale * 3, scale * 3);
  }
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) {
    const px = i % FRAME_SIZE, py = (i / FRAME_SIZE) | 0;
    const accent = pattern && pattern[i];
    ctx.fillStyle = !accent ? ink : tier === "prismatic"
      ? `hsl(${(time / 8 + (px + py) * 22) % 360} 95% 58%)` : TIER_STYLE[tier].accent;
    ctx.fillRect(left + px * scale, top + py * scale, scale, scale);
  }
  for (const cell of extras) {
    ctx.fillStyle = cell.color;
    ctx.fillRect(left + cell.x * scale, top + cell.y * scale, scale, scale);
  }
  ctx.restore();
}

/** Canvas setup for crisp pixels at the device pixel ratio. Returns the logical-to-device scale. */
export function setupPixelCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return { ctx, ratio };
}
