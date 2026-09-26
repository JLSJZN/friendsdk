// The hatch overlay: egg wobble -> crack -> parent pixel rows fly in and merge -> tier reveal.
import { WORLD_HEIGHT as H, WORLD_WIDTH as W, type HatchSequence, type HatchSequenceOptions } from "../api.ts";
import { FRAME_SIZE, TIER_STYLE, type Creature, type Facing, type Frame, type TierId } from "../types.ts";
import {
  GREEN, INK, MUTED, PAPER, SHADE, SOURCE_TINT, WHITE, clamp, easeInCubic, easeOutBack, easeOutCubic, ellipse, lerp, makeCanvas, rect,
} from "./art.ts";
import { paintCreature, withoutPattern } from "./creatures.ts";
import { drawText, textWidth } from "./font.ts";
import { createParticles } from "./fx.ts";
import { createPixelView } from "./view.ts";

type Beat = "wobble" | "crack" | "merge" | "reveal";

// Timeline (ms).
const T = {
  parentsIn: 120, eggDrop: 220, eggLand: 620,
  wobbles: [[640, 300, 2, 1], [1040, 320, 3, 2], [1420, 330, 4, 3]] as const, // start, duration, swings, amplitude
  crack: 1780, crackDraw: 240, burst: 2080,
  rows: 2180, rowStagger: 58, rowFlight: 470,
  mutations: 3560, mutationStagger: 70,
  reveal: 3820, end: 4750,
};
const PARENT_SCALE = 7, BABY_SCALE = 11;
const A_POS = { x: 186, y: 452 }, B_POS = { x: 774, y: 452 }, BABY_POS = { x: 480, y: 454 };
const EGG_PX = 5, EGG_W = 24, EGG_H = 30, EGG_MID = 17;

/** Egg silhouette: half width per row (taller top, rounder bottom). */
const EGG_ROWS = Array.from({ length: EGG_H }, (_, y) => {
  const dy = (y + 0.5 - EGG_MID) / (y < EGG_MID ? EGG_MID : EGG_H - EGG_MID);
  return Math.max(0, Math.round((EGG_W / 2) * Math.sqrt(Math.max(0, 1 - dy * dy))));
});
const CRACK_ROW = 14;
/** Zigzag crack: row offset per egg column. */
const CRACK = Array.from({ length: EGG_W }, (_, x) => [0, -1, -2, -1, 0, 1, 2, 1][x % 8]);

function tierColors(tier: TierId) {
  const style = TIER_STYLE[tier];
  if (tier === "prismatic") return { glow: style.glow!, label: style.accent };
  if (tier === "common") return { glow: WHITE, label: PAPER };
  return { glow: style.glow ?? WHITE, label: style.glow ?? style.accent };
}

/** Pixels of the baby's display frame, split into row pixels and mutation cells. */
function babyPixels(baby: Creature) {
  const frame = baby.sheet.idle.down[0];
  const mutations = new Set(baby.dna?.mutations ?? []);
  const rows: number[][] = Array.from({ length: FRAME_SIZE }, () => []);
  const cells: number[] = [];
  for (let i = 0; i < frame.length; i++) {
    if (!frame[i]) continue;
    if (mutations.has(i)) cells.push(i);
    else rows[(i / FRAME_SIZE) | 0].push(i % FRAME_SIZE);
  }
  return { frame, rows, cells };
}

export function createHatchSequence(options: HatchSequenceOptions): HatchSequence {
  const { canvas, parentA, parentB, baby, onBeat } = options;
  const reducedMotion = options.reducedMotion;
  let destroyed = false, dirty = true, raf = 0, last = 0;
  let t = 0, started = false, finished = false;
  let playPromise: Promise<void> | null = null, resolvePlay: (() => void) | null = null;
  const fired = new Set<string>();
  const view = createPixelView(canvas, W, H, () => { dirty = true; });
  const ctx = view.ctx;
  const fx = createParticles();
  const { rows, cells } = babyPixels(baby);
  const rowSource = baby.dna?.rowSource ?? Array.from({ length: FRAME_SIZE }, (_, r) => (r % 2) as 0 | 1);
  const tier: TierId = baby.tier ?? "common";
  const shards: { x: number; y: number; vx: number; vy: number; size: number; spin: number; life: number; age: number }[] = [];
  let shake = 0;
  const backdrop = paintBackdrop();
  const rays = makeCanvas(W / 3, H / 3);
  if (!canvas.hasAttribute("aria-label")) canvas.setAttribute("aria-label", `${baby.name} hatches from ${parentA.name} and ${parentB.name}.`);

  const beat = (name: Beat, id: string = name) => {
    if (fired.has(id)) return;
    fired.add(id);
    try { onBeat?.(name); } catch { /* sound errors must not break the show */ }
  };

  // ------------------------------------------------------------------------------------------
  // Drawing helpers

  function paintBackdrop() {
    const { canvas: art, ctx: g } = makeCanvas(W / 3, H / 3);
    const cx = W / 6, cy = H / 6 - 8;
    rect(g, 0, 0, art.width, art.height, "#0B0B0B");
    for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) {
      const d = Math.hypot((x - cx) / 1.35, y - cy);
      const glow = 1 - d / 110;
      if (glow > 0.62 && (x + y) % 2 === 0) rect(g, x, y, 1, 1, "#1E1E1E");
      else if (glow > 0.35 && x % 2 === 0 && y % 2 === 0) rect(g, x, y, 1, 1, "#1B1B1B");
      else if (glow > 0.05 && x % 4 === 0 && y % 4 === ((x / 4) % 2 ? 2 : 0)) rect(g, x, y, 1, 1, "#181818");
    }
    // Stage floor line.
    for (let x = 0; x < art.width; x += 2) rect(g, x, 152, 1, 1, "#262626");
    return art;
  }

  /** Paints one row of a parent's frame in a flat colour (the row being copied lights up). */
  function flashRow(frame: Frame, r: number, left: number, top: number, scale: number, color: string, alpha: number) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let x = 0; x < FRAME_SIZE; x++) if (frame[r * FRAME_SIZE + x]) ctx.fillRect(left + x * scale, top + r * scale, scale, scale);
    ctx.globalAlpha = 1;
  }

  function drawPixelRow(pixels: readonly number[], left: number, top: number, scale: number, ink: string, halo: string | null, alpha = 1) {
    const s = Math.max(1, Math.round(scale));
    ctx.globalAlpha = alpha;
    if (halo) { ctx.fillStyle = halo; for (const x of pixels) ctx.fillRect(Math.round(left + (x - 1) * scale), Math.round(top - scale), s * 3, s * 3); }
    ctx.fillStyle = ink;
    for (const x of pixels) ctx.fillRect(Math.round(left + x * scale), Math.round(top), s, s);
    ctx.globalAlpha = 1;
  }

  /** A row in flight: lit pixels in the parent's tint with a hairline gap, like LEDs. */
  function drawLitRow(pixels: readonly number[], left: number, top: number, scale: number, tint: string, alpha = 1) {
    const s = Math.max(2, Math.round(scale)), gap = s >= 8 ? 2 : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = INK;
    for (const x of pixels) ctx.fillRect(Math.round(left + x * scale) - 2, Math.round(top) - 2, s + 4, s + 4);
    ctx.fillStyle = tint;
    for (const x of pixels) ctx.fillRect(Math.round(left + x * scale) + gap / 2, Math.round(top) + gap / 2, s - gap, s - gap);
    ctx.globalAlpha = 1;
  }

  function drawEgg(cx: number, bottom: number, angle: number, crack: number, alpha = 1, part: "whole" | "top" | "bottom" = "whole", lift = 0) {
    const px = EGG_PX, left = Math.round(cx - (EGG_W / 2) * px);
    ctx.globalAlpha = alpha;
    const top = bottom - EGG_H * px;
    for (let y = 0; y < EGG_H; y++) {
      const half = EGG_ROWS[y];
      if (!half) continue;
      const shear = Math.round(Math.sin(angle) * (EGG_H - y) * 0.55);
      const rowY = top + y * px - (part === "top" ? lift : 0);
      for (let x = EGG_W / 2 - half; x < EGG_W / 2 + half; x++) {
        const crackAt = CRACK_ROW + CRACK[x];
        if (part === "top" && y > crackAt) continue;
        if (part === "bottom" && y <= crackAt) continue;
        const edge = x === EGG_W / 2 - half || x === EGG_W / 2 + half - 1 || !EGG_ROWS[y - 1] || EGG_ROWS[y - 1] < Math.abs(x + 0.5 - EGG_W / 2) + 0.5
          || y === EGG_H - 1 || (EGG_ROWS[y + 1] ?? 0) < Math.abs(x + 0.5 - EGG_W / 2) + 0.5;
        const shade = x > EGG_W / 2 + half - 5 && (x + y) % 2 === 0;
        const spot = (x - 7) ** 2 + (y - 8) ** 2 < 5 || (x - 15) ** 2 + (y - 13) ** 2 < 7 || (x - 9) ** 2 + (y - 21) ** 2 < 4 || (x - 17) ** 2 + (y - 23) ** 2 < 3;
        const shine = (x - 7) ** 2 * 0.6 + (y - 5) ** 2 < 5 && !spot;
        let color = edge ? INK : spot ? GREEN : shine ? WHITE : shade ? SHADE : "#FFFDF8";
        if (crack > 0 && (part === "whole") && y === crackAt && x < EGG_W * crack) color = INK;
        if (crack > 0 && part === "whole" && y === crackAt - 1 && x < EGG_W * crack && !edge) color = crack > 0.6 && (x + Math.floor(t / 60)) % 3 === 0 ? WHITE : GREEN;
        ctx.fillStyle = color;
        ctx.fillRect(left + (x + shear) * px, rowY, px, px);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTag(creature: Creature, x: number, y: number, tint: string, alpha: number) {
    const name = creature.name.toUpperCase();
    const width = textWidth(name, 2) + 18;
    ctx.globalAlpha = alpha;
    rect(ctx, Math.round(x - width / 2) - 2, y - 2, 14, 14, INK);
    rect(ctx, Math.round(x - width / 2), y, 10, 10, tint);
    drawText(ctx, name, x - width / 2 + 18, y - 2, { scale: 2, color: PAPER, outline: INK });
    drawText(ctx, creature.family.toUpperCase(), x, y + 20, { scale: 2, color: MUTED, align: "center", outline: INK });
    ctx.globalAlpha = 1;
  }

  function drawPedestal(x: number, y: number, tint: string, alpha: number) {
    ctx.save(); ctx.scale(3, 3); ctx.globalAlpha = alpha;
    const cx = Math.round(x / 3), cy = Math.round(y / 3);
    ellipse(ctx, cx, cy, 24, 5, tint);
    ellipse(ctx, cx, cy, 23, 4, "#1A1A1A");
    ellipse(ctx, cx, cy - 1, 21, 3, "#222222");
    ctx.restore();
  }

  // Rays and glow core are dithered in pure tier colours on the 3 px art grid (no muddy alpha blends).
  const RW = rays.canvas.width, RH = rays.canvas.height;
  const RCX = Math.round(BABY_POS.x / 3), RCY = Math.round((BABY_POS.y - 88) / 3);
  const turn = new Float32Array(RW * RH), reach = new Float32Array(RW * RH);
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    turn[y * RW + x] = (Math.atan2(y - RCY, x - RCX) / (Math.PI * 2) + 1) % 1;
    reach[y * RW + x] = Math.hypot((x - RCX) / 1.1, y - RCY);
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const image = rays.ctx.createImageData(RW, RH);
  const pixels = new Uint32Array(image.data.buffer);
  const pack = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (255 << 24 | (n & 0xff) << 16 | ((n >> 8) & 0xff) << 8 | (n >> 16)) >>> 0;
  };
  const hsl = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l);
    const f = (k: number) => { const c = (k + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(c - 3, 9 - c, 1)))); };
    return (255 << 24 | f(4) << 16 | f(8) << 8 | f(0)) >>> 0;
  };

  function drawRays(time: number, strength: number) {
    if (strength <= 0.01) return;
    const count = tier === "prismatic" ? 14 : tier === "mutant" ? 10 : tier === "spotted" ? 8 : 0;
    const spin = reducedMotion ? 0 : time / 16000;
    const pulse = reducedMotion ? 0 : Math.sin(time / 240) * 2;
    const glow = pack(TIER_STYLE[tier].glow ?? WHITE);
    const hues = Array.from({ length: 16 }, (_, i) => hsl((i * 360) / 16 + time / 12, 0.9, 0.62));
    const reachLimit = 30 + strength * 270;
    pixels.fill(0);
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const i = y * RW + x, d = reach[i];
      if (d > reachLimit) continue;
      const threshold = BAYER[(y & 3) * 4 + (x & 3)];
      const core = Math.max(0, 0.56 - Math.max(0, d - pulse - 16) / 52);
      let ray = -1, level = core;
      if (count && d > 14) {
        const slot = (turn[i] + spin) * count, frac = slot % 1;
        if (frac < 0.46) {
          const edge = Math.sqrt(Math.sin((frac / 0.46) * Math.PI));
          const rayLevel = 0.3 * edge * Math.max(0, 1 - d / 290);
          if (rayLevel > level) { level = rayLevel; ray = Math.floor(slot) % count; }
        }
      }
      if (level <= threshold) continue;
      pixels[i] = tier === "prismatic" ? hues[ray >= 0 ? (ray * 16 / count) | 0 : ((turn[i] * 16) | 0)] : glow;
    }
    rays.ctx.putImageData(image, 0, 0);
    ctx.globalAlpha = tier === "common" ? 0.55 * strength : Math.min(1, strength * 1.2);
    ctx.drawImage(rays.canvas, 0, 0, RW * 3, RH * 3);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------------------------------
  // Frame

  function render(time: number) {
    view.sync();
    view.begin(true);
    const rm = reducedMotion;
    const final = finished || time >= T.end;
    if (shake > 0 && !rm) { ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake)); }
    // Reduced motion: the finished composition simply fades in (element opacity, so no draw call can fight it).
    if (rm) canvas.style.opacity = time < 400 ? String(clamp(time / 380)) : "";

    // Backdrop.
    ctx.globalAlpha = rm ? 1 : clamp(time / 260) * 0.97;
    ctx.drawImage(backdrop, 0, 0, backdrop.width * 3, backdrop.height * 3);
    ctx.globalAlpha = 1;

    const revealT = rm ? 1 : clamp((time - T.reveal) / 900);
    const revealed = rm || time >= T.reveal;
    drawRays(time, revealed ? (rm ? 0.8 : easeOutCubic(revealT)) : 0);

    // Parents slide in from the sides.
    const slide = rm ? 1 : easeOutBack(clamp((time - T.parentsIn) / 520), 1.4);
    const ax = lerp(-140, A_POS.x, slide), bx = lerp(W + 140, B_POS.x, slide);
    const parentFrame = rm ? 0 : Math.floor(time / 160) % 8;
    const hopAt = (start: number, height: number, duration = 300) => {
      const k = (time - start) / duration;
      return k > 0 && k < 1 ? Math.sin(k * Math.PI) * height : 0;
    };
    const cheer = rm ? 0 : hopAt(T.wobbles[1][0], 10) + hopAt(T.crack, 16) + hopAt(T.reveal + 120, 24, 360) + hopAt(T.reveal + 520, 12, 280);
    const cheerB = rm ? 0 : hopAt(T.wobbles[2][0], 10) + hopAt(T.crack + 60, 16) + hopAt(T.reveal + 220, 24, 360) + hopAt(T.reveal + 620, 12, 280);
    const facingA: Facing = revealed ? "right" : "down", facingB: Facing = revealed ? "left" : "down";
    const tagAlpha = rm ? 1 : clamp((time - T.parentsIn - 300) / 300);
    drawPedestal(ax, A_POS.y - 3, SOURCE_TINT[0], tagAlpha);
    drawPedestal(bx, B_POS.y - 3, SOURCE_TINT[1], tagAlpha);
    paintCreature(ctx, parentA, { clip: "idle", facing: facingA, frame: parentFrame, x: ax, y: A_POS.y - cheer, scale: PARENT_SCALE, time });
    paintCreature(ctx, parentB, { clip: "idle", facing: facingB, frame: (parentFrame + 3) % 8, x: bx, y: B_POS.y - cheerB, scale: PARENT_SCALE, time });
    // Rows leaving a parent flash in its tint.
    if (!rm && time >= T.rows && time < T.rows + FRAME_SIZE * T.rowStagger + 200) {
      for (let r = 0; r < FRAME_SIZE; r++) {
        const since = time - (T.rows + r * T.rowStagger);
        if (since < 0 || since > 180 || !rows[r].length) continue;
        const source = rowSource[r];
        const parent = source ? parentB : parentA, px = source ? bx : ax, py = source ? B_POS.y : A_POS.y;
        const frame = parent.sheet.idle.down[parentFrame];
        flashRow(frame, r, Math.round(px - 8 * PARENT_SCALE), Math.round(py - 16 * PARENT_SCALE), PARENT_SCALE, SOURCE_TINT[source], since < 90 ? 1 : 1 - (since - 90) / 90);
      }
    }
    drawTag(parentA, ax, A_POS.y + 22, SOURCE_TINT[0], tagAlpha);
    drawTag(parentB, bx, B_POS.y + 22, SOURCE_TINT[1], tagAlpha);

    // Egg.
    if (!rm && time < T.burst) {
      const drop = clamp((time - T.eggDrop) / (T.eggLand - T.eggDrop));
      const eggBottom = BABY_POS.y - 8 - (1 - easeInCubic(drop)) * 520 - (drop >= 1 ? Math.max(0, Math.sin(clamp((time - T.eggLand) / 180) * Math.PI) * 14) : 0);
      let angle = 0;
      for (const [start, duration, swings, amplitude] of T.wobbles) {
        const w = (time - start) / duration;
        if (w >= 0 && w < 1) angle = Math.sin(w * swings * Math.PI * 2) * (1 - w * 0.4) * 0.09 * amplitude;
      }
      const crack = clamp((time - T.crack) / T.crackDraw);
      if (time > T.crack) angle = Math.round(Math.sin(time / 22)) * 0.02;
      // Shadow.
      ctx.save(); ctx.scale(3, 3); ctx.globalAlpha = 0.5 * drop;
      ellipse(ctx, Math.round(BABY_POS.x / 3), Math.round((BABY_POS.y - 9) / 3), Math.round(12 + drop * 8), 3, "#000000");
      ctx.restore();
      if (drop > 0) drawEgg(BABY_POS.x, Math.round(eggBottom), angle, crack);
      // Light leaking from the crack.
      if (crack > 0.3) {
        const glow = (TIER_STYLE[tier].glow ?? WHITE);
        ctx.globalAlpha = 0.25 + 0.2 * Math.sin(time / 40);
        rect(ctx, BABY_POS.x - 70, BABY_POS.y - 8 - (EGG_H - CRACK_ROW) * EGG_PX - 6, 140, 12, glow);
        ctx.globalAlpha = 1;
      }
    }
    // Shell halves after the burst.
    if (!rm && time >= T.burst && time < T.burst + 700) {
      const k = (time - T.burst) / 700;
      drawEgg(BABY_POS.x - k * 40, BABY_POS.y - 8, -k * 0.6, 0, 1 - k, "top", easeOutCubic(k) * 220);
      drawEgg(BABY_POS.x, BABY_POS.y - 8 + easeInCubic(k) * 60, 0, 0, 1 - k, "bottom");
    }

    // Ghost grid where the baby assembles.
    const bl = BABY_POS.x - 8 * BABY_SCALE, bt = BABY_POS.y - 16 * BABY_SCALE;
    if (!rm && time >= T.burst && time < T.reveal + 300) {
      const alpha = clamp((time - T.burst) / 250) * (1 - clamp((time - T.reveal) / 300));
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = "#3A3A3A";
      for (let y = 0; y <= FRAME_SIZE; y++) for (let x = 0; x <= FRAME_SIZE; x++) ctx.fillRect(bl + x * BABY_SCALE - 1, bt + y * BABY_SCALE - 1, 2, 2);
      ctx.globalAlpha = 1;
    }

    // DNA strip: one cell per row, lit in the parent's tint as the row lands.
    const stripX = bl - 42, stripAlpha = rm ? 1 : clamp((time - T.burst) / 300);
    ctx.globalAlpha = stripAlpha;
    for (let r = 0; r < FRAME_SIZE; r++) {
      const landed = rm || final || time >= T.rows + r * T.rowStagger + T.rowFlight;
      const y = bt + r * BABY_SCALE + 1;
      rect(ctx, stripX, y, 18, BABY_SCALE - 2, "#262626");
      if (landed) rect(ctx, stripX + 2, y + 2, 14, BABY_SCALE - 6, SOURCE_TINT[rowSource[r]]);
    }
    ctx.globalAlpha = 1;

    // Baby.
    const pop = rm || final ? 0 : clamp((time - T.reveal) / 420);
    if (revealed) {
      let sx = 1, sy = 1;
      if (!rm && pop < 1) { sy = pop < 0.3 ? 1 + (pop / 0.3) * 0.22 : pop < 0.6 ? 1.22 - ((pop - 0.3) / 0.3) * 0.34 : 0.88 + ((pop - 0.6) / 0.4) * 0.12; sx = 1 / Math.sqrt(sy); }
      const show = showcase(time);
      paintCreature(ctx, baby, { clip: show.clip, facing: show.facing, frame: show.frame, x: BABY_POS.x, y: BABY_POS.y, scale: BABY_SCALE, sx, sy, time });
      // Flash on reveal.
      if (!rm && time - T.reveal < 160) {
        paintCreature(ctx, withoutPattern(baby), { clip: "idle", facing: "down", frame: 0, x: BABY_POS.x, y: BABY_POS.y, scale: BABY_SCALE, sx, sy, ink: WHITE, halo: WHITE, alpha: 1 - (time - T.reveal) / 160 });
      }
    } else if (!rm && time >= T.rows) {
      const landedRows: number[] = [];
      for (let r = 0; r < FRAME_SIZE; r++) if (time >= T.rows + r * T.rowStagger + T.rowFlight) landedRows.push(r);
      // Halo pass for every landed pixel first, then ink, so neighbouring rows never cover each other.
      ctx.fillStyle = WHITE;
      for (const r of landedRows) for (const x of rows[r]) ctx.fillRect(bl + (x - 1) * BABY_SCALE, bt + (r - 1) * BABY_SCALE, BABY_SCALE * 3, BABY_SCALE * 3);
      ctx.fillStyle = INK;
      for (const r of landedRows) for (const x of rows[r]) ctx.fillRect(bl + x * BABY_SCALE, bt + r * BABY_SCALE, BABY_SCALE, BABY_SCALE);
      // Freshly landed rows flash in their tint.
      for (const r of landedRows) {
        const since = time - (T.rows + r * T.rowStagger + T.rowFlight);
        if (since < 140) drawPixelRow(rows[r], bl, bt + r * BABY_SCALE, BABY_SCALE, SOURCE_TINT[rowSource[r]], null, 1 - since / 140);
      }
      // Rows in flight.
      for (let r = 0; r < FRAME_SIZE; r++) {
        const k = (time - (T.rows + r * T.rowStagger)) / T.rowFlight;
        if (k < 0 || k >= 1 || !rows[r].length) continue;
        const source = rowSource[r];
        const from = source ? { x: bx - 8 * PARENT_SCALE, y: B_POS.y - 16 * PARENT_SCALE + r * PARENT_SCALE }
          : { x: ax - 8 * PARENT_SCALE, y: A_POS.y - 16 * PARENT_SCALE + r * PARENT_SCALE };
        const to = { x: bl, y: bt + r * BABY_SCALE };
        const e = easeOutCubic(k);
        const scale = lerp(PARENT_SCALE, BABY_SCALE, e);
        const arc = Math.sin(k * Math.PI) * (90 + (r % 4) * 14);
        const x = lerp(from.x, to.x, e), y = lerp(from.y, to.y, e) - arc;
        // Motion trail.
        for (let i = 3; i >= 1; i--) {
          const kt = Math.max(0, k - i * 0.05), et = easeOutCubic(kt);
          drawPixelRow(rows[r], lerp(from.x, to.x, et), lerp(from.y, to.y, et) - Math.sin(kt * Math.PI) * (90 + (r % 4) * 14), lerp(PARENT_SCALE, BABY_SCALE, et), SOURCE_TINT[source], null, 0.12 * (4 - i));
        }
        drawLitRow(rows[r], x, y, scale, SOURCE_TINT[source]);
      }
      // Mutation cells pop in with sparkles.
      cells.forEach((cell, i) => {
        const since = time - (T.mutations + i * T.mutationStagger);
        if (since < 0) return;
        const k = clamp(since / 220);
        const size = BABY_SCALE * (k < 0.6 ? (k / 0.6) * 1.5 : 1.5 - ((k - 0.6) / 0.4) * 0.5);
        const cx = bl + (cell % FRAME_SIZE) * BABY_SCALE + BABY_SCALE / 2, cy = bt + ((cell / FRAME_SIZE) | 0) * BABY_SCALE + BABY_SCALE / 2;
        rect(ctx, Math.round(cx - size / 2 - BABY_SCALE), Math.round(cy - size / 2 - BABY_SCALE), Math.round(size + BABY_SCALE * 2), Math.round(size + BABY_SCALE * 2), WHITE);
        rect(ctx, Math.round(cx - size / 2), Math.round(cy - size / 2), Math.round(size), Math.round(size), k < 1 ? (TIER_STYLE[tier].glow ?? GREEN) : INK);
      });
    }

    // Shards and particles.
    ctx.fillStyle = INK;
    for (const shard of shards) {
      const k = shard.age / shard.life;
      ctx.globalAlpha = 1 - k * k;
      const w = Math.max(3, Math.round(shard.size * Math.abs(Math.cos(shard.spin))));
      rect(ctx, Math.round(shard.x - w / 2) - 3, Math.round(shard.y - shard.size / 2) - 3, w + 6, shard.size + 6, INK);
      rect(ctx, Math.round(shard.x - w / 2), Math.round(shard.y - shard.size / 2), w, shard.size, "#FFFDF8");
    }
    ctx.globalAlpha = 1;
    fx.draw(ctx, "floor");
    fx.draw(ctx, "top");

    // Captions and labels.
    if (!rm && !revealed) {
      const text = time < T.crack ? "SOMETHING IS HATCHING" : time < T.rows ? "!" : "MIXING 16 PIXEL ROWS";
      const alpha = clamp((time - 300) / 300);
      ctx.globalAlpha = alpha;
      drawText(ctx, text, W / 2, 92, { scale: time >= T.crack && time < T.rows ? 6 : 3, color: time >= T.crack && time < T.rows ? GREEN : SHADE, align: "center" });
      ctx.globalAlpha = 1;
    }
    if (revealed) {
      const colors = tierColors(tier);
      const drop = rm ? 1 : easeOutBack(clamp((time - T.reveal - 80) / 420), 2);
      const label = TIER_STYLE[tier].label.toUpperCase();
      const y = 118 - (1 - drop) * 40;
      ctx.globalAlpha = rm ? 1 : clamp((time - T.reveal - 80) / 200);
      drawText(ctx, label, W / 2, y, {
        scale: 6, color: colors.label, align: "center", outline: INK,
        colorAt: tier === "prismatic" ? (i => `hsl(${(i * 38 + time / 5) % 360} 95% 62%)`) : undefined,
      });
      const nameAlpha = rm ? 1 : clamp((time - T.reveal - 260) / 260);
      ctx.globalAlpha = nameAlpha;
      drawText(ctx, baby.name.toUpperCase(), W / 2, BABY_POS.y + 26, { scale: 4, color: PAPER, align: "center", outline: INK });
      drawText(ctx, baby.family.toUpperCase(), W / 2, BABY_POS.y + 66, { scale: 2, color: SHADE, align: "center", outline: INK });
      if (baby.dna?.traits.length) drawText(ctx, baby.dna.traits.join(" + ").toUpperCase(), W / 2, BABY_POS.y + 90, { scale: 2, color: colors.glow, align: "center", outline: INK });
      ctx.globalAlpha = 1;
    }

    // Burst flash.
    if (!rm && time >= T.burst && time < T.burst + 260) {
      ctx.globalAlpha = 0.85 * (1 - (time - T.burst) / 260);
      rect(ctx, -20, -20, W + 40, H + 40, WHITE);
      ctx.globalAlpha = 1;
    }
    if (!rm && time >= T.reveal && time < T.reveal + 200) {
      ctx.globalAlpha = (tier === "common" ? 0.45 : 0.7) * (1 - (time - T.reveal) / 200);
      rect(ctx, -20, -20, W + 40, H + 40, WHITE);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }

  /** After the reveal the baby shows off its inherited walk cycle in every direction. */
  function showcase(time: number): { clip: "idle" | "walk"; facing: Facing; frame: number } {
    if (reducedMotion) return { clip: "idle", facing: "down", frame: 0 };
    const since = time - T.reveal;
    if (since < 900) return { clip: "idle", facing: "down", frame: Math.floor(since / 150) % 8 };
    const loop = (since - 900) % 6000;
    const order: Facing[] = ["down", "right", "left", "down"];
    if (loop < 4400) {
      const facing = order[Math.floor(loop / 1100)];
      return { clip: "walk", facing, frame: Math.floor(loop / 105) % 8 };
    }
    return { clip: "idle", facing: "down", frame: Math.floor(loop / 150) % 8 };
  }

  // ------------------------------------------------------------------------------------------
  // Events on the timeline

  function events(previous: number, now: number) {
    const crossed = (at: number) => previous < at && now >= at;
    if (reducedMotion) return;
    T.wobbles.forEach(([start], i) => { if (crossed(start)) beat("wobble", `wobble${i}`); });
    if (crossed(T.eggLand)) fx.puff(BABY_POS.x, BABY_POS.y - 6, 12, 60);
    if (crossed(T.wobbles[2][0] + 250)) fx.squares(BABY_POS.x + 40, BABY_POS.y - 110, 3, ["#FFFDF8"], 160);
    if (crossed(T.crack)) {
      beat("crack");
      const crackY = BABY_POS.y - 8 - (EGG_H - CRACK_ROW) * EGG_PX;
      for (let i = 0; i < 5; i++) fx.sparkles(BABY_POS.x - 80 + i * 40 + (Math.random() - 0.5) * 16, crackY - 10 - Math.random() * 16, 1, 0, TIER_STYLE[tier].glow ?? WHITE, 3, 0);
    }
    if (crossed(T.burst)) {
      shake = 14;
      for (let i = 0; i < 22; i++) {
        const angle = Math.random() * Math.PI * 2, speed = 280 + Math.random() * 420;
        shards.push({ x: BABY_POS.x + Math.cos(angle) * 30, y: BABY_POS.y - 80 + Math.sin(angle) * 30, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 240, size: 8 + Math.floor(Math.random() * 3) * 5, spin: Math.random() * 6, life: 900 + Math.random() * 500, age: 0 });
      }
      fx.ring(BABY_POS.x, BABY_POS.y - 80, 240, WHITE, 5, 520);
      fx.ring(BABY_POS.x, BABY_POS.y - 80, 150, GREEN, 5, 420, 60);
    }
    if (crossed(T.rows)) beat("merge");
    cells.forEach((cell, i) => {
      if (!crossed(T.mutations + i * T.mutationStagger)) return;
      const bl = BABY_POS.x - 8 * BABY_SCALE, bt = BABY_POS.y - 16 * BABY_SCALE;
      fx.sparkles(bl + (cell % FRAME_SIZE) * BABY_SCALE + 5, bt + ((cell / FRAME_SIZE) | 0) * BABY_SCALE + 5, 3, 26, TIER_STYLE[tier].glow ?? GREEN, 4, 30);
    });
    if (crossed(T.reveal)) {
      beat("reveal");
      shake = tier === "prismatic" ? 10 : 5;
      const glow = TIER_STYLE[tier].glow ?? WHITE;
      const cy = BABY_POS.y - 88;
      fx.ring(BABY_POS.x, cy, tier === "common" ? 170 : 300, glow, 6, 620);
      fx.ring(BABY_POS.x, cy, tier === "common" ? 110 : 200, WHITE, 4, 480, 90);
      const colors = tier === "prismatic" ? ["#FF4D6D", "#FFB800", "#CCFF00", "#3DDCFF", "#8A4DFF", WHITE]
        : tier === "mutant" ? [TIER_STYLE.mutant.accent, TIER_STYLE.mutant.glow!, WHITE, GREEN]
          : tier === "spotted" ? [GREEN, TIER_STYLE.spotted.accent, WHITE, PAPER] : [WHITE, PAPER, GREEN, MUTED];
      fx.confetti(BABY_POS.x, cy - 20, colors, tier === "common" ? 36 : tier === "prismatic" ? 110 : 70, tier === "prismatic" ? 1.35 : 1.1);
      fx.sparkles(BABY_POS.x, cy, tier === "prismatic" ? 12 : 7, 190, glow, 3, 60);
    }
    if (crossed(T.end)) finish();
  }

  function finish() {
    if (finished) return;
    finished = true;
    const done = resolvePlay; resolvePlay = null;
    done?.();
  }

  function step(dt: number) {
    const previous = t;
    t += dt;
    if (reducedMotion) {
      if (previous === 0) beat("reveal");
      if (t >= 500) finish();
    } else events(previous, t);
    const seconds = dt / 1000;
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      s.age += dt;
      if (s.age >= s.life) { shards.splice(i, 1); continue; }
      s.vy += 900 * seconds; s.x += s.vx * seconds; s.y += s.vy * seconds; s.spin += 9 * seconds; s.vx *= Math.exp(-1.2 * seconds);
    }
    shake = Math.max(0, shake - dt * 0.05);
    fx.update(dt);
  }

  function loop(now: number) {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    if (started) step(dt);
    // The final frame keeps animating gently (walk cycle showcase); reduced motion stays still.
    if (started && (!reducedMotion || t < 700) || dirty || view.sync()) { dirty = false; render(started ? t : 0); }
  }
  raf = requestAnimationFrame(loop);

  return {
    play() {
      if (playPromise) return playPromise;
      playPromise = new Promise<void>(resolve => { resolvePlay = resolve; });
      if (destroyed) { resolvePlay?.(); resolvePlay = null; return playPromise; }
      started = true; t = 0; last = 0;
      return playPromise;
    },
    skip() {
      if (destroyed) return;
      if (!started) { started = true; playPromise ??= Promise.resolve(); }
      shards.length = 0;
      fx.clear();
      shake = 0;
      if (!fired.has("reveal")) beat("reveal");
      for (const name of ["wobble0", "wobble1", "wobble2", "crack", "merge"]) fired.add(name);
      t = Math.max(t, reducedMotion ? 700 : T.end + 1);
      finish();
      dirty = true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      view.destroy();
      fx.clear();
      if (reducedMotion) canvas.style.opacity = "";
      finish();
    },
  };
}
