// "How breeding works": a scroll-driven stage. The reading line's position inside each text step drives that step's
// scene (0 to 1), so scrolling plays it forwards and backwards. Every baby on stage is bred by the game's genetics.
import { breedSeed, shapeRows } from "../../src/genetics.ts";
import { clamp, easeInCubic, easeOutBack, easeOutCubic, lerp } from "../../src/scene/art.ts";
import { paintCreature } from "../../src/scene/creatures.ts";
import { createParticles } from "../../src/scene/fx.ts";
import { GATE_FRONT, GATE_INSIDE } from "../../src/scene/room.ts";
import { FACINGS, FRAME_SIZE, TIER_ORDER, TIER_STYLE, type Clip, type Creature, type Facing, type ShapeTrait, type TierId } from "../../src/types.ts";
import { $, $$, pixelView, reducedMotion, setPressed, shortId, stepProgress, whileVisible } from "./core.ts";
import {
  GREEN, INK, MUTED, PAPER, SHADE, VIOLET, VIOLET_SOFT, WHITE, drawCells, drawEgg, drawHeart, drawRow, label, paperFloor, shadow, tag,
} from "./pixels.ts";
import { allTiers, hatch, randomBelow, rowCounts, type Pool } from "./pool.ts";
import { restingRoom, roomPainter, type Actor, type RoomPainter } from "./room.ts";

const W = 960, H = 640;
const STEP_IDS = ["parents", "love", "egg", "rows", "walk", "tiers", "shapes", "keep"] as const;
type StepId = typeof STEP_IDS[number];
const ONE_IN: Record<TierId, string> = { common: "6 IN 10", spotted: "1 IN 4", mutant: "1 IN 8", prismatic: "1 IN 40" };
/** Sanctuary values by tier (game.json, simulated RF). */
const SANCTUARY_RF: Record<TierId, string> = { common: "0.5", spotted: "1", mutant: "1.5", prismatic: "6" };

type Lineage = Readonly<{ parent: Creature; mate: Creature; child: Creature; shape: ShapeTrait }>;
type Cast = Readonly<{
  a: Creature; b: Creature; seed: number;
  babies: Record<TierId, Creature>;
  lineage: Lineage | null;
  room: RoomPainter;
  brood: readonly Creature[];
}>;

/** A Mutant of A x B that grew a head shape, bred again with a wild Friend until a Common child carries that shape. */
function findLineage(pool: Pool, a: Creature, b: Creature): Lineage | null {
  const parent = hatch(a, b, "mutant");
  const grown = parent.dna?.shapes?.find(shape => !shape.from);
  if (!grown) return null;
  for (const mate of pool.friends) {
    if (mate === a || mate === b) continue;
    for (let play = 0n; play < 3n; play++) {
      const child = hatch(parent, mate, "common", play);
      const shape = child.dna?.shapes?.find(trait => trait.from && trait.from.side === 0);
      if (shape) return { parent, mate, child, shape };
    }
  }
  return null;
}

function makeCast(pool: Pool, a: Creature, b: Creature, room?: RoomPainter): Cast {
  const babies = allTiers(a, b);
  const brood = [
    Object.freeze({ ...babies.common, accessory: "party-hat" as const }),
    babies.spotted, babies.prismatic, babies.mutant,
  ];
  return { a, b, seed: breedSeed(a.tokenId ?? 0n, a.key, b.key, 0n), babies, lineage: findLineage(pool, a, b), room: room ?? roomPainter(a), brood };
}

/** A chunky pixel arrow pointing right, centred on (x, y). */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, px: number) {
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(x - 5 * px), Math.round(y - px / 2), 8 * px, px);
  for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(x + (i - 1) * px), Math.round(y - px / 2 - (3 - i) * px), px, (7 - 2 * i) * px);
}

const frameAt = (time: number, offset = 0) => reducedMotion() ? 0 : (Math.floor(time / 110) + offset) & 7;
const phase = (t: number, from: number, to: number) => clamp((t - from) / (to - from));

type Draw = Readonly<{ clip?: Clip; facing?: Facing; frame?: number; alpha?: number; lift?: number; sx?: number; sy?: number }>;
function sprite(ctx: CanvasRenderingContext2D, creature: Creature, x: number, y: number, scale: number, time: number, draw: Draw = {}) {
  paintCreature(ctx, creature, {
    clip: draw.clip ?? "idle", facing: draw.facing ?? "down", frame: draw.frame ?? frameAt(time), x, y: y - (draw.lift ?? 0), scale,
    alpha: draw.alpha ?? 1, sx: draw.sx ?? 1, sy: draw.sy ?? 1, time,
  });
}

const idleFrame = (creature: Creature) => creature.sheet.idle.down[0];
/** A shape's cells in the idle frame 0 of the facing it is shown in (side-walkers only have left and right). */
const shapeCells = (shape: ShapeTrait) => (shape.cells.down ?? shape.cells.right ?? [])[0] ?? [];

export function mountStory(pool: Pool, friend: Creature, firstMate: Creature) {
  const stage = $("#story-stage");
  const canvas = $<HTMLCanvasElement>("#story-canvas");
  const steps = $$("#how .step");
  const dots = $("#story-stage .story-dots");
  dots.innerHTML = STEP_IDS.map(() => "<li></li>").join("");
  const dotItems = $$("li", dots);
  const view = pixelView(canvas, W, H);
  const fx = createParticles();
  let cast = makeCast(pool, friend, firstMate);
  let manualFacing: Facing | null = null, manualTier: TierId | null = null;
  let lastIndex = -1, heartClock = 0;

  const facingChips = $$<HTMLButtonElement>("[data-facing]", stage.closest("section")!);
  const tierChips = $$<HTMLButtonElement>("#how [data-tier]");
  facingChips.forEach(chip => chip.addEventListener("click", () => { manualFacing = chip.dataset.facing as Facing; }));
  tierChips.forEach(chip => chip.addEventListener("click", () => { manualTier = chip.dataset.tier as TierId; }));

  function writeCast() {
    const set = (key: string, text: string) => $$(`[data-cast="${key}"]`).forEach(node => { node.textContent = text; });
    set("a-name", cast.a.name); set("a-family", cast.a.family); set("a-short", shortId(cast.a.name)); set("b-short", shortId(cast.b.name));
    set("shape", (cast.lineage?.shape.label ?? "horns").toLowerCase());
  }
  writeCast();

  $("#how [data-action=new-mate]").addEventListener("click", () => {
    const others = pool.friends.filter(friendOf => friendOf.familyId !== cast.a.familyId && friendOf !== cast.b);
    cast = makeCast(pool, cast.a, others[randomBelow(others.length)], cast.room);
    writeCast();
    fx.clear();
  });

  // ---------- Scenes (logical 960 x 640, feet line G) ----------
  const G = 500;

  function parents(ctx: CanvasRenderingContext2D, t: number, time: number) {
    const walk = phase(t, 0, 0.55), walking = walk < 1 && !reducedMotion();
    const ax = lerp(-140, 300, easeOutCubic(walk)), bx = lerp(1100, 660, easeOutCubic(walk));
    for (const [creature, x, facing] of [[cast.a, ax, "right"], [cast.b, bx, "left"]] as const) {
      shadow(ctx, x, G + 4, 76);
      sprite(ctx, creature, x, G, 12, time, walking ? { clip: "walk", facing, frame: frameAt(time) } : {});
    }
    const tags = reducedMotion() ? 1 : phase(t, 0.5, 0.7);
    if (tags > 0) {
      ctx.globalAlpha = tags;
      tag(ctx, shortId(cast.a.name), ax, G + 26, PAPER);
      label(ctx, `YOUR FRIEND  ${cast.a.family}`, ax, G + 72, MUTED, 2);
      tag(ctx, shortId(cast.b.name), bx, G + 26, GREEN);
      label(ctx, `WILD  ${cast.b.family}`, bx, G + 72, MUTED, 2);
      ctx.globalAlpha = 1;
    }
  }

  function love(ctx: CanvasRenderingContext2D, t: number, time: number, dt: number) {
    const close = easeOutCubic(phase(t, 0, 0.5));
    const ax = lerp(300, 352, close), bx = lerp(660, 608, close);
    const hop = !reducedMotion() && t > 0.2;
    shadow(ctx, ax, G + 4, 76); shadow(ctx, bx, G + 4, 76);
    sprite(ctx, cast.a, ax, G, 12, time, { facing: "right", lift: hop ? Math.abs(Math.sin(time / 170)) * 16 : 0 });
    sprite(ctx, cast.b, bx, G, 12, time, { facing: "left", lift: hop ? Math.abs(Math.sin(time / 170 + 1.4)) * 16 : 0 });
    const px = Math.round(lerp(2, 10, easeOutBack(phase(t, 0.1, 0.8))));
    const bob = reducedMotion() ? 0 : Math.sin(time / 260) * 6;
    drawHeart(ctx, 480, G - 190 + bob, px);
    if (!reducedMotion() && dt > 0) {
      heartClock -= dt;
      if (heartClock <= 0) { fx.hearts(480 + (Math.random() - 0.5) * 120, G - 120, 1, 30, 0); heartClock = 320; }
    }
  }

  function eggScene(ctx: CanvasRenderingContext2D, t: number, time: number) {
    const apart = easeOutCubic(phase(t, 0, 0.3));
    const ax = lerp(352, 196, apart), bx = lerp(608, 764, apart);
    shadow(ctx, ax, G + 4, 76); shadow(ctx, bx, G + 4, 76);
    sprite(ctx, cast.a, ax, G, 12, time, { facing: "right" });
    sprite(ctx, cast.b, bx, G, 12, time, { facing: "left" });
    const heart = 1 - phase(t, 0, 0.14);
    if (heart > 0) drawHeart(ctx, 480, G - 190, Math.max(1, Math.round(10 * heart)), heart);
    const drop = phase(t, 0.08, 0.3);
    if (drop <= 0) return;
    const y = lerp(-40, G, easeOutBack(drop, 1.2));
    const wobble = phase(t, 0.34, 0.82);
    const lean = reducedMotion() ? 0 : Math.sin(time / 85) * lerp(0.02, 0.11, wobble) * (wobble > 0 ? 1 : 0);
    const open = reducedMotion() ? (t > 0.85 ? 1 : 0) : easeInCubic(phase(t, 0.86, 1));
    shadow(ctx, 480, G + 4, 84);
    drawEgg(ctx, 480, y, 7, { lean, crack: phase(t, 0.58, 0.8), open: Math.min(open, 0.999) });
    if (open > 0.02) {
      // Burst: light rays around the opening.
      ctx.fillStyle = GREEN;
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 + 0.3, r0 = 90 + open * 30, r1 = r0 + 18 + open * 40;
        for (let r = r0; r < r1; r += 6) ctx.fillRect(Math.round(480 + Math.cos(angle) * r), Math.round(G - 110 + Math.sin(angle) * r * 0.8), 6, 6);
      }
    }
    const seedIn = reducedMotion() ? 1 : phase(t, 0.2, 0.34);
    if (seedIn > 0) {
      ctx.globalAlpha = seedIn;
      tag(ctx, `SEED ${cast.seed.toString(16).toUpperCase().padStart(8, "0")}`, 480, G + 30, WHITE);
      ctx.globalAlpha = 1;
    }
  }

  function rows(ctx: CanvasRenderingContext2D, t: number, time: number) {
    const s = 14, ax = 172, bx = 788, cx = 480, G = 530;
    const top = G - FRAME_SIZE * s;
    const baby = cast.babies.common, source = baby.dna!.rowSource;
    const frames = [idleFrame(cast.a), idleFrame(cast.b)] as const;
    const placed = reducedMotion() ? 16 : phase(t, 0, 0.84) * 16.999;
    // The bottom shell the rows fly into.
    const shell = 1 - phase(t, 0.2, 0.7);
    if (shell > 0) drawEgg(ctx, cx, G + 6, 7, { lean: 0, crack: 1, open: 1, alpha: shell });
    // Source highlights behind the parents.
    for (let row = 0; row < FRAME_SIZE; row++) {
      const p = clamp(placed - row);
      if (p <= 0 || p >= 1) continue;
      const x = source[row] ? bx : ax;
      ctx.fillStyle = source[row] ? GREEN : SHADE;
      ctx.fillRect(x - 8 * s - 12, top + row * s, 16 * s + 24, s);
    }
    shadow(ctx, ax, G + 4, 84); shadow(ctx, bx, G + 4, 84); shadow(ctx, cx, G + 4, 84);
    paintCreature(ctx, cast.a, { clip: "idle", facing: "down", frame: 0, x: ax, y: G, scale: s });
    paintCreature(ctx, cast.b, { clip: "idle", facing: "down", frame: 0, x: bx, y: G, scale: s });
    const done = reducedMotion() ? 1 : phase(t, 0.86, 0.96);
    if (done < 1) {
      for (let row = 0; row < FRAME_SIZE; row++) {
        const p = clamp(placed - row);
        if (p <= 0) continue;
        const from = source[row] ? bx : ax, u = easeOutCubic(p);
        const x = lerp(from, cx, u), lift = Math.sin(u * Math.PI) * 46;
        drawRow(ctx, frames[source[row]], row, Math.round(x - 8 * s), Math.round(top - lift), s, INK, WHITE, 1 - done);
      }
    }
    if (done > 0) {
      paintCreature(ctx, baby, { clip: "idle", facing: "down", frame: 0, x: cx, y: G, scale: s, alpha: done });
      // Pixels the repair added to join one body: shown in green for a moment.
      const added: number[] = [];
      const own = idleFrame(baby);
      for (let i = 0; i < own.length; i++) if (own[i] && !frames[source[(i / FRAME_SIZE) | 0]][i]) added.push(i);
      if (added.length) drawCells(ctx, added, cx - 8 * s, top, s, GREEN, done * 0.9);
      label(ctx, added.length ? `+${added.length} PIXELS TO JOIN ONE BODY` : "NOT ONE PIXEL ADDED", cx, G + 40, MUTED, 2);
    }
    // DNA strip.
    const sx = cx + 8 * s + 22;
    for (let row = 0; row < FRAME_SIZE; row++) {
      const filled = clamp(placed - row) >= 1;
      ctx.fillStyle = INK;
      ctx.fillRect(sx - 3, top + row * s - 3, 24, s + 3);
      ctx.fillStyle = filled ? (source[row] ? GREEN : PAPER) : SHADE;
      ctx.fillRect(sx, top + row * s, 18, s - 3);
    }
    const [fromA, fromB] = rowCounts(baby);
    tag(ctx, `${fromA} ROWS`, ax, G + 28, PAPER);
    tag(ctx, `${fromB} ROWS`, bx, G + 28, GREEN);
  }

  function walk(ctx: CanvasRenderingContext2D, t: number, time: number) {
    const facing = manualFacing ?? FACINGS[Math.min(3, Math.floor(t * 4))];
    setPressed(facingChips, chip => chip.dataset.facing === facing);
    const baby = cast.babies.common, frame = frameAt(time);
    const bob = reducedMotion() ? 0 : Math.abs(Math.sin((time / 110) * (Math.PI / 4))) * 6;
    for (const [creature, x] of [[cast.a, 150], [cast.b, 810]] as const) {
      shadow(ctx, x, G - 36, 48);
      sprite(ctx, creature, x, G - 40, 7, time, { clip: "walk", facing, frame });
    }
    shadow(ctx, 480, G - 36, 96);
    sprite(ctx, baby, 480, G - 40, 15, time, { clip: "walk", facing, frame, lift: bob });
    // The eight walk frames of this facing, the current one underlined.
    const strip = 8, gap = 72, s = 3, left = 480 - ((strip - 1) * gap) / 2;
    for (let i = 0; i < strip; i++) {
      const x = left + i * gap;
      paintCreature(ctx, baby, { clip: "walk", facing, frame: i, x, y: G + 88, scale: s });
      if (i === frame) { ctx.fillStyle = INK; ctx.fillRect(x - 24, G + 100, 48, 5); }
    }
    label(ctx, "WALK FRAMES 1 TO 8", 480, G + 116, MUTED, 2);
  }

  function tiers(ctx: CanvasRenderingContext2D, t: number, time: number) {
    const active = manualTier ?? TIER_ORDER[Math.min(3, Math.floor(t * 4))];
    setPressed(tierChips, chip => chip.dataset.tier === active);
    TIER_ORDER.forEach((tier, i) => {
      const x = 150 + i * 220, on = tier === active;
      if (on) { ctx.fillStyle = SHADE; ctx.fillRect(x - 100, 110, 200, 440); ctx.fillStyle = INK; ctx.fillRect(x - 100, 546, 200, 4); }
      const lift = on && !reducedMotion() ? Math.abs(Math.sin(time / 190)) * 18 : 0;
      shadow(ctx, x, G - 26, 50);
      sprite(ctx, cast.babies[tier], x, G - 30, 10, time, { lift, alpha: on ? 1 : 0.55 });
      const style = TIER_STYLE[tier];
      label(ctx, style.label, x, G - 2, tier === "common" ? INK : style.accent, 3);
      label(ctx, ONE_IN[tier], x, G + 24, MUTED, 2);
    });
  }

  function shapes(ctx: CanvasRenderingContext2D, t: number, time: number) {
    const line = cast.lineage;
    if (!line) { tiers(ctx, 1, time); return; }
    const s = 12, px = 190, cx = 770, mx = 480;
    const top = G - FRAME_SIZE * s;
    const rowsOf = shapeRows(line.shape);
    const travel = reducedMotion() ? 1 : phase(t, 0.3, 0.72);
    const arrive = reducedMotion() ? 1 : phase(t, 0.72, 0.9);
    // Violet bands: the shape's rows, in the parent, on the way, then in the child.
    ctx.fillStyle = VIOLET_SOFT;
    for (const row of rowsOf) ctx.fillRect(px - 8 * s - 10, top + row * s, 16 * s + 20, s);
    if (travel > 0 && travel < 1) {
      const x = lerp(px, cx, easeOutCubic(travel)), lift = Math.sin(travel * Math.PI) * 60;
      for (const row of rowsOf) ctx.fillRect(Math.round(x - 8 * s - 10), Math.round(top + row * s - lift), 16 * s + 20, s);
    }
    if (arrive > 0) { ctx.globalAlpha = arrive; for (const row of rowsOf) ctx.fillRect(cx - 8 * s - 10, top + row * s, 16 * s + 20, s); ctx.globalAlpha = 1; }
    shadow(ctx, px, G + 4, 56); shadow(ctx, cx, G + 4, 56); shadow(ctx, mx, G - 36, 36);
    sprite(ctx, line.parent, px, G, s, time);
    const grown = line.parent.dna?.shapes?.find(shape => shape.label === line.shape.label) ?? line.shape;
    drawCells(ctx, shapeCells(grown), px - 8 * s, top, s, VIOLET, 0.9);
    sprite(ctx, line.mate, mx, G - 40, 6, time);
    label(ctx, "×", (px + mx) / 2 + 10, G - 110, INK, 5);
    arrow(ctx, (mx + cx) / 2 - 10, G - 92, 5);
    sprite(ctx, line.child, cx, G, s, time, { alpha: lerp(0.35, 1, arrive) });
    if (arrive > 0) drawCells(ctx, shapeCells(line.shape), cx - 8 * s, top, s, VIOLET, 0.9 * arrive);
    tag(ctx, `${line.parent.name} ${TIER_STYLE.mutant.label}`, px, G + 26, WHITE);
    label(ctx, `F${line.parent.lineage}`, px, G + 72, MUTED, 2);
    tag(ctx, `${line.child.name} ${TIER_STYLE.common.label}`, cx, G + 26, WHITE);
    if (arrive > 0.3) { ctx.globalAlpha = clamp((arrive - 0.3) / 0.5); label(ctx, `F${line.child.lineage}  ${line.shape.label} FROM ${line.parent.name}`, cx - 30, G + 72, VIOLET, 2); ctx.globalAlpha = 1; }
    label(ctx, shortId(line.mate.name), mx, G - 22, MUTED, 2);
  }

  const keepActors: Actor[] = [];
  function keep(ctx: CanvasRenderingContext2D, t: number, time: number, dt: number) {
    const loopAngle = (reducedMotion() ? 1.2 : time * 0.00032);
    const center = { x: 470, y: 404 }, rx = 200, ry = 58;
    const brood = cast.brood;
    const leaving = brood[brood.length - 1];
    const go = reducedMotion() ? 1 : phase(t, 0.45, 0.95);
    keepActors.length = 0;
    [cast.a, ...brood].forEach((creature, index) => {
      const angle = loopAngle - index * 0.36;
      let x = center.x + Math.cos(angle) * rx, y = center.y + Math.sin(angle) * ry;
      const dx = -Math.sin(angle), dy = Math.cos(angle);
      let facing: Facing = Math.abs(dx) * 0.55 > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      let alpha = 1;
      if (creature === leaving && go > 0) {
        // Off to the Sanctuary gate, and through it.
        const toGate = easeOutCubic(clamp(go / 0.7)), inside = clamp((go - 0.7) / 0.3);
        x = lerp(x, GATE_FRONT.x, toGate); y = lerp(y, GATE_FRONT.y, toGate);
        if (inside > 0) { x = GATE_INSIDE.x; y = lerp(GATE_FRONT.y, GATE_INSIDE.y, inside); alpha = 1 - inside; }
        facing = toGate < 1 ? (GATE_FRONT.x > x ? "right" : "up") : "up";
      }
      keepActors.push({ creature, x, y, scale: index === 0 ? 4 : 3, facing: reducedMotion() ? "down" : facing,
        clip: reducedMotion() ? "idle" : "walk", frame: frameAt(time, index * 3), alpha,
        lift: index > 0 && !reducedMotion() ? Math.abs(Math.sin(time / 190 + index)) * 4 : 0 });
    });
    if (!reducedMotion() && dt > 0) {
      heartClock -= dt;
      if (heartClock <= 0) {
        const kept = keepActors[1 + randomBelow(Math.max(1, keepActors.length - 2))];
        if (kept) fx.hearts(kept.x, kept.y - 60, 1, 14, 0);
        heartClock = 700;
      }
    }
    const state = { ...restingRoom(time, reducedMotion()), gateOpen: go > 0.4 ? easeOutCubic(clamp((go - 0.4) / 0.3)) : 0 };
    cast.room.paint(ctx, state, keepActors, () => {
      if (go > 0.8) {
        ctx.globalAlpha = clamp((go - 0.8) / 0.2);
        tag(ctx, `+${SANCTUARY_RF[leaving.tier ?? "common"]} RF SIM`, GATE_FRONT.x, GATE_FRONT.y - 120, GREEN, INK, 3);
        ctx.globalAlpha = 1;
      }
      tag(ctx, "KEEP  ♥ EVERY 10 S", 250, 560, WHITE, INK, 3);
      tag(ctx, "TRADE IN", GATE_FRONT.x, GATE_FRONT.y - 70, PAPER, INK, 2);
    });
  }

  const SCENES: Record<StepId, (ctx: CanvasRenderingContext2D, t: number, time: number, dt: number) => void> = {
    parents, love, egg: eggScene, rows, walk, tiers, shapes, keep,
  };

  whileVisible(stage, (now, dt) => {
    view.sync();
    const { index, t: raw } = stepProgress(steps);
    const t = reducedMotion() ? 1 : raw;
    if (index !== lastIndex) {
      steps.forEach((step, i) => step.classList.toggle("is-active", i === index));
      dotItems.forEach((dot, i) => dot.classList.toggle("on", i === index));
      if (lastIndex >= 0) { manualFacing = null; manualTier = null; }
      fx.clear();
      lastIndex = index;
    }
    const time = reducedMotion() ? 0 : now;
    if (dt > 0) fx.update(dt);
    const ctx = view.ctx;
    view.begin(true);
    const id = STEP_IDS[index];
    if (id !== "keep") paperFloor(ctx, W, H, 0);
    SCENES[id](ctx, t, time, dt);
    fx.draw(ctx, "top");
  });
}
