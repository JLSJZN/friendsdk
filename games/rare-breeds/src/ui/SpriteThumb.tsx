import { useEffect, useMemo, useRef } from "react";
import { accessoryPixels } from "../accessories.ts";
import { drawCreature } from "../draw.ts";
import { FRAME_SIZE, type Clip, type Creature, type Facing } from "../types.ts";
import { cx, hashString, pixelMetrics, subscribeTick, useCompact, useDevicePixelRatio, useReducedMotion } from "./shared.ts";

export type SpriteThumbProps = Readonly<{
  creature: Creature;
  /** Integer CSS pixels per sprite pixel. Default 3 (a 54 px box including the 1 sprite pixel halo; taller with a hat).
   *  On fractional device pixel ratios the box snaps slightly so every sprite pixel stays crisp. */
  scale?: number;
  /** Optional smaller integer scale used when the game area is phone sized (under 600 wide or 480 tall). */
  compactScale?: number;
  clip?: Clip;
  facing?: Facing;
  /** Animate the 8-frame clip. Ignored (frame 0, no shimmer) when reduced motion is on. Default true. */
  animate?: boolean;
  /** Explicit override; defaults to the nearest GameRoot's setting, then the OS preference. */
  reducedMotion?: boolean;
  /** Milliseconds per animation frame. Default 110 (same as the SDK world). */
  frameMs?: number;
  ink?: string;
  halo?: string | null;
  /** Accessible name. Defaults to the creature name; pass "" for a decorative thumbnail. */
  label?: string;
  className?: string;
}>;

/**
 * Extra sprite pixels the box needs around the 16 x 16 frame for an accessory (a hat can rise up to 8 rows
 * above the head): the union over the clip's 8 frames, symmetric left and right so the body stays centred.
 * Without an accessory it is the usual 1 pixel halo on every side.
 */
function boxMargins(creature: Creature, clip: Clip, facing: Facing) {
  let side = 1, top = 1;
  if (creature.accessory) for (let frame = 0; frame < 8; frame++) {
    for (const cell of accessoryPixels(creature.sheet, clip, facing, frame, creature.accessory)) {
      side = Math.max(side, 1 - cell.x, cell.x - (FRAME_SIZE - 2));
      top = Math.max(top, 1 - cell.y);
    }
  }
  return { side, top };
}

/** A crisp, animated canvas portrait of a Creature, drawn with the shared drawCreature (accessory included). */
export function SpriteThumb({ creature, scale = 3, compactScale, clip = "idle", facing = "down", animate = true,
  reducedMotion, frameMs = 110, ink, halo, label, className }: SpriteThumbProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const compact = useCompact(canvas);
  const reduced = useReducedMotion(reducedMotion);
  const ratio = useDevicePixelRatio();
  const size = Math.max(1, Math.round(compact && compactScale ? compactScale : scale));
  // The box includes the 1 sprite pixel halo on every side; `device` is device pixels per sprite pixel.
  const { device, css } = pixelMetrics(size, ratio);
  const { side, top } = useMemo(() => boxMargins(creature, clip, facing), [creature, clip, facing]);
  const width = (FRAME_SIZE + 2 * side) * device, height = (FRAME_SIZE + top + 1) * device;

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    element.width = width;
    element.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // Offset each creature's cycle so a grid of thumbnails does not bob in lockstep.
    const phase = hashString(creature.key) % 8;
    const shimmer = creature.tier === "prismatic" && !!creature.dna?.pattern.some(Boolean);
    let last = -1, visible = true;
    const paint = (frame: number, time: number) => {
      ctx.clearRect(0, 0, width, height);
      drawCreature(ctx, creature, { clip, facing, frame, x: (FRAME_SIZE / 2 + side) * device, y: (FRAME_SIZE + top) * device, scale: device, ink, halo, time });
    };
    paint(0, 0);
    if (!animate || reduced) return;
    const observer = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); });
    observer?.observe(element);
    const stop = subscribeTick(now => {
      if (!visible) return;
      const frame = (Math.floor(now / frameMs) + phase) % 8;
      if (frame === last && !shimmer) return;
      last = frame;
      paint(frame, now);
    });
    return () => { stop(); observer?.disconnect(); };
  }, [creature, width, height, side, top, device, clip, facing, animate, reduced, frameMs, ink, halo]);

  const name = label ?? creature.name;
  return <canvas ref={canvas} className={cx("rb-thumb", className)}
    style={{ width: (FRAME_SIZE + 2 * side) * css, height: (FRAME_SIZE + top + 1) * css }} role={name ? "img" : undefined} aria-label={name || undefined} aria-hidden={name ? undefined : true} />;
}
