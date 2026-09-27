// The nursery room: layout, collision, static art and animated stations.
// Art is authored on a 320 x 214 grid where one art pixel is 3 logical pixels (the babies' sprite scale),
// so props, walls and the brood share one crisp pixel grid. The Friend is the hero and stands one step
// bigger (4 logical pixels per sprite pixel).
import type { Creature, StationId } from "../types.ts";
import {
  GREEN, GRID, INK, MOSS, MUTED, PAPER, SHADE, WHITE, bitmap, box, clamp, dither, ditherEllipse, ellipse, ellipseBox,
  makeCanvas, rect, rng,
} from "./art.ts";
import { BOX_X, BOX_Y, creatureFrame } from "./creatures.ts";
import { drawText } from "./font.ts";

export const A = 3;
export const ART_W = 320, ART_H = 214;
export type Rect = readonly [number, number, number, number];

// Art-space structure.
const SIDE = 8, WALL = 54, FRONT = 204;
const DOOR = { x: 74, y: 12, w: 28, h: 42 };
const DOOR_PANEL = { x: 77, y: 15, w: 22, h: 39 };
const WINDOWS = [{ x: 108, y: 10, w: 24, h: 24 }, { x: 190, y: 10, w: 24, h: 24 }];
const PORTRAIT = { x: 26, y: 16, w: 24, h: 24 };
const ARCH = { cx: 254, open: { x: 234, y: 18, w: 40, h: 36 } };
const KIOSK = { x: 12, y: 56, w: 45, h: 53 };
const INCUBATOR = { x: 136, y: 12, w: 48, h: 61 };
/** The Moon Slingshot stands on the floor in front of Window 2 and shoots through it. */
const SLING = { x: 184, y: 37, w: 28, h: 48 };
/** Pouch seat row at rest (local art row) and the longest pull back (art px). */
const POUCH_ROW = 7, POUCH_PULL = 17;

const art = (r: Rect): Rect => [r[0] * A, r[1] * A, r[2] * A, r[3] * A];

/** Where feet may stand (logical): babies and small creatures. */
export const WALK: Rect = [SIDE * A + 18, WALL * A + 14, (ART_W - SIDE) * A - 18, FRONT * A - 5];
/** Where the Friend's (and visiting mates') feet may stand: wider bodies keep clear of the side walls. */
export const HERO_WALK: Rect = [SIDE * A + 26, WALL * A + 14, (ART_W - SIDE) * A - 26, FRONT * A - 5];

/** Solid footprints (logical). */
export const OBSTACLES: readonly Rect[] = [
  art([SIDE, WALL, 57, 109]), // matchmaker kiosk
  art([137, WALL, 183, 73]), // incubator
  art([16, 143, 32, 152]), // floor lamp
  art([87, 176, 107, 188]), // toy blocks
  art([242, 127, 256, 135]), // duck
  art([273, 143, 297, 157]), // pouf
  art([212, WALL, 231, 67]), // sanctuary planter left
  art([277, WALL, 296, 67]), // sanctuary planter right
  art([298, WALL, ART_W - SIDE, 72]), // corner plant
  art([104, WALL, 121, 60]), // fern by the door
  art([SLING.x + 1, WALL, SLING.x + SLING.w - 1, SLING.y + SLING.h]), // moon slingshot
  // The runtime overlays its wallet and menu controls in the bottom corners: keep feet out from under them.
  [SIDE * A, 591, 214, ART_H * A], [(ART_W - SIDE) * A - 190, 591, (ART_W - SIDE) * A, ART_H * A],
];

export type StationSpec = Readonly<{ id: StationId; label: string; footprint: Rect; hit: Rect; reach: number }>;
export const STATIONS: readonly StationSpec[] = [
  { id: "matchmaker", label: "Matchmaker", footprint: art([SIDE, WALL, 57, 109]), hit: art([KIOSK.x, KIOSK.y, KIOSK.x + KIOSK.w, KIOSK.y + KIOSK.h]), reach: 46 },
  { id: "incubator", label: "Incubator", footprint: art([137, WALL, 183, 73]), hit: art([INCUBATOR.x, INCUBATOR.y, INCUBATOR.x + INCUBATOR.w, INCUBATOR.y + INCUBATOR.h]), reach: 46 },
  { id: "sanctuary", label: "Sanctuary", footprint: art([231, WALL - 2, 277, WALL]), hit: art([222, 10, 286, 66]), reach: 52 },
  // The hit reaches up over Window 2, the shot's target.
  { id: "slingshot", label: "Moon Slingshot", footprint: art([SLING.x + 1, WALL, SLING.x + SLING.w - 1, SLING.y + SLING.h]), hit: art([SLING.x, 18, SLING.x + SLING.w, SLING.y + SLING.h + 2]), reach: 44 },
];

export const SPAWN = { x: 480, y: 402 };
/** Mates appear inside the doorway and step onto the doormat. */
export const DOOR_INSIDE = { x: (DOOR_PANEL.x + DOOR_PANEL.w / 2) * A, y: WALL * A - 2 };
export const DOOR_OUTSIDE = { x: DOOR_INSIDE.x, y: WALL * A + 26 };
export const DOOR_CLIP: Rect = art([DOOR_PANEL.x, DOOR_PANEL.y, DOOR_PANEL.x + DOOR_PANEL.w, WALL + 2]);
/** Released babies stop in front of the gate, then walk into the garden. */
export const GATE_FRONT = { x: ARCH.cx * A, y: WALL * A + 22 };
export const GATE_INSIDE = { x: ARCH.cx * A, y: (ARCH.open.y + 26) * A };
export const GATE_CLIP: Rect = art([ARCH.open.x, ARCH.open.y - 12, ARCH.open.x + ARCH.open.w, WALL + 1]);
/**
 * Moon Slingshot. A launched baby lines up at SLING_FRONT, sits in the pouch (SLING_SEAT: its feet line at rest,
 * pulled back by up to SLING_PULL) and flies out through the glass of Window 2 (WINDOW_CLIP) towards MOON_AT.
 */
export const SLING_BASE_Y = (SLING.y + SLING.h) * A;
export const SLING_FRONT = { x: (SLING.x + SLING.w / 2) * A, y: SLING_BASE_Y + 22 };
export const SLING_SEAT = { x: (SLING.x + SLING.w / 2) * A, y: (SLING.y + POUCH_ROW + 1) * A };
export const SLING_PULL = POUCH_PULL * A;
export const WINDOW_CLIP: Rect = art([WINDOWS[1].x + 1, WINDOWS[1].y + 2, WINDOWS[1].x + WINDOWS[1].w - 1, WINDOWS[1].y + WINDOWS[1].h - 1]);
export const MOON_AT = { x: (WINDOWS[1].x + WINDOWS[1].w - 6) * A, y: (WINDOWS[1].y + 6) * A };

/** The slingshot band: pull 0 to 1 (cosmetic), the last snap (time and pull), and whether a baby sits in the pouch. */
export type SlingPose = Readonly<{ pull: number; snapAt: number; snapPull: number; loaded: boolean }>;

/**
 * Pouch offset from rest (art px): pulled back (down, towards the viewer) with a tremble, the twang after a snap,
 * and a little come-hither tug while the Friend stands near an empty slingshot.
 */
export function pouchOffset(sling: SlingPose, time: number, awake: boolean, reducedMotion: boolean) {
  const pulled = Math.round(clamp(sling.pull) * POUCH_PULL);
  if (reducedMotion) return { dx: 0, dy: pulled };
  const since = time - sling.snapAt;
  if (since >= 0 && since < 560) return { dx: 0, dy: Math.round(Math.max(-10, sling.snapPull * POUCH_PULL * Math.cos(since / 24) * Math.exp(-since / 130))) };
  if (sling.pull > 0) return { dx: sling.pull > 0.15 ? (Math.floor(time / 45) % 2 ? 1 : -1) : 0, dy: pulled };
  if (!awake || sling.loaded) return { dx: 0, dy: 0 };
  const cycle = time % 1800;
  if (cycle < 260) return { dx: 0, dy: Math.round(3 * Math.sin((cycle / 260) * Math.PI / 2)) };
  if (cycle < 640) return { dx: 0, dy: Math.round(3 * Math.cos((cycle - 260) / 30) * Math.exp(-(cycle - 260) / 110)) };
  return { dx: 0, dy: 0 };
}

// ---------------------------------------------------------------------------------------------
// Foliage

function leaf(ctx: CanvasRenderingContext2D, bx: number, by: number, angle: number, length: number, width: number, fill: string, vein: string | null) {
  bx = Math.round(bx); by = Math.round(by);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const reach = Math.ceil(length + width);
  ctx.fillStyle = fill;
  for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) {
    const u = (x + 0.5) * dx + (y + 0.5) * dy, v = -(x + 0.5) * dy + (y + 0.5) * dx;
    if (u < 0 || u > length) continue;
    const half = (width / 2) * Math.sin(Math.PI * Math.pow(u / length, 0.8));
    if (Math.abs(v) <= half) ctx.fillRect(bx + x, by + y, 1, 1);
  }
  if (vein) {
    ctx.fillStyle = vein;
    for (let t = 1; t < length * 0.72; t += 0.7) ctx.fillRect(Math.round(bx + dx * t - 0.5), Math.round(by + dy * t - 0.5), 1, 1);
  }
}

type LeafSpec = readonly [number, number, number, number, number, (0 | 1)?]; // base x, base y, angle (deg), length, width, fill (0 green, 1 white)

/** Leaves are drawn back to front, each with its own ink outline, so overlaps read clearly. */
function foliage(width: number, height: number, leaves: readonly LeafSpec[], stems = true) {
  const { canvas, ctx } = makeCanvas(width, height);
  if (stems) for (const [x, y, deg, length] of leaves) {
    const a = (deg * Math.PI) / 180;
    for (let t = 0; t < length * 0.35; t += 0.6) rect(ctx, Math.round(x + Math.cos(a) * t - 0.5), Math.round(y + Math.sin(a) * t - 0.5), 1, 1, INK);
  }
  for (const [x, y, deg, length, w, fill = 0] of leaves) {
    const a = (deg * Math.PI) / 180;
    const bx = x + Math.cos(a) * length * 0.3, by = y + Math.sin(a) * length * 0.3, l = length * 0.7;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) leaf(ctx, bx + ox, by + oy, a, l, w, INK, null);
    leaf(ctx, bx, by, a, l, w, fill ? WHITE : GREEN, fill ? GREEN : MOSS);
  }
  return canvas;
}

function pot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, band = true) {
  box(ctx, x, y, w, 4, WHITE);
  box(ctx, x + 1, y + 3, w - 2, h - 3, PAPER);
  rect(ctx, x + 2, y + h - 2, w - 4, 1, SHADE);
  if (band) { rect(ctx, x + 2, y + 6, w - 4, 1, INK); dither(ctx, x + 2, y + 7, w - 4, 2, INK, 4); }
}

function pottedPlant(kind: "fern" | "tall" | "bush") {
  if (kind === "fern") {
    // A round-leaf pothos spilling over its pot.
    const leaves = foliage(23, 19, [
      [11, 18, -165, 11, 6, 1], [11, 18, -15, 11, 6, 1], [11, 18, -125, 12, 7], [11, 18, -55, 12, 7], [11, 18, -92, 14, 7, 1],
    ]);
    const { canvas, ctx } = makeCanvas(23, 30);
    ctx.drawImage(leaves, 0, 0);
    pot(ctx, 5, 18, 13, 12);
    return canvas;
  }
  if (kind === "tall") {
    // A fiddle-leaf fig: big paddle leaves up a stem.
    const { canvas, ctx } = makeCanvas(21, 47);
    rect(ctx, 10, 6, 1, 29, INK);
    const leaves = foliage(21, 36, [
      [10, 32, -150, 10, 7, 1], [10, 30, -30, 10, 7], [10, 23, -140, 10, 7], [10, 20, -40, 10, 7, 1],
      [10, 14, -130, 9, 6, 1], [10, 12, -50, 9, 6], [10, 8, -92, 9, 6],
    ], false);
    ctx.drawImage(leaves, 0, 0);
    pot(ctx, 4, 34, 13, 13);
    return canvas;
  }
  // Flowering bush for the sanctuary.
  const leaves = foliage(26, 23, [
    [13, 22, -170, 10, 7, 1], [13, 22, -10, 10, 7, 1], [13, 22, -140, 12, 8], [13, 22, -40, 12, 8],
    [13, 22, -112, 13, 8, 1], [13, 22, -68, 13, 8], [13, 22, -90, 14, 8],
  ]);
  const { canvas, ctx } = makeCanvas(26, 35);
  ctx.drawImage(leaves, 0, 0);
  for (const [fx, fy] of [[5, 10], [20, 8], [13, 3], [9, 16], [18, 15]] as const) {
    rect(ctx, fx - 1, fy - 1, 3, 3, INK);
    rect(ctx, fx - 1, fy, 3, 1, WHITE); rect(ctx, fx, fy - 1, 1, 3, WHITE); rect(ctx, fx, fy, 1, 1, GREEN);
  }
  pot(ctx, 5, 22, 16, 13);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Props (upright, depth sorted with creatures)

function lampSprite() {
  const { canvas, ctx } = makeCanvas(17, 46);
  // Shade.
  rect(ctx, 3, 0, 11, 1, INK);
  for (let y = 1; y < 9; y++) { const inset = Math.max(0, 3 - Math.floor(y / 2)); rect(ctx, inset, y, 17 - inset * 2, 1, INK); rect(ctx, inset + 1, y, 15 - inset * 2, 1, y < 7 ? WHITE : PAPER); }
  rect(ctx, 0, 9, 17, 1, INK);
  dither(ctx, 1, 7, 15, 2, SHADE, 2);
  rect(ctx, 5, 10, 7, 1, GREEN); // warm bulb glow under the shade
  // Pole and pull chain.
  rect(ctx, 8, 10, 1, 31, INK);
  rect(ctx, 12, 10, 1, 5, MUTED); rect(ctx, 11, 15, 3, 2, INK);
  // Base.
  box(ctx, 3, 41, 11, 4, WHITE);
  rect(ctx, 4, 45, 9, 1, INK);
  return canvas;
}

function blocksSprite() {
  const { canvas, ctx } = makeCanvas(21, 22);
  const cube = (x: number, y: number, s: number, face: string, top: string, letter: string, color: string) => {
    box(ctx, x, y, s, 4, top);
    box(ctx, x, y + 3, s, s - 2, face);
    drawText(ctx, letter, x + Math.floor((s - 5) / 2), y + 4 + Math.floor((s - 9) / 2), { scale: 1, color });
  };
  cube(0, 10, 11, PAPER, WHITE, "R", INK);
  cube(10, 11, 11, INK, MUTED, "F", GREEN);
  cube(5, 0, 11, GREEN, WHITE, "♥", INK);
  return canvas;
}

const DUCK = bitmap([
  "....###.....",
  "...#www#....",
  "...#w#ww#...",
  "...#wwwGG#..",
  ".#..#www#...",
  "#w#.#wwww#..",
  "#ww##wwwww#.",
  "#wwwwwwwww#.",
  ".#wwwwwsw#..",
  "..#######...",
]);

function poufSprite() {
  const { canvas, ctx } = makeCanvas(26, 16);
  ellipseBox(ctx, 13, 9, 12, 6, PAPER);
  ellipseBox(ctx, 13, 6, 12, 5, WHITE);
  for (let x = 3; x < 24; x += 3) rect(ctx, x, 9 + (x % 2), 1, 2, SHADE);
  rect(ctx, 12, 5, 2, 2, INK);
  rect(ctx, 11, 5, 1, 1, SHADE); rect(ctx, 14, 6, 1, 1, SHADE);
  return canvas;
}

export type Prop = Readonly<{ sprite: HTMLCanvasElement; x: number; y: number; baseY: number; shadow?: readonly [number, number, number, number] }>;

function buildProps(): Prop[] {
  const fern = pottedPlant("fern"), tall = pottedPlant("tall"), bush = pottedPlant("bush");
  // Positions are art top-left; baseY is the logical feet line used for depth sorting.
  return [
    { sprite: lampSprite(), x: 16, y: 105, baseY: 151 * A, shadow: [24, 150, 9, 2] },
    { sprite: blocksSprite(), x: 87, y: 165, baseY: 187 * A, shadow: [97, 186, 11, 2] },
    { sprite: DUCK, x: 243, y: 124, baseY: 134 * A, shadow: [249, 134, 6, 1] },
    { sprite: poufSprite(), x: 272, y: 141, baseY: 157 * A, shadow: [285, 156, 12, 2] },
    { sprite: bush, x: 209, y: 33, baseY: 67 * A, shadow: [221, 66, 10, 2] },
    { sprite: bush, x: 274, y: 33, baseY: 67 * A, shadow: [286, 66, 10, 2] },
    { sprite: tall, x: 296, y: 26, baseY: 72 * A, shadow: [305, 71, 7, 2] },
    { sprite: fern, x: 102, y: 30, baseY: 59 * A, shadow: [112, 58, 7, 1] },
  ];
}

// ---------------------------------------------------------------------------------------------
// Static room layer

function paintWalls(ctx: CanvasRenderingContext2D) {
  // Wallpaper: soft vertical stripes with tiny hearts, wainscot and baseboard.
  rect(ctx, 0, 0, ART_W, WALL, PAPER);
  for (let x = SIDE; x < ART_W - SIDE; x += 12) rect(ctx, x + 4, 3, 4, 34, GRID);
  for (let x = SIDE + 10; x < ART_W - SIDE; x += 24) for (let y = 8; y < 36; y += 14) {
    const ox = ((y / 14) | 0) % 2 ? 12 : 0;
    rect(ctx, x + ox, y, 1, 1, SHADE); rect(ctx, x + ox + 2, y, 1, 1, SHADE); rect(ctx, x + ox, y + 1, 3, 1, SHADE); rect(ctx, x + ox + 1, y + 2, 1, 1, SHADE);
  }
  rect(ctx, 0, 0, ART_W, 2, INK);
  rect(ctx, 0, 37, ART_W, 1, INK);
  rect(ctx, 0, 38, ART_W, 1, WHITE);
  rect(ctx, 0, 39, ART_W, 11, GRID);
  for (let x = SIDE + 5; x < ART_W - SIDE; x += 10) rect(ctx, x, 40, 1, 10, SHADE);
  rect(ctx, 0, 50, ART_W, 1, INK);
  rect(ctx, 0, 51, ART_W, 2, WHITE);
  rect(ctx, 0, 53, ART_W, 1, INK);
}

function paintFloor(ctx: CanvasRenderingContext2D) {
  rect(ctx, 0, WALL, ART_W, FRONT - WALL, PAPER);
  for (let x = SIDE + 16; x < ART_W - SIDE; x += 16) rect(ctx, x, WALL, 1, FRONT - WALL, GRID);
  for (let y = WALL + 16; y < FRONT; y += 16) rect(ctx, SIDE, y, ART_W - SIDE * 2, 1, GRID);
  // Tiny tile studs where grid lines cross.
  for (let x = SIDE + 16; x < ART_W - SIDE; x += 16) for (let y = WALL + 16; y < FRONT; y += 16) rect(ctx, x, y, 1, 1, SHADE);
  // Contact shadow under the back wall.
  dither(ctx, SIDE, WALL, ART_W - SIDE * 2, 1, INK, 2);
  dither(ctx, SIDE, WALL + 1, ART_W - SIDE * 2, 1, INK, 4);
}

function paintFrame(ctx: CanvasRenderingContext2D) {
  // Side and front walls, seen from above: thick ink with a paper cap line.
  rect(ctx, 0, 0, SIDE, ART_H, INK);
  rect(ctx, ART_W - SIDE, 0, SIDE, ART_H, INK);
  rect(ctx, 0, FRONT, ART_W, ART_H - FRONT, INK);
  rect(ctx, 4, 2, 1, FRONT + 2, MUTED);
  rect(ctx, ART_W - 5, 2, 1, FRONT + 2, MUTED);
  rect(ctx, 4, FRONT + 3, ART_W - 8, 1, MUTED);
  // Inner shadow along the side walls.
  dither(ctx, SIDE, WALL, 1, FRONT - WALL, INK, 2);
  dither(ctx, ART_W - SIDE - 1, WALL, 1, FRONT - WALL, INK, 2);
}

/** A daytime crescent moon hangs in the Moon Slingshot's window. */
const MOON = bitmap([".###.", "#GG#.", "#G#..", "#G#..", "#G#..", "#GG#.", ".###."]);

/** The view through a window: sky, a cloud, far hills (and the moon for the slingshot's window). */
function paintView(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, moon: boolean) {
  const random = rng(seed);
  rect(ctx, x + 1, y + 2, w - 2, h - 3, WHITE);
  const cx = x + 5 + Math.floor(random() * 8);
  rect(ctx, cx, y + 6, 7, 2, GRID); rect(ctx, cx + 2, y + 5, 3, 1, GRID); rect(ctx, cx + 1, y + 8, 6, 1, SHADE);
  if (moon) ctx.drawImage(MOON, x + w - 8, y + 3);
  for (let i = 1; i < w - 1; i++) {
    const hill = y + h - 6 - Math.round(2 + 2 * Math.sin((i + seed) / 3.2));
    rect(ctx, x + i, hill, 1, 1, INK);
    rect(ctx, x + i, hill + 1, 1, y + h - 1 - hill - 1, GREEN);
    if ((i + seed) % 3 === 0) rect(ctx, x + i, hill + 2, 1, 1, MOSS);
  }
}

function paintWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, moon: boolean) {
  box(ctx, x, y, w, h, WHITE);
  rect(ctx, x + 1, y + 1, w - 2, 1, INK);
  paintView(ctx, x, y, w, h, seed, moon);
  // Muntins and frame.
  rect(ctx, x + Math.floor(w / 2), y + 1, 1, h - 2, INK);
  rect(ctx, x + 1, y + Math.floor(h / 2), w - 2, 1, INK);
  rect(ctx, x + 2, y + 3, 1, 3, WHITE); rect(ctx, x + 3, y + 3, 2, 1, WHITE);
  // Sill and curtains.
  box(ctx, x - 3, y + h - 1, w + 6, 4, WHITE);
  for (const side of [x - 4, x + w - 2]) {
    box(ctx, side, y - 2, 6, h - 3, PAPER);
    for (let j = y + 1; j < y + h - 6; j += 3) rect(ctx, side + 2, j, 1, 2, SHADE);
    rect(ctx, side, y + h - 9, 6, 1, INK); rect(ctx, side + 1, y + h - 8, 4, 1, GREEN);
  }
  rect(ctx, x - 6, y - 3, w + 12, 1, INK);
  rect(ctx, x - 7, y - 4, 2, 3, INK); rect(ctx, x + w + 5, y - 4, 2, 3, INK);
}

function paintDoorFrame(ctx: CanvasRenderingContext2D) {
  const { x, y, w, h } = DOOR;
  rect(ctx, x, y, w, h, INK);
  rect(ctx, x + 1, y + 1, w - 2, h - 1, WHITE);
  rect(ctx, x + 2, y + 2, w - 4, h - 2, INK);
  // Sign: a tiny heart plaque above the door.
  box(ctx, x + 9, y - 7, 10, 7, WHITE);
  rect(ctx, x + 11, y - 5, 2, 1, GREEN); rect(ctx, x + 15, y - 5, 2, 1, GREEN); rect(ctx, x + 11, y - 4, 6, 1, GREEN); rect(ctx, x + 12, y - 3, 4, 1, GREEN); rect(ctx, x + 13, y - 2, 2, 1, GREEN);
  // Doormat.
  box(ctx, x - 2, WALL + 1, w + 4, 8, SHADE);
  dither(ctx, x - 1, WALL + 2, w + 2, 6, PAPER, 2);
  rect(ctx, x + 3, WALL + 4, w - 6, 1, INK); rect(ctx, x + 3, WALL + 6, w - 6, 1, INK);
}

function paintPortrait(ctx: CanvasRenderingContext2D, player: Creature) {
  const { x, y, w, h } = PORTRAIT;
  rect(ctx, x + 11, y - 5, 2, 5, INK); rect(ctx, x + 6, y - 1, 12, 1, INK);
  box(ctx, x, y, w, h, INK);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, INK);
  box(ctx, x + 2, y + 2, w - 4, h - 4, WHITE, GREEN);
  rect(ctx, x + 3, y + 3, w - 6, h - 6, PAPER);
  // The official portrait: no hat (the frame is only 18 pixels tall). The 16 x 16 box lands at (x + 4, y + 5).
  const frame = creatureFrame(player, "idle", "down", 0, undefined, undefined, null);
  ctx.drawImage(frame, x + 4 - BOX_X, y + 5 - BOX_Y);
  // Name plate.
  box(ctx, x + 5, y + h, w - 10, 4, WHITE);
  rect(ctx, x + 8, y + h + 1, w - 16, 1, MUTED);
  // Wall shadow.
  dither(ctx, x + w, y + 1, 1, h, INK, 2);
}

function paintArch(ctx: CanvasRenderingContext2D) {
  const { x, y, w } = ARCH.open;
  const cx = x + w / 2, radius = w / 2;
  const archTop = (px: number, r: number) => {
    const dx = px + 0.5 - cx;
    return Math.abs(dx) > r ? Infinity : y + radius - Math.sqrt(Math.max(0, r * r - dx * dx));
  };
  const inOpening = (px: number, py: number) => py >= archTop(px, radius) && py < WALL + 1 && px >= x && px < x + w;
  // The garden beyond.
  for (let py = y - 2; py < WALL; py++) for (let px = x; px < x + w; px++) {
    if (!inOpening(px, py)) continue;
    let color = WHITE;
    const hill = WALL - 16 - Math.round(2.5 * Math.sin((px - x) / 5) + 1.5 * Math.sin((px - x) / 2.3));
    if (py === hill) color = INK;
    else if (py > hill) color = py > WALL - 8 ? GREEN : ((px + py) % 2 === 0 ? GREEN : WHITE);
    rect(ctx, px, py, 1, 1, color);
  }
  rect(ctx, x + 6, y + 10, 9, 2, GRID); rect(ctx, x + 8, y + 9, 4, 1, GRID); rect(ctx, x + 7, y + 12, 7, 1, SHADE);
  for (const [bx, by] of [[x + 25, y + 5], [x + 30, y + 8]] as const) { rect(ctx, bx, by, 1, 1, INK); rect(ctx, bx + 1, by + 1, 1, 1, INK); rect(ctx, bx + 2, by, 1, 1, INK); }
  for (let px = x + 1; px < x + w - 1; px += 3) rect(ctx, px, WALL - 7 + ((px * 7) % 3), 1, 2, MOSS);
  rect(ctx, x + 31, WALL - 21, 1, 6, INK);
  ellipseBox(ctx, x + 31, WALL - 23, 3, 3, GREEN);
  rect(ctx, x + 30, WALL - 24, 1, 1, WHITE);
  // Hedge arch: a bumpy band of leaves around the opening.
  const band = 7;
  for (let py = y - band - 3; py < WALL; py++) for (let px = x - band - 3; px < x + w + band + 3; px++) {
    if (inOpening(px, py)) continue;
    const dx = px + 0.5 - cx, dy = py + 0.5 - (y + radius);
    const angle = Math.atan2(dy, dx);
    const bump = 1.4 * Math.sin(angle * 14) + 0.8 * Math.sin(angle * 5 + 1);
    const straight = py >= y + radius;
    const outer = straight ? Math.abs(dx) - (radius + band + (1.2 * Math.sin(py * 0.9) + 0.6)) : Math.hypot(dx, dy) - (radius + band + bump);
    if (outer > 0) continue;
    const inner = straight ? Math.abs(dx) - radius : Math.hypot(dx, dy) - radius;
    if (inner < 0 && !straight) continue;
    if (straight && Math.abs(dx) < radius) continue;
    const edge = outer > -1 || inner < 1;
    const speckle = (px * 7 + py * 13) % 11 === 0 ? MOSS : (px * 5 + py * 3) % 17 === 0 ? WHITE : GREEN;
    rect(ctx, px, py, 1, 1, edge ? INK : speckle);
  }
  // Flowers tucked in the hedge.
  for (const [a, r] of [[-2.6, 3], [-2.0, 4], [-1.4, 3], [-0.9, 4], [-0.35, 3], [2.9, 3], [0.2, 3]] as const) {
    const fx = Math.round(cx + Math.cos(a) * (radius + r)), fy = Math.round(y + radius + Math.sin(a) * (radius + r));
    rect(ctx, fx - 1, fy, 3, 1, WHITE); rect(ctx, fx, fy - 1, 1, 3, WHITE); rect(ctx, fx, fy, 1, 1, INK);
  }
  // Hanging sign with a leaf heart.
  rect(ctx, cx - 4, y - 1, 1, 4, INK); rect(ctx, cx + 3, y - 1, 1, 4, INK);
  box(ctx, cx - 6, y + 2, 12, 8, WHITE);
  rect(ctx, cx - 3, y + 4, 2, 1, GREEN); rect(ctx, cx + 1, y + 4, 2, 1, GREEN); rect(ctx, cx - 3, y + 5, 6, 1, GREEN); rect(ctx, cx - 2, y + 6, 4, 1, GREEN); rect(ctx, cx - 1, y + 7, 2, 1, GREEN);
  // Contact shadow on the floor in front of the opening.
  dither(ctx, x - 8, WALL, w + 16, 2, INK, 4);
}

function paintRug(ctx: CanvasRenderingContext2D) {
  const cx = 160, cy = 134;
  // Thickness, outline, a signal-green braid, then a calm body so creatures read clearly on it.
  ellipse(ctx, cx, cy + 2, 54, 22, INK);
  ellipse(ctx, cx, cy, 54, 22, INK);
  ellipse(ctx, cx, cy, 53, 21, GREEN);
  for (let a = 0; a < 96; a++) {
    const t = (a / 96) * Math.PI * 2;
    if (a % 3 === 0) rect(ctx, Math.round(cx + Math.cos(t) * 51.5), Math.round(cy + Math.sin(t) * 19.6), 1, 1, MOSS);
  }
  ellipse(ctx, cx, cy, 49, 18, INK);
  ellipse(ctx, cx, cy, 48, 17, SHADE);
  // Stitched inner ring.
  for (let a = 0; a < 80; a++) {
    if (a % 2) continue;
    const t = (a / 80) * Math.PI * 2;
    rect(ctx, Math.round(cx + Math.cos(t) * 43), Math.round(cy + Math.sin(t) * 14.2), 2, 1, WHITE);
  }
  // Soft sheen on the upper left.
  for (let a = 0; a < 18; a++) {
    const t = Math.PI * (1.05 + a * 0.028);
    rect(ctx, Math.round(cx + Math.cos(t) * 46), Math.round(cy + Math.sin(t) * 15.8), 2, 1, GRID);
  }
  // Tassels.
  for (const side of [-1, 1]) for (let j = -5; j <= 5; j += 2) rect(ctx, cx + side * 55 + (side < 0 ? -1 : 0), cy + j, 2, 1, INK);
}

function paintDecals(ctx: CanvasRenderingContext2D) {
  // Window light on the floor (sun from the upper left).
  for (const { x, w } of WINDOWS) {
    for (let j = 0; j < 30; j++) {
      const skew = Math.floor(j * 0.6);
      const y = WALL + 2 + j;
      const x0 = x + 1 + skew, width = w - 2;
      if (j < 26) rect(ctx, x0, y, width, 1, WHITE);
      else dither(ctx, x0, y, width, 1, WHITE, 2);
      rect(ctx, x0 + Math.floor(width / 2), y, 1, 1, GRID);
    }
  }
  // Lamp light pool.
  ellipse(ctx, 26, 151, 20, 7, WHITE);
  ditherEllipse(ctx, 26, 151, 23, 8, WHITE, 2);
  // Stepping stones towards the sanctuary.
  for (const [sx, sy] of [[216, 112], [232, 100], [246, 88], [252, 76]] as const) { ellipseBox(ctx, sx, sy, 5, 3, SHADE); rect(ctx, sx - 2, sy - 1, 3, 1, WHITE); }
}

/** Paints the static room (walls, floor, decals) on a 320 x 214 art canvas. */
export function paintRoom(player: Creature) {
  const { canvas, ctx } = makeCanvas(ART_W, ART_H);
  paintWalls(ctx);
  paintFloor(ctx);
  paintDecals(ctx);
  paintRug(ctx);
  WINDOWS.forEach((win, index) => paintWindow(ctx, win.x, win.y, win.w, win.h, index * 7 + 3, index === 1));
  paintPortrait(ctx, player);
  paintDoorFrame(ctx);
  paintArch(ctx);
  paintFrame(ctx);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Stations (pre-rendered bodies, animated details drawn per frame in art units)

function kioskBody() {
  const { canvas, ctx } = makeCanvas(KIOSK.w, KIOSK.h);
  const w = KIOSK.w;
  // Marquee.
  box(ctx, 2, 0, w - 4, 10, INK);
  rect(ctx, 3, 1, w - 6, 8, INK);
  drawText(ctx, "MATCH", w / 2, 2, { scale: 1, color: GREEN, align: "center" });
  // Cabinet with a side panel for depth.
  box(ctx, 1, 9, w - 2, 30, PAPER);
  rect(ctx, w - 6, 10, 4, 28, SHADE);
  rect(ctx, w - 7, 10, 1, 28, INK);
  // Screen bezel.
  box(ctx, 4, 11, w - 13, 25, WHITE);
  box(ctx, 6, 13, w - 17, 21, INK, INK, true);
  // Control deck.
  box(ctx, 0, 38, w, 8, WHITE);
  rect(ctx, 1, 44, w - 2, 1, SHADE);
  ellipseBox(ctx, 9, 41, 2, 1, GREEN);
  ellipseBox(ctx, 16, 41, 2, 1, INK);
  rect(ctx, 28, 38, 1, 3, INK); ellipseBox(ctx, 28, 38, 2, 1, INK);
  rect(ctx, 33, 41, 5, 1, INK);
  // Base with a heart coin slot.
  box(ctx, 2, 45, w - 4, 8, PAPER);
  rect(ctx, w - 7, 46, 4, 6, SHADE); rect(ctx, w - 8, 46, 1, 6, INK);
  box(ctx, 14, 47, 9, 4, INK);
  rect(ctx, 17, 48, 1, 1, GREEN); rect(ctx, 19, 48, 1, 1, GREEN); rect(ctx, 17, 49, 3, 1, GREEN);
  return canvas;
}

function incubatorBody() {
  const { canvas, ctx } = makeCanvas(INCUBATOR.w, INCUBATOR.h);
  const cx = 24;
  // Wall pipes.
  rect(ctx, 0, 19, 7, 4, INK); rect(ctx, 1, 20, 6, 2, WHITE);
  rect(ctx, 41, 19, 7, 4, INK); rect(ctx, 41, 20, 6, 2, WHITE);
  rect(ctx, 0, 17, 2, 8, INK); rect(ctx, 46, 17, 2, 8, INK);
  // Dome cap.
  box(ctx, cx - 5, 0, 10, 5, PAPER);
  rect(ctx, cx - 1, 1, 2, 1, INK);
  // Glass dome.
  ellipseBox(ctx, cx, 22, 18, 18, WHITE);
  rect(ctx, 5, 36, 38, 4, WHITE);
  // Glass highlights: a long reflection and a glint.
  for (let a = 0; a < 11; a++) { const t = Math.PI * (1.08 + a * 0.045); rect(ctx, Math.round(cx + Math.cos(t) * 14.5), Math.round(22 + Math.sin(t) * 14.5), 1, 2, GRID); }
  for (let a = 0; a < 5; a++) { const t = Math.PI * (1.14 + a * 0.05); rect(ctx, Math.round(cx + Math.cos(t) * 12), Math.round(22 + Math.sin(t) * 12), 1, 1, SHADE); }
  rect(ctx, cx + 12, 11, 1, 3, GRID); rect(ctx, cx + 13, 14, 1, 1, GRID);
  // Heat lamp hanging from the cap.
  rect(ctx, cx, 5, 1, 4, INK);
  box(ctx, cx - 3, 8, 7, 3, PAPER);
  // Straw nest.
  ellipse(ctx, cx, 36, 14, 3, INK);
  ellipse(ctx, cx, 36, 13, 2, PAPER);
  for (let i = -12; i <= 12; i += 2) rect(ctx, cx + i, 35 + ((i / 2) & 1), 2, 1, i % 4 === 0 ? SHADE : MUTED);
  // Metal collar where the dome meets the base.
  rect(ctx, 5, 36, 38, 1, INK);
  for (let x = 8; x < 42; x += 6) rect(ctx, x, 38, 1, 1, MUTED);
  // Base.
  box(ctx, 3, 37, 42, 4, WHITE);
  box(ctx, 4, 40, 40, 19, PAPER);
  rect(ctx, 39, 41, 4, 17, SHADE); rect(ctx, 38, 41, 1, 17, INK);
  box(ctx, 9, 43, 26, 10, INK, INK, true);
  // Feet.
  rect(ctx, 7, 59, 6, 2, INK); rect(ctx, 35, 59, 6, 2, INK);
  return canvas;
}

/** Plate crescent on the slingshot's crate (lit per frame). */
const PLATE_MOON = ["..##.", ".##..", "###..", "###..", "###..", ".##..", "..##."], PLATE_Y = 38;

function slingshotBody() {
  const { canvas, ctx } = makeCanvas(SLING.w, SLING.h);
  const { w } = SLING;
  // Launch pad: a wooden crate, the fork planted in its lid, the Moon plate on its front.
  box(ctx, 0, 29, w, 8, WHITE);
  rect(ctx, 1, 31, w - 2, 1, GRID); rect(ctx, 1, 34, w - 2, 1, GRID);
  box(ctx, 0, 36, w, 12, PAPER);
  rect(ctx, 1, 37, w - 2, 9, INK);
  PLATE_MOON.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") rect(ctx, 2 + i, PLATE_Y + j, 1, 1, MOSS); });
  drawText(ctx, "×10", 9, PLATE_Y, { scale: 1, color: GREEN });
  rect(ctx, 1, 46, w - 2, 1, SHADE);
  ditherEllipse(ctx, 15, 33, 6, 1, INK, 2);
  // The Y fork: one round branch, lit from the left. Arms rise straight from the tips, then curve into the trunk.
  const span = (y: number): readonly [number, number] => {
    if (y >= 30) return [9, 18];
    if (y >= 19) return [10, 17];
    if (y === 0) return [2, 4];
    const outer = Math.round(1 + 9 * Math.pow((y - 1) / 18, 2));
    return [outer, outer + 4];
  };
  const wood = (x: number, y: number) => {
    if (y < 0 || y > 32 || x < 0 || x >= w) return false;
    const [a, b] = span(y), mirrored = w - 1 - x;
    return (x >= a && x <= b) || (mirrored >= a && mirrored <= b);
  };
  for (let y = 0; y <= 32; y++) for (let x = 0; x < w; x++) {
    if (!wood(x, y)) continue;
    const edge = !wood(x - 1, y) || !wood(x + 1, y) || !wood(x, y - 1) || !wood(x, y + 1);
    rect(ctx, x, y, 1, 1, edge ? INK : !wood(x - 2, y) ? WHITE : !wood(x + 2, y) || !wood(x + 3, y) ? MUTED : SHADE);
  }
  // Grain and a knot on the trunk.
  rect(ctx, 13, 22, 1, 3, MUTED); rect(ctx, 12, 27, 1, 2, MUTED); ellipseBox(ctx, 14, 25, 1, 1, MUTED);
  // Rubber band tied round each tip.
  for (const x of [2, w - 5]) { rect(ctx, x, 3, 3, 1, GREEN); rect(ctx, x, 4, 3, 1, MOSS); }
  return canvas;
}

export type RoomState = Readonly<{
  time: number;
  eggs: number;
  /** Time (ms) the egg count last increased, for the drop-in animation. */
  eggChangedAt: number;
  near: StationId | null;
  hover: StationId | null;
  pressedAt: Record<StationId, number>;
  doorOpen: number;
  gateOpen: number;
  /** Window 2 swings open for a launch (0 shut, 1 open). */
  windowOpen: number;
  sling: SlingPose;
  reducedMotion: boolean;
}>;

const EGG = bitmap([
  "..###..",
  ".#www#.",
  "#wwwww#",
  "#wGwww#",
  "#wwwwG#",
  "#wwGww#",
  ".#www#.",
  "..###..",
]);
/** The egg on the incubator's counter: digit height, with the HUD egg icon's shine. */
const COUNTER_EGG = ["..#..", ".###.", "#.###", "#####", "#####", "#####", ".###."];

export function createRoom(player: Creature) {
  const base = paintRoom(player);
  const props = buildProps();
  const kiosk = kioskBody();
  const incubator = incubatorBody();
  const slingshot = slingshotBody();

  const press = (state: RoomState, id: StationId) => {
    const since = state.time - (state.pressedAt[id] ?? -1e9);
    return since < 180 ? Math.sin((since / 180) * Math.PI) : 0;
  };

  function drawKiosk(ctx: CanvasRenderingContext2D, state: RoomState) {
    const { time, reducedMotion } = state;
    const squash = press(state, "matchmaker");
    const ox = KIOSK.x, oy = KIOSK.y + Math.round(squash);
    ditherEllipse(ctx, ox + KIOSK.w / 2, KIOSK.y + KIOSK.h, 24, 3, INK, 2);
    ctx.drawImage(kiosk, ox, oy);
    const awake = state.near === "matchmaker" || state.hover === "matchmaker";
    // Screen: beating heart and a heartbeat trace.
    const sx = ox + 7, sy = oy + 14, sw = KIOSK.w - 19, sh = 19;
    const period = awake ? 620 : 1100;
    const phase = reducedMotion ? 0.5 : (time % period) / period;
    const beat = !reducedMotion && (phase < 0.12 || (phase > 0.2 && phase < 0.3));
    const heart = beat ? [".##...##.", "####.####", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."]
      : ["", ".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."].map(row => row && "." + row);
    const hx = sx + Math.floor(sw / 2) - 4, hy = sy + 2;
    heart.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") rect(ctx, hx + i, hy + j, 1, 1, GREEN); });
    // Trace.
    const baseline = sy + sh - 5;
    const sweep = reducedMotion ? sw : Math.floor((time / (awake ? 18 : 28)) % (sw + 8));
    for (let i = 0; i < sw; i++) {
      const cycle = (i + 40) % 16;
      const dy = cycle === 6 ? -3 : cycle === 7 ? 2 : cycle === 8 ? -1 : 0;
      const age = sweep - i;
      if (age < 0 || age > sw) continue;
      rect(ctx, sx + i, baseline + dy, 1, 1, age < 3 ? WHITE : age < sw * 0.6 ? GREEN : MOSS);
    }
    // Marquee bulbs.
    const on = reducedMotion ? true : Math.floor(time / 300) % 2 === 0;
    for (let i = 0; i < 2; i++) rect(ctx, ox + 3 + i * (KIOSK.w - 7), oy + 3, 1, 4, (on ? i === 0 : i === 1) ? GREEN : MUTED);
    if (awake && !reducedMotion) {
      // Scanline shimmer.
      const scan = sy + Math.floor((time / 60) % sh);
      ctx.globalAlpha = 0.18; rect(ctx, sx, scan, sw, 1, WHITE); ctx.globalAlpha = 1;
    }
  }

  function drawIncubator(ctx: CanvasRenderingContext2D, state: RoomState) {
    const { time, eggs, reducedMotion } = state;
    const squash = press(state, "incubator");
    const ox = INCUBATOR.x, oy = INCUBATOR.y + Math.round(squash);
    ditherEllipse(ctx, ox + INCUBATOR.w / 2, INCUBATOR.y + INCUBATOR.h - 1, 22, 2, INK, 2);
    ctx.drawImage(incubator, ox, oy);
    const cx = ox + 24;
    const awake = state.near === "incubator" || state.hover === "incubator";
    // Heat lamp: lit while eggs wait, with a crisp dithered light cone that breathes.
    const lit = eggs > 0;
    rect(ctx, cx - 2, oy + 11, 5, 1, lit ? GREEN : MUTED);
    if (lit) {
      const breathe = reducedMotion ? 0 : Math.round((Math.sin(time / 520) + 1) * 1.5);
      for (let y = 0; y < 16; y++) {
        const half = 2 + Math.floor(y * 0.7) + breathe;
        for (let x = -half; x <= half; x++) {
          const px = cx + x, py = oy + 13 + y;
          if (y % 2 === 0 && (px + ((py >> 1) & 1) * 2) % 4 === 0 && Math.abs(x) < half - (y > 12 ? 2 : 0)) rect(ctx, px, py, 1, 1, GREEN);
        }
      }
    }
    // Eggs in the nest.
    const visible = Math.min(3, eggs);
    const slots = visible === 1 ? [0] : visible === 2 ? [-5, 5] : [-9, 0, 9];
    const dropAge = time - state.eggChangedAt;
    for (let i = 0; i < visible; i++) {
      const newest = i === visible - 1 && dropAge < 520 && !reducedMotion;
      let lift = 0;
      if (newest) { const t = dropAge / 520; lift = t < 0.6 ? Math.round((1 - t / 0.6) * 22) : Math.round(Math.sin(((t - 0.6) / 0.4) * Math.PI) * 2); }
      const wobbling = !reducedMotion && Math.floor(time / 2200 + i * 0.37) % 3 === 0 && (time / 90 + i) % 24 < 6;
      const shift = wobbling ? (Math.floor(time / 90) % 2 ? 1 : -1) : 0;
      ctx.drawImage(EGG, cx + slots[i] - 3 + shift, oy + 26 - lift + (i === 1 && visible === 3 ? -2 : 0));
    }
    // Counter display: an egg and the number of eggs waiting (no "x", so it never reads like the slingshot's multiplier).
    const dx = ox + 10, dy = oy + 44;
    const count = eggs > 99 ? "99+" : String(eggs);
    const color = eggs > 0 ? GREEN : MUTED;
    COUNTER_EGG.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") rect(ctx, dx + 1 + i, dy + 1 + j, 1, 1, color); });
    drawText(ctx, count, dx + 8, dy + 1, { scale: 1, color, spacing: 1 });
    // Status lights.
    for (let i = 0; i < 3; i++) {
      const lit = eggs > 0 && (reducedMotion || awake || Math.floor(time / 380) % 3 === i);
      rect(ctx, ox + 11 + i * 4, oy + 55, 2, 2, lit ? GREEN : INK);
    }
    // Cap light.
    rect(ctx, cx - 1, oy + 1, 2, 1, eggs > 0 && (reducedMotion || Math.floor(time / 500) % 2 === 0) ? GREEN : INK);
  }

  /** Band strand: green rubber two pixels thick (the second towards `side`), edged in ink. */
  function strand(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, side: -1 | 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const steep = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
    const [ex, ey] = steep ? [side, 0] : [0, 1];
    const run = (color: string, from: number, to: number) => {
      for (let i = 0; i <= steps; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / steps), y = Math.round(y0 + ((y1 - y0) * i) / steps);
        for (let k = from; k <= to; k++) rect(ctx, x + ex * k, y + ey * k, 1, 1, color);
      }
    };
    run(INK, -1, 2);
    run(GREEN, 0, 1);
  }

  /** The leather pouch, 16 art px wide, seat row at y. front: only the lip that covers a rider's feet. */
  function pouch(ctx: CanvasRenderingContext2D, x: number, y: number, front: boolean) {
    if (!front) rect(ctx, x + 7, y - 1, 14, 1, INK);
    rect(ctx, x + 6, y, 16, 2, INK);
    rect(ctx, x + 7, y + 2, 14, 1, INK);
    for (let i = 8; i < 20; i += 2) rect(ctx, x + i, y + 1, 1, 1, MUTED);
  }

  const slingAt = (state: RoomState) => {
    const oy = SLING.y + Math.round(press(state, "slingshot"));
    const awake = state.near === "slingshot" || state.hover === "slingshot";
    const { dx, dy } = pouchOffset(state.sling, state.time, awake, state.reducedMotion);
    return { ox: SLING.x, oy, awake, px: SLING.x + dx, py: oy + POUCH_ROW + dy };
  };

  function drawSlingshot(ctx: CanvasRenderingContext2D, state: RoomState) {
    const { time, reducedMotion, sling } = state;
    const { ox, oy, awake, px, py } = slingAt(state);
    ditherEllipse(ctx, ox + SLING.w / 2, SLING.y + SLING.h, 16, 2, INK, 2);
    ctx.drawImage(slingshot, ox, oy);
    // Plate moon: lit while the slingshot is awake or loaded, otherwise it glimmers now and then.
    const lit = awake || sling.loaded || reducedMotion || Math.floor(time / 700) % 4 === 0;
    if (lit) PLATE_MOON.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") rect(ctx, ox + 2 + i, oy + PLATE_Y + j, 1, 1, GREEN); });
    // Band from the tips to the pouch, behind a rider.
    strand(ctx, ox + 6, oy + 3, px + 7, py, 1);
    strand(ctx, ox + SLING.w - 7, oy + 3, px + SLING.w - 8, py, -1);
    pouch(ctx, px, py, false);
    // Twang: motion ticks by the tips just after a snap.
    const since = time - sling.snapAt;
    if (!reducedMotion && since >= 0 && since < 260) {
      const jitter = Math.floor(since / 50) % 2;
      for (let i = 0; i < 3; i++) {
        const out = (i === 1 ? 3 : 2) + jitter;
        rect(ctx, ox - out, oy + i * 3, 2, 1, INK);
        rect(ctx, ox + SLING.w - 2 + out, oy + i * 3, 2, 1, INK);
      }
    }
  }

  /** The pouch lip, drawn over the feet of a baby sitting in it (depth sorted just in front of the rider). */
  function drawSlingshotFront(ctx: CanvasRenderingContext2D, state: RoomState) {
    if (!state.sling.loaded) return;
    const { px, py } = slingAt(state);
    pouch(ctx, px, py, true);
  }

  /** Window 2 swung open: the view without glass, casements folded back on their hinges. */
  function drawWindow(ctx: CanvasRenderingContext2D, open: number) {
    if (open <= 0.01) return;
    const { x, y, w, h } = WINDOWS[1];
    paintView(ctx, x, y, w, h, 10, true);
    const half = (w - 2) / 2;
    for (const side of [0, 1] as const) {
      const width = Math.max(2, Math.round(half * (1 - open * 0.8)));
      const left = side === 0 ? x + 1 : x + w - 1 - width;
      box(ctx, left, y + 1, width, h - 1, GRID);
      if (width > 4) rect(ctx, left + (side === 0 ? 1 : width - 2), y + 3, 1, h - 6, WHITE);
    }
  }

  function drawDoor(ctx: CanvasRenderingContext2D, open: number) {
    const { x, y, w, h } = DOOR_PANEL;
    if (open <= 0.01) {
      box(ctx, x, y, w, h + 1, PAPER);
      box(ctx, x + 3, y + 3, w - 6, 13, GRID);
      box(ctx, x + 3, y + 19, w - 6, 16, GRID);
      rect(ctx, x + w - 4, y + 18, 2, 2, INK);
      rect(ctx, x + 7, y + 7, 2, 1, GREEN); rect(ctx, x + 11, y + 7, 2, 1, GREEN); rect(ctx, x + 7, y + 8, 6, 1, GREEN); rect(ctx, x + 8, y + 9, 4, 1, GREEN); rect(ctx, x + 9, y + 10, 2, 1, GREEN);
      return;
    }
    // Open: dark hallway and the door swung towards the room on its hinge.
    rect(ctx, x, y, w, h + 1, INK);
    dither(ctx, x, y + h - 6, w, 7, MUTED, 4);
    const leafW = Math.max(3, Math.round(w * (1 - open * 0.8)));
    box(ctx, x, y, leafW, h + 3, PAPER);
    if (leafW > 6) rect(ctx, x + leafW - 3, y + 18, 1, 2, INK);
  }

  function drawGate(ctx: CanvasRenderingContext2D, open: number) {
    const { x, w } = ARCH.open;
    const gateTop = WALL - 16;
    const half = w / 2;
    for (const side of [0, 1] as const) {
      const width = Math.max(2, Math.round(half * (1 - open * 0.75)));
      const left = side === 0 ? x : x + w - width;
      rect(ctx, left, gateTop + 5, width, 1, INK);
      rect(ctx, left, gateTop + 11, width, 1, INK);
      for (let i = 0; i < width; i += 4) {
        const px = side === 0 ? left + i : left + width - 3 - i;
        if (px < left || px + 3 > left + width + 0) continue;
        rect(ctx, px, gateTop + 1, 3, 15, INK);
        rect(ctx, px + 1, gateTop + 2, 1, 13, WHITE);
        rect(ctx, px + 1, gateTop, 1, 1, INK);
      }
    }
  }

  return {
    base, props, drawKiosk, drawIncubator, drawSlingshot, drawSlingshotFront, drawDoor, drawGate, drawWindow,
    kioskBaseY: (KIOSK.y + KIOSK.h) * A, incubatorBaseY: (INCUBATOR.y + INCUBATOR.h) * A, slingshotBaseY: SLING_BASE_Y,
  };
}

