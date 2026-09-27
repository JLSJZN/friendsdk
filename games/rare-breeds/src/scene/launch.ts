// The Moon Slingshot flight: the slingshot tosses the baby out of the nursery window onto a tiny firework rocket
// on a raft in the pond. Lit, it climbs past the nursery roof (x1.5), cloud nine (x2), the orbit (x4) and up to the
// Moon (x10). A jump ends with a parachute into the hay; a rocket that gives out first sputters and drops the baby
// in the pond (the duck gag); x10 lands it on the Moon. Side view on the room's 3 px art grid; the baby rides at
// sprite scale 8 so it reads on phones. Portrait frames show a slice of the 960 x 640 composition, about
// PORTRAIT_W wide and as tall as the frame (more sky above), panned to the action: the window and the rocket on
// the pad, the landmarks during the climb, then the pond, the hay or the Moon. The flight clock and every rule
// live in the UI and src/slingshot.ts: this only draws what it is told (ignite, fly(ms), end).
import { WORLD_HEIGHT as H, WORLD_WIDTH as W, type LaunchBeat, type LaunchSequence, type LaunchSequenceOptions } from "../api.ts";
import { FLIGHT_MS, flightHundredths, multiplierLabel, type FlightEnd } from "../slingshot.ts";
import { FRAME_SIZE, type Clip, type Facing, type Frame } from "../types.ts";
import {
  GREEN, GRID, INK, MOSS, MUTED, PAPER, SHADE, WHITE, bitmap, box, clamp, dither, easeInCubic, easeOutBack, easeOutCubic,
  ellipseBox, lerp, makeCanvas, rect, rng,
} from "./art.ts";
import { paintCreature } from "./creatures.ts";
import { drawText, textWidth } from "./font.ts";
import { createParticles } from "./fx.ts";
import { createPixelView } from "./view.ts";

type Point = { x: number; y: number };
/** How the baby is drawn. x, y: centre of its 16 x 16 box (world px, or screen px on the Moon). */
type Pose = {
  x: number; y: number;
  /** Quarter turns clockwise. */
  rot: number;
  clip: Clip; facing: Facing; frame: number;
  /** Screen-space squash and stretch around (ax, ay), default the box centre. */
  sx: number; sy: number; ax?: number; ay?: number;
  /** Nothing below this y is drawn (the water line); `under` shows that part as a dim silhouette. */
  cut?: number;
  under?: boolean;
};
type Chute = { open: number; x: number; y: number; flat: number };

const A = 3, S = 8, HALF = 8 * S, BOX = 16 * S;
const ART_W = W / A, ART_H = Math.ceil(H / A);

/** How long the final frame keeps its gentle idle after the ending before it holds still. */
const IDLE_MS = 2000;
// Ending timelines (ms after end()). The crash fall and the parachute descent last longer from higher up.
const END = {
  pad: { look: 330, topple: 720, land: 1050 },
  air: { look: 140, pop: 420 },
  pond: { sink: 80, duck: 170, surface: 350, spit: 440, end: 1220 },
  jump: { hop: 260, settle: 760 },
  moon: { cut: 130, land: 900, flag: 1160, rays: 1360, end: 2150 },
} as const;

// World layout (logical px; ground is y = 0, up is negative).
/** Camera top when the ground is framed (ground line at screen y 480). */
const GROUND_CAM = -480;
/** The nursery facade (art canvas, 120 x 132 art px) and its open window. */
const HOUSE = { x: -390, y: -396, win: { x: 62, y: 54, w: 44, h: 42 } };
const ROOF_PEAK: Point = { x: HOUSE.x + 60 * A, y: HOUSE.y + 4 * A };
const POND = { x0: 30, x1: 500, surface: 6, depth: 22 };
/** The rocket climbs straight up from a raft on the pond. */
const FLIGHT_X = 190, RAFT = { w: 96, top: -3 };
/** Rocket parts relative to the baby's box centre (the baby rides strapped to the front of the tube). */
const ROCKET = { tube: 42, top: -81, bottom: 99, nose: 42, stick: 189 };
const PAD_Y = RAFT.top - ROCKET.stick;
/** Camera left for the pad and the climb: the flight column sits at screen x 440, with the nursery window in view. */
const CAM_X = FLIGHT_X - 440;
const SPLASH_X = FLIGHT_X + 90, DUCK_X = SPLASH_X + 112;
const HAY = { cx: 700, w: 74, h: 54 };
const HAY_TOP = -HAY.h * A;
const HAY_CAM_X = HAY.cx - 480;
const HOUSES = [
  { cx: 1010, w: 44, wall: 36, roof: 22, chimney: 1 },
  { cx: 1210, w: 72, wall: 46, roof: 46, chimney: -1 },
  { cx: 1420, w: 46, wall: 34, roof: 24, chimney: 0 },
  { cx: 1590, w: 52, wall: 40, roof: 28, chimney: 1 },
] as const;
const OVERHANG = 4;
/** Height of the baby above the pad after `ms` of flight; it speeds up as it climbs. */
const altitude = (ms: number) => { const u = clamp(ms / FLIGHT_MS); return 1100 * u + 1400 * u * u; };
const flightY = (ms: number) => PAD_Y - altitude(ms);
/** Where the baby is when the multiplier shows `hundredths`: every landmark sits at its multiplier. */
const levelAt = (hundredths: number) => flightY(FLIGHT_MS * Math.log10(hundredths / 100));
const ROOF_FLAG_Y = levelAt(150);
const CLOUD9 = { cx: FLIGHT_X + 300, cy: Math.round(levelAt(200)), w: 92, h: 34 };
const ORBIT_Y = Math.round(levelAt(400));
/** Decorative clouds along the climb (world px, art size, seed). */
const CLOUDS = [
  [-150, -560, 46, 16, 1], [650, -470, 40, 14, 2], [-70, -830, 58, 20, 3], [600, -960, 50, 18, 4], [-190, -1110, 62, 22, 5], [430, -1210, 56, 20, 6],
] as const;
const LAND = { x0: -600, y0: -420, w: 860, h: 200 };
/** Sky ramp rows (world px); the top reaches past the Moon's height for tall portrait frames (a multiple of 12 higher, same dither). */
const SKY = { y0: -4080, y1: 240 };
// The Moon landing (screen px).
const MOON_TOP: Point = { x: 560, y: 430 }, MOON_R = 900;
const EARTH_FAR = { x: 190, y: 372, r: 48 };
const DAY_MOON = { x: 800, y: 118, r: 27 };
/**
 * Portrait frames: the visible slice is PORTRAIT_W logical px wide and the frame's height tall (the 640 px band sits at
 * the bottom, more sky above). The slice centres on these plane x positions (screen px of the 960 x 640 composition):
 * the nursery window and the rocket on the pad, the flight column with cloud nine's and the orbit's tags, the pond
 * with the duck, the hay field, the Moon landing.
 */
const PORTRAIT_W = 540;
const FOCUS = { ready: 300, climb: 510, pond: 494, jump: 480, moon: MOON_TOP.x } as const;

const WATER = MUTED, WATER_LIGHT = "#A39E94", WATER_DEEP = "#77726A", ROOF = "#2E2E2E", STRAW = "#EADBA8", STRAW_DARK = "#C9B278";
const GOLD = "#FFE27A", ORANGE = "#FFB800";
const SKY_RAMP = [WHITE, PAPER, GRID, SHADE, "#BDB6A8", MUTED, "#6A655D", "#45423D", "#2A2927", "#1A1A1A", INK];
const PRISM = ["#FF4D6D", ORANGE, GREEN, "#3DDCFF", "#8A4DFF", WHITE];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
/** Exact quarter-turn rotations (cos, sin) so rotated sprites stay on whole pixels. */
const TURN = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
/** Earth continents and Moon craters in disc units: centre u, v and radii. */
const CONTINENTS = [
  [0.05, -0.93, 0.34, 0.07], [-0.32, -0.9, 0.16, 0.07], [0.42, -0.88, 0.1, 0.06],
  [-0.5, -0.45, 0.2, 0.13], [-0.38, -0.3, 0.13, 0.15], [-0.6, -0.26, 0.09, 0.1], [-0.28, -0.52, 0.1, 0.07],
  [0.45, -0.22, 0.12, 0.2], [0.56, 0.03, 0.1, 0.14], [0.42, 0.24, 0.07, 0.11],
  [0, 0.36, 0.18, 0.11], [0.1, 0.5, 0.1, 0.09], [-0.13, 0.27, 0.08, 0.08],
  [1.12, -0.35, 0.18, 0.13], [1.22, -0.14, 0.11, 0.13], [-1.2, 0.2, 0.15, 0.15], [-1.3, 0.02, 0.1, 0.1],
] as const;
/** Tiny pocks near the top of the Moon, where the baby lands (disc units). */
const SPECKS = Array.from({ length: 70 }, (_, i) => {
  const random = rng(900 + i);
  const u = (random() - 0.5) * 1.3, v = -Math.sqrt(Math.max(0, 1 - u * u)) + 0.008 + random() * 0.14;
  return [u, v] as const;
});
const MARIA = [[-0.3, -0.22, 0.34, 0.24], [0.26, 0.34, 0.3, 0.18]] as const;
const CRATERS = [[-0.35, -0.55, 0.13, 0.07], [0.3, -0.72, 0.09, 0.045], [-0.6, -0.1, 0.16, 0.11], [0.45, 0.05, 0.12, 0.09], [0.1, 0.45, 0.2, 0.13], [-0.25, 0.3, 0.1, 0.07], [0.12, -0.93, 0.07, 0.018], [-0.2, -0.955, 0.05, 0.012], [0.3, -0.975, 0.04, 0.009], [-0.36, -0.93, 0.06, 0.02], [0.48, -0.9, 0.05, 0.02]] as const;

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
const DROP = bitmap([".#.", "#w#", "#w#", ".#."]);

const smooth = (x: number) => { x = clamp(x); return x * x * (3 - 2 * x); };
const pack = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (255 << 24 | (n & 0xff) << 16 | ((n >> 8) & 0xff) << 8 | (n >> 16)) >>> 0;
};
/** Sky darkness at an altitude: 0 day, 1 space (reached just below the orbit). */
const darkness = (y: number) => Math.pow(clamp((-y - 200) / 1150), 1.4);
const multiplierText = (hundredths: number) => multiplierLabel(hundredths).replace(/^x/, "×");

function inkBox(frame: Frame) {
  let minX = FRAME_SIZE, maxX = -1, minY = FRAME_SIZE, maxY = -1;
  for (let i = 0; i < frame.length; i++) if (frame[i]) {
    const x = i % FRAME_SIZE, y = (i / FRAME_SIZE) | 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? { minX: 4, maxX: 11, minY: 2, maxY: 15 } : { minX, maxX, minY, maxY };
}

/** Pixel disc spans (art units): each(y, x0, x1) per row inside [top, bottom), x1 exclusive. */
function discRows(cx: number, cy: number, r: number, each: (y: number, x0: number, x1: number) => void, top = 0, bottom = ART_H) {
  const y0 = Math.max(top, Math.floor(cy - r)), y1 = Math.min(bottom - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy, h2 = r * r - dy * dy;
    if (h2 <= 0) continue;
    const half = Math.sqrt(h2);
    const x0 = Math.max(-2, Math.round(cx - half)), x1 = Math.min(ART_W + 2, Math.round(cx + half));
    if (x1 > x0) each(y, x0, x1);
  }
}
/** Span of a disc on one row, or null. */
function discSpan(cx: number, cy: number, r: number, y: number): [number, number] | null {
  const dy = y + 0.5 - cy, h2 = r * r - dy * dy;
  if (h2 <= 0) return null;
  const half = Math.sqrt(h2);
  return [Math.round(cx - half), Math.round(cx + half)];
}

// ---------------------------------------------------------------------------------------------
// Static art, painted once and shared by every flight

type Art = ReturnType<typeof paintArt>;
let cachedArt: Art | null = null;

function paintArt() {
  return {
    sky: paintSky(), hills: paintHills(), land: paintLand(), hay: paintHaystack(),
    stars: [paintStars(5, 70), paintStars(17, 30)] as const,
    clouds: CLOUDS.map(([, , w, h, seed]) => paintCloud(w, h, seed)),
    far: [paintCloud(54, 16, 21, true), paintCloud(40, 13, 22, true), paintCloud(64, 18, 23, true)],
    cloud9: paintCloud(CLOUD9.w, CLOUD9.h, 9),
  };
}

function paintSky() {
  const rows = Math.ceil((SKY.y1 - SKY.y0) / A);
  const { canvas, ctx } = makeCanvas(ART_W, rows);
  const image = ctx.createImageData(ART_W, rows);
  const pixels = new Uint32Array(image.data.buffer);
  const ramp = SKY_RAMP.map(pack), top = ramp.length - 1;
  for (let j = 0; j < rows; j++) {
    const level = darkness(SKY.y0 + j * A) * top, base = Math.floor(level), frac = level - base;
    for (let i = 0; i < ART_W; i++) pixels[j * ART_W + i] = ramp[Math.min(top, base + (frac > BAYER[(j & 3) * 4 + (i & 3)] ? 1 : 0))];
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Two bands of far hills, seamless across the art width. */
function paintHills() {
  const h = 60;
  const { canvas, ctx } = makeCanvas(ART_W, h);
  const wave = (x: number, periods: number, amp: number, phase: number) => Math.sin((x / ART_W) * Math.PI * 2 * periods + phase) * amp;
  const far = (x: number) => Math.round(32 + wave(x, 2, 6, 0.3) + wave(x, 5, 2, 1.7));
  const near = (x: number) => Math.round(46 + wave(x, 3, 4, 2.1) + wave(x, 7, 2, 0.4));
  for (let x = 0; x < ART_W; x++) {
    const a = far(x), b = far(x - 1);
    rect(ctx, x, a, 1, h - a, GRID);
    rect(ctx, x, Math.min(a, b), 1, Math.abs(a - b) + 1, SHADE);
  }
  const random = rng(31);
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(random() * ART_W), y = near(x);
    rect(ctx, x, y - 4, 1, 4, MUTED);
    ellipseBox(ctx, x, y - 5, 2, 2, SHADE, MUTED);
  }
  for (let x = 0; x < ART_W; x++) {
    const a = near(x), b = near(x - 1);
    rect(ctx, x, a, 1, h - a, SHADE);
    rect(ctx, x, Math.min(a, b), 1, Math.abs(a - b) + 1, MUTED);
  }
  return canvas;
}

function paintStars(seed: number, count: number) {
  const { canvas, ctx } = makeCanvas(ART_W, ART_H);
  const random = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(random() * (ART_W - 2)), y = 1 + Math.floor(random() * (ART_H - 2)), kind = random();
    if (kind < 0.1) { rect(ctx, x - 1, y, 3, 1, WHITE); rect(ctx, x, y - 1, 1, 3, WHITE); }
    else rect(ctx, x, y, 1, 1, kind < 0.2 ? GREEN : kind < 0.6 ? WHITE : kind < 0.8 ? GRID : MUTED);
  }
  return canvas;
}

/** A puffy cloud: overlapping discs, flat-ish base, ink outline (far clouds: soft grey, no ink). */
function paintCloud(w: number, h: number, seed: number, far = false) {
  const random = rng(seed * 101 + 7);
  const blobs: [number, number, number][] = [];
  const count = Math.max(3, Math.round(w / 13));
  for (let i = 0; i < count; i++) {
    const r = h * (0.3 + random() * 0.08), k = i / (count - 1);
    blobs.push([r + 1 + k * (w - 2 * r - 2), h - r - 1, r]);
  }
  for (let i = 0; i < count - 1; i++) {
    const k = (i + 0.5) / (count - 1), r = h * (0.34 + random() * 0.14) * (1 - Math.abs(k - 0.5) * 0.7);
    blobs.push([r + 2 + k * (w - 2 * r - 4), h - r * 1.45 - 2 - random() * 2, r]);
  }
  const inside = (x: number, y: number) => y >= 0 && y < h - 1 && x >= 0 && x < w && blobs.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
  const { canvas, ctx } = makeCanvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    const low = h - 1 - y;
    const color = edge ? (far ? SHADE : INK) : far ? (low < 4 && (x + y) % 2 === 0 ? SHADE : GRID)
      : low < 3 ? GRID : low < 6 && (x + y) % 2 === 0 ? GRID : !inside(x - 2, y - 2) && !inside(x, y - 3) ? PAPER : WHITE;
    rect(ctx, x, y, 1, 1, color);
  }
  return canvas;
}

function paintHaystack() {
  const { w, h } = HAY;
  const { canvas, ctx } = makeCanvas(w, h);
  const halfAt = (y: number) => {
    const k = (y + 0.5) / h;
    return k < 0.6 ? (w / 2 - 3) * Math.sqrt(Math.max(0, 1 - ((0.6 - k) / 0.6) ** 2)) : w / 2 - 3 + (k - 0.6) * 6;
  };
  for (let y = 0; y < h; y++) {
    const half = Math.round(halfAt(y)), x0 = w / 2 - half, x1 = w / 2 + half, above = y ? Math.round(halfAt(y - 1)) : -1;
    for (let x = x0; x < x1; x++) {
      const edge = x === x0 || x === x1 - 1 || y === h - 1 || Math.abs(x + 0.5 - w / 2) > above;
      const stroke = (x * 2 + y * 3) % 9 === 0 || (x * 5 - y * 2 + 99) % 14 === 0;
      const shade = (x > x1 - 8 || y > h - 6) && (x + y) % 2 === 0;
      rect(ctx, x, y, 1, 1, edge ? INK : stroke || shade ? STRAW_DARK : STRAW);
    }
  }
  // Loose straws poking out of the dome.
  for (const [x, y, dx, dy] of [[w / 2 - 6, 1, -1, -2], [w / 2 + 4, 1, 1, -2], [w / 2 - 17, 6, -2, -1], [w / 2 + 16, 7, 2, -1], [w / 2 - 25, 17, -2, 0]] as const) {
    rect(ctx, x + dx, y + dy, 1, 1, INK); rect(ctx, x + Math.sign(dx), y + Math.sign(dy), 1, 1, STRAW_DARK);
  }
  return canvas;
}

function paintLand() {
  const { canvas, ctx: g } = makeCanvas(LAND.w, LAND.h);
  const X = (x: number) => Math.round((x - LAND.x0) / A), Y = (y: number) => Math.round((y - LAND.y0) / A);
  const ground = Y(0);
  const random = rng(7);
  // Grass band over paper soil.
  rect(g, 0, ground, LAND.w, 1, INK);
  rect(g, 0, ground + 1, LAND.w, 6, GREEN);
  dither(g, 0, ground + 5, LAND.w, 2, MOSS, 2);
  rect(g, 0, ground + 7, LAND.w, 1, INK);
  rect(g, 0, ground + 8, LAND.w, LAND.h - ground - 8, PAPER);
  dither(g, 0, ground + 14, LAND.w, LAND.h - ground - 14, SHADE, 2);
  for (let i = 0; i < 140; i++) rect(g, Math.floor(random() * LAND.w), ground + 9 + Math.floor(random() * 40), 2, 1, MUTED);
  for (let x = 2; x < LAND.w - 3; x += 3 + Math.floor(random() * 6)) {
    if (random() < 0.8) { rect(g, x, ground - 1, 1, 1, INK); rect(g, x + 1, ground - 2, 1, 1, INK); rect(g, x + 2, ground - 1, 1, 1, INK); rect(g, x + 1, ground - 1, 1, 1, GREEN); }
    else { rect(g, x + 1, ground - 3, 1, 3, MOSS); rect(g, x, ground - 4, 3, 1, WHITE); rect(g, x + 1, ground - 5, 1, 3, WHITE); rect(g, x + 1, ground - 4, 1, 1, GREEN); }
  }
  const sign = (x: number, text: string) => {
    const w = textWidth(text, 1) + 6, left = X(x) - Math.floor(w / 2), top = ground - 17;
    rect(g, X(x) - 1, top + 10, 2, 7, INK);
    box(g, left, top, w, 11, WHITE);
    rect(g, left + 1, top + 9, w - 2, 1, SHADE);
    drawText(g, text, left + 3, top + 2, { scale: 1, color: INK });
  };
  paintHouse(g, X(HOUSE.x), Y(HOUSE.y));
  // A short picket fence between the house and the pond.
  for (let x = X(-24); x < X(6); x += 5) { box(g, x, ground - 10, 3, 11, WHITE); rect(g, x + 1, ground - 11, 1, 1, INK); }
  rect(g, X(-24), ground - 7, X(6) - X(-24), 1, INK);
  rect(g, X(-24), ground - 3, X(6) - X(-24), 1, INK);
  // Pond: a dark basin cut into the ground, reeds on both banks, lily pads.
  const x0 = X(POND.x0), x1 = X(POND.x1), cx = (x0 + x1) / 2, half = (x1 - x0) / 2, surface = Y(POND.surface);
  for (let x = x0; x <= x1; x++) {
    const k = (x + 0.5 - cx) / half;
    if (Math.abs(k) >= 1) continue;
    const depth = Math.max(2, Math.round(POND.depth * Math.sqrt(1 - k * k)));
    g.clearRect(x, ground - 5, 1, surface - ground + 5);
    rect(g, x, surface, 1, depth, WATER);
    rect(g, x, surface, 1, 1, GRID);
    if (x % 2 === 0) rect(g, x, surface + 1, 1, 1, WATER_LIGHT);
    for (let j = 7; j < depth; j++) if ((x + j) % 2 === 0 || j > 14) rect(g, x, surface + j, 1, 1, WATER_DEEP);
    if ((x * 5) % 11 < 2 && depth > 8) rect(g, x, surface + 3 + ((x * 3) % 4), 3, 1, WATER_LIGHT);
    rect(g, x, surface + depth, 1, 2, INK);
  }
  for (const side of [x0, x1]) {
    rect(g, side - 1, ground, 3, surface - ground + 2, INK);
    for (let i = -4; i <= 4; i += 2) {
      const x = side + i + (side === x0 ? 2 : -2), tall = 7 + ((i * 7 + side) % 5 + 5) % 5;
      rect(g, x, ground - tall, 1, tall, (i / 2) % 2 ? MOSS : GREEN);
      rect(g, x - 1, ground - tall, 1, tall, INK);
      if (i % 4 === 0) { rect(g, x - 1, ground - tall - 3, 3, 4, INK); rect(g, x, ground - tall - 2, 1, 2, MUTED); }
    }
  }
  for (const [px, r] of [[X(80), 5], [X(445), 4], [X(470), 3]] as const) {
    ellipseBox(g, Math.round(px), surface, r, 1, GREEN);
    rect(g, Math.round(px) + 1, surface - 1, 1, 2, INK);
  }
  // The pond pays nothing; the hay field (pitchfork) is where parachutes come down.
  sign(545, "×0");
  const fork = X(HAY.cx + HAY.w * A / 2 + 18);
  for (let i = 0; i < 26; i++) rect(g, fork + Math.floor(i / 5), ground - i, 1, 1, INK);
  for (let i = 0; i < 3; i++) rect(g, fork + 4 + i * 2, ground - 32, 1, 6, MUTED);
  rect(g, fork + 4, ground - 27, 5, 1, MUTED);
  // Village.
  for (const house of HOUSES) paintVillageHouse(g, house, X(house.cx), ground);
  for (const [x, r] of [[1290, 5], [1450, 6], [1640, 7], [1760, 5]] as const) {
    ellipseBox(g, X(x), ground - r, r + 1, r, GREEN);
    rect(g, X(x) - 2, ground - r - 2, 2, 1, WHITE);
  }
  return canvas;
}

function paintHouse(g: CanvasRenderingContext2D, ox: number, oy: number) {
  // Walls with siding.
  box(g, ox + 4, oy + 44, 112, 88, PAPER);
  for (let y = oy + 50; y < oy + 131; y += 6) rect(g, ox + 5, y, 110, 1, GRID);
  dither(g, ox + 5, oy + 45, 110, 3, INK, 4);
  // Gable roof with tile rows and a green eave trim.
  for (let r = 0; r <= 42; r++) {
    const y = oy + 4 + r, half = Math.max(1, Math.round((r / 42) * 62));
    rect(g, ox + 60 - half, y, half * 2, 1, INK);
    if (half > 2 && r < 42) rect(g, ox + 62 - half, y, half * 2 - 4, 1, r % 5 === 4 ? INK : ROOF);
    if (r % 5 !== 4 && half > 4) for (let x = ox + 63 - half + ((r / 5) | 0) % 2 * 3; x < ox + 58 + half; x += 6) rect(g, x, y, 1, 1, MUTED);
  }
  rect(g, ox - 2, oy + 45, 124, 2, GREEN);
  rect(g, ox - 2, oy + 47, 124, 1, INK);
  // Round attic window with a heart.
  ellipseBox(g, ox + 60, oy + 30, 7, 7, WHITE);
  for (const [x, y, w] of [[-3, -2, 2], [1, -2, 2], [-3, -1, 6], [-2, 0, 4], [-1, 1, 2]] as const) rect(g, ox + 60 + x, oy + 30 + y, w, 1, GREEN);
  // Door, sign and the flower bed.
  box(g, ox + 16, oy + 100, 24, 32, PAPER);
  box(g, ox + 19, oy + 103, 18, 11, GRID); box(g, ox + 19, oy + 116, 18, 13, GRID);
  rect(g, ox + 35, oy + 115, 2, 2, INK);
  for (const [x, y, w] of [[23, 107, 2], [27, 107, 2], [23, 108, 6], [24, 109, 4], [25, 110, 2]] as const) rect(g, ox + 4 + x, oy + y, w, 1, GREEN);
  box(g, ox + 5, oy + 87, 47, 11, WHITE);
  drawText(g, "NURSERY", ox + 8, oy + 89, { scale: 1, color: INK });
  // The launch window: open onto the dark room (the slingshot and the shutters are drawn live), sill, flower box.
  const { x, y, w, h } = HOUSE.win;
  box(g, ox + x - 2, oy + y - 2, w + 4, h + 4, WHITE);
  rect(g, ox + x, oy + y, w, h, INK);
  for (let j = 4; j < h - 8; j += 7) for (let i = 3 + (j % 2) * 3; i < w - 2; i += 8) rect(g, ox + x + i, oy + y + j, 1, 1, "#2A2A2A");
  rect(g, ox + x, oy + y + h - 8, w, 8, "#1E1E1E");
  rect(g, ox + x, oy + y + h - 8, w, 1, "#2E2E2E");
  box(g, ox + x - 4, oy + y + h + 1, w + 8, 4, WHITE);
  box(g, ox + x, oy + y + h + 5, w, 6, PAPER);
  for (let i = 1; i < w - 1; i += 4) { rect(g, ox + x + i, oy + y + h + 3, 3, 2, i % 8 ? GREEN : MOSS); rect(g, ox + x + i + 1, oy + y + h + 2, 1, 1, WHITE); }
  // Bushes at the foot of the walls.
  for (const [bx, r] of [[8, 6], [52, 5], [66, 7], [110, 6]] as const) {
    ellipseBox(g, ox + bx, oy + 131 - r, r + 2, r, GREEN);
    rect(g, ox + bx - 2, oy + 128 - r, 2, 1, WHITE);
  }
}

function paintVillageHouse(g: CanvasRenderingContext2D, house: typeof HOUSES[number], cx: number, ground: number) {
  const { w, wall, roof, chimney } = house;
  const left = cx - w / 2, top = ground - wall, reach = w / 2 + OVERHANG;
  box(g, left, top, w, wall + 1, PAPER);
  for (let y = top + 5; y < ground; y += 5) rect(g, left + 1, y, w - 2, 1, GRID);
  for (const wx of w > 50 ? [left + 6, cx - 4, left + w - 14] : [left + 6, left + w - 14]) {
    box(g, wx, top + 7, 8, 9, WHITE);
    rect(g, wx + 4, top + 8, 1, 7, INK); rect(g, wx + 1, top + 11, 6, 1, INK);
    rect(g, wx - 1, top + 16, 10, 2, GREEN);
  }
  box(g, cx - 4, ground - 13, 8, 14, GRID);
  rect(g, cx + 1, ground - 7, 1, 1, INK);
  if (chimney) {
    const chx = cx + chimney * Math.round(reach * 0.45) - 3;
    const roofAt = top - roof + Math.round((Math.abs(chx + 3 - cx) / reach) * roof);
    box(g, chx, roofAt - 12, 7, 14, SHADE);
    rect(g, chx - 1, roofAt - 13, 9, 2, INK);
  }
  for (let r = 0; r < roof; r++) {
    const y = top - roof + r, half = Math.max(1, Math.round(((r + 1) / roof) * reach));
    rect(g, cx - half, y, half * 2, 1, INK);
    if (half > 1) {
      rect(g, cx - half + 1, y, half * 2 - 2, 1, r % 4 === 3 ? INK : MUTED);
      if (r % 4 !== 3) for (let x = cx - half + 2 + ((r >> 2) % 2) * 3; x < cx + half - 1; x += 6) rect(g, x, y, 1, 1, "#77726A");
    }
  }
  rect(g, cx - reach, top, reach * 2, 1, INK);
  dither(g, left + 1, top + 1, w - 2, 2, INK, 4);
}

// ---------------------------------------------------------------------------------------------
// The sequence

export function createLaunchSequence(options: LaunchSequenceOptions): LaunchSequence {
  const { canvas, baby, onBeat } = options;
  const reducedMotion = options.reducedMotion;
  let destroyed = false, dirty = true, raf = 0, last = 0;
  /** Scene clock (ms since creation): idle animation, particles and the ending timeline. */
  let clock = 0;
  let phase: "ready" | "flying" | "ending" = "ready";
  let flightMs = 0, ending: FlightEnd | null = null, exit: number | null = null, endAt = 0, endTotal = 0, fallMs = 0, descentMs = 0;
  /** Where the baby, the camera and the portrait slice were when the flight was decided. */
  let from: Point = { x: FLIGHT_X, y: PAD_Y }, fromCam = GROUND_CAM, fromFocus: number = FOCUS.ready;
  let endPromise: Promise<void> | null = null, resolveEnd: (() => void) | null = null;
  const fired = new Set<string>();
  // Portrait boxes (at most PORTRAIT_W / H wide for their height) zoom to a PORTRAIT_W wide slice, as tall as the box.
  const view = createPixelView(canvas, W, H, { onResize: () => { dirty = true; }, overscan: true,
    zoomFor: (width, height, fit) => width * H <= height * PORTRAIT_W ? width / PORTRAIT_W / fit : 1 });
  /** The visible part of the composition this frame (plane px): the whole 960 x 640, or the portrait slice. */
  const region = { x: 0, y: 0, w: W, h: H };
  const ctx = view.ctx;
  const fx = createParticles();
  const art = cachedArt ??= paintArt();
  // Ink extents of the baby, for contact points: feet below the centre, head above it, front edge (facing right).
  const front = inkBox(baby.sheet.idle.down[0]), side = inkBox(baby.sheet.idle.right[0]);
  const feet = (front.maxY + 1 - 8) * S, belly = (side.maxX + 1 - 8) * S, headTop = (8 - front.minY) * S;
  const contact = POND.surface - belly, seat = HAY_TOP - feet + 12;
  if (!canvas.hasAttribute("aria-label")) canvas.setAttribute("aria-label", `${baby.name} strapped to a firework rocket on a raft in the pond.`);

  const beat = (name: LaunchBeat, key: string = name) => {
    if (fired.has(key)) return;
    fired.add(key);
    try { onBeat?.(name); } catch { /* sound errors must not break the show */ }
  };
  const since = () => clock - endAt;
  /** The ending moment to draw: reduced motion shows only the final frame. */
  const shownAt = () => reducedMotion && phase === "ending" ? endTotal : since();

  // ------------------------------------------------------------------------------------------
  // Poses (pure functions of the state and the time)

  /** The camera offset that keeps the climbing baby low in the frame (screen y of its box centre, above the hold button). */
  const climbScreenY = (ms: number) => lerp(PAD_Y - GROUND_CAM, region.y + region.h * (420 / H), smooth(ms / FLIGHT_MS / 0.35));
  /** The plane x the portrait slice centres on while the rocket is on the pad or climbing. */
  const climbFocus = (ms: number) => lerp(FOCUS.ready, FOCUS.climb, smooth((ms - 1300) / 1100));
  /** The plane x the portrait slice centres on at this moment (a pure function of the state, like the poses). */
  function focusX() {
    if (phase === "ready" || (phase === "flying" && reducedMotion)) return FOCUS.ready;
    if (phase === "flying") return climbFocus(flightMs);
    const e = shownAt();
    if (ending === "moon") return e >= END.moon.cut ? FOCUS.moon : fromFocus;
    return lerp(fromFocus, ending === "jump" ? FOCUS.jump : FOCUS.pond, smooth(e / 700));
  }
  /** Sets `region` for this frame: the view's visible size, bottom-aligned (extra sky above), panned to focusX(). */
  function frameRegion() {
    region.w = view.viewWidth; region.h = view.viewHeight;
    region.x = Math.round(clamp(focusX() - region.w / 2, 0, W - region.w));
    region.y = H - region.h;
  }
  const flying = (x: number, y: number, time: number, rot = 0, facing: Facing = "down"): Pose =>
    ({ x, y, rot, clip: "walk", facing, frame: Math.floor(time / 60) % 8, sx: 1, sy: 1 });
  const idle = (x: number, y: number, time: number, facing: Facing = "down"): Pose =>
    ({ x, y, rot: 0, clip: "idle", facing, frame: reducedMotion ? 0 : Math.floor(time / 170) % 8, sx: 1, sy: 1 });

  function readyPose(): Pose {
    if (reducedMotion) return idle(FLIGHT_X, PAD_Y, 0);
    // It lands on the rocket from the slingshot shot, squashes, then waits.
    const drop = clamp(clock / 260), landed = clock - 260;
    const squash = landed > 0 && landed < 150 ? 1 - Math.sin((landed / 150) * Math.PI) * 0.18 : 1;
    return { ...idle(FLIGHT_X, lerp(PAD_Y - 260, PAD_Y, easeInCubic(drop)), clock), sx: 1 / Math.sqrt(squash), sy: squash, ay: PAD_Y + feet };
  }

  /** After the splash: sinks, surfaces to its chin, spits at the duck, then bobs (the old pond landing). */
  function pondPose(after: number, x: number): Pose {
    const P = END.pond;
    if (after < P.surface) {
      const flat = after < 150 ? 1 - Math.sin((after / 150) * Math.PI) * 0.4 : 1;
      const sink = easeInCubic(clamp((after - P.sink) / 240)) * (BOX + 30);
      return { x, y: contact + sink, rot: 1, clip: "idle", facing: "right", frame: 0, sx: 1 / Math.sqrt(flat), sy: flat, ay: POND.surface, cut: POND.surface, under: true };
    }
    const up = after - P.surface, rise = easeOutBack(clamp(up / 280), 2.4);
    const rest = POND.surface - (front.minY + 8) * S + HALF;
    const spitting = after >= P.spit && after < P.spit + 300;
    const bob = up > 280 && !reducedMotion ? Math.round(Math.sin((up - 280) / 240) * 3) : 0;
    return {
      x: x - 16, y: lerp(POND.surface + HALF + 6, rest, rise) + bob, rot: 0, clip: "idle", facing: "down",
      frame: spitting || reducedMotion ? 0 : Math.floor(up / 170) % 8, sx: spitting ? 1.08 : 1, sy: spitting ? 0.94 : 1, ay: POND.surface, cut: POND.surface, under: true,
    };
  }

  /** When the splash happens (ms after end()), or Infinity when this ending stays dry. */
  const splashAt = () => ending === "fizzle" ? END.pad.land : ending === "crash" ? END.air.pop + fallMs : Infinity;
  const touchAt = () => END.jump.hop + descentMs;
  const hayScale = (time: number) => {
    const after = time - touchAt();
    return ending !== "jump" || after < 0 ? 1 : 1 - 0.08 * Math.exp(-after / 200) * Math.cos(after / 55);
  };

  function endPose(e: number): Pose {
    switch (ending) {
      case "fizzle": {
        const P = END.pad;
        if (e < P.topple) return idle(FLIGHT_X + (reducedMotion ? 0 : Math.round(Math.sin(e / 30) * 1) * A), PAD_Y, clock);
        if (e < P.land) {
          const k = (e - P.topple) / (P.land - P.topple);
          return { ...flying(lerp(FLIGHT_X, SPLASH_X, k), lerp(PAD_Y, contact, easeInCubic(k)) - 70 * Math.sin(k * Math.PI), e, Math.floor(k * 5), "right"), clip: "idle", frame: 0 };
        }
        return pondPose(e - P.land, SPLASH_X);
      }
      case "crash": {
        const P = END.air;
        if (e < P.pop) return idle(from.x, from.y + (reducedMotion ? 0 : Math.round(Math.sin(e / 70) * 2) * A), clock);
        if (e < P.pop + fallMs) {
          const k = (e - P.pop) / fallMs;
          return flying(lerp(from.x, SPLASH_X, k), lerp(from.y, contact, easeInCubic(k)), e, Math.floor(k * 9), "right");
        }
        return pondPose(e - P.pop - fallMs, SPLASH_X);
      }
      case "jump": {
        const hop = END.jump.hop;
        if (e < hop) {
          const k = e / hop;
          return flying(from.x + 70 * k, from.y + 10 * k - 44 * Math.sin(k * Math.PI), e, 0, "right");
        }
        const touch = touchAt();
        if (e < touch) {
          const k = (e - hop) / descentMs, sway = Math.sin((e - hop) / 260) * 14 * (1 - k);
          return { ...idle(lerp(from.x + 70, HAY.cx, smooth(k)) + sway, lerp(from.y + 10, seat, smooth(k)), clock), clip: "walk", frame: Math.floor(e / 160) % 8 };
        }
        const after = e - touch, squash = after < 160 ? 1 - Math.sin((after / 160) * Math.PI) * 0.22 : 1;
        const hopUp = !reducedMotion && after > 380 && after < 700 ? Math.sin(((after - 380) / 320) * Math.PI) * 30 : 0;
        return { ...idle(HAY.cx, seat - hopUp, clock), sx: 1 / Math.sqrt(squash), sy: squash, ay: seat + feet };
      }
      default: return idle(from.x, from.y, clock);
    }
  }

  function moonPose(e: number): Pose {
    const M = END.moon, top = MOON_TOP.y - feet;
    if (e < M.land) {
      const k = smooth((e - M.cut) / (M.land - M.cut));
      return { ...flying(lerp(470, MOON_TOP.x, k), lerp(200, top, k), e), clip: k > 0.7 ? "idle" : "walk", facing: k > 0.7 ? "down" : "right", frame: k > 0.7 ? 0 : Math.floor(e / 110) % 8 };
    }
    const after = e - M.land, squash = after < 200 ? 1 - Math.sin((after / 200) * Math.PI) * 0.25 : 1;
    // Low-gravity happy hops after the jackpot.
    const hop = e > M.rays && !reducedMotion ? Math.max(0, Math.sin(((e - M.rays) / 900) * Math.PI * 2)) * 34 : 0;
    return { x: MOON_TOP.x, y: top - hop, rot: 0, clip: hop > 0 ? "walk" : "idle", facing: "down", frame: reducedMotion ? 0 : Math.floor(after / 170) % 8, sx: 1 / Math.sqrt(squash), sy: squash, ay: MOON_TOP.y };
  }

  /** The baby, the rocket (null once it is gone), the parachute and the camera at this moment (world phase). */
  function worldState() {
    const e = shownAt();
    if (phase === "ready" || (phase === "flying" && reducedMotion)) {
      return { pose: readyPose(), rocket: { x: FLIGHT_X, y: PAD_Y, flame: phase === "flying" ? 1 : 0 }, strap: reducedMotion || clock > 300, chute: null as Chute | null, cam: { x: CAM_X, y: GROUND_CAM } };
    }
    if (phase === "flying") {
      const x = FLIGHT_X + Math.round(Math.sin(clock / 45)) * A, y = flightY(flightMs);
      return { pose: flying(x, y, clock), rocket: { x, y, flame: 1 }, strap: true, chute: null as Chute | null, cam: { x: CAM_X, y: Math.min(GROUND_CAM, y - climbScreenY(flightMs)) } };
    }
    const pose = endPose(e);
    const offset = from.y - fromCam;
    const follow = (screenY: number) => Math.min(GROUND_CAM, pose.y - screenY);
    if (ending === "fizzle") {
      const sputtering = e < END.pad.topple;
      return { pose, rocket: { x: FLIGHT_X, y: PAD_Y, flame: sputtering ? 0.5 : 0 }, strap: sputtering, chute: null as Chute | null, cam: { x: CAM_X, y: GROUND_CAM } };
    }
    if (ending === "crash") {
      const hanging = e < END.air.pop;
      return { pose, rocket: hanging ? { x: pose.x, y: pose.y, flame: 0.5 } : null, strap: hanging, chute: null as Chute | null, cam: { x: CAM_X, y: e < splashAt() ? follow(offset) : GROUND_CAM } };
    }
    if (ending === "jump") {
      const hop = END.jump.hop, touch = touchAt(), k = clamp((e - hop) / descentMs);
      // The empty rocket keeps climbing out of sight.
      const ry = from.y - (e * 0.6 + e * e * 0.0015);
      const open = e < hop ? 0 : reducedMotion ? 1 : easeOutBack(clamp((e - hop) / 220), 2);
      const flat = e < touch ? 0 : reducedMotion ? 1 : easeOutCubic((e - touch) / 450);
      // The camera rides down with the parachute, the canopy in view, and ends on the hay field.
      const cam = { x: Math.round(lerp(CAM_X, HAY_CAM_X, smooth(k))), y: Math.round(follow(lerp(offset, 330, smooth(k)))) };
      return { pose, rocket: ry > cam.y - 400 ? { x: from.x, y: ry, flame: 1 } : null, strap: false, chute: e < hop ? null : { open, x: pose.x, y: pose.y, flat }, cam };
    }
    // The Moon, before the cut: the rocket arrives at x10.
    return { pose, rocket: { x: from.x, y: from.y, flame: 1 }, strap: true, chute: null as Chute | null, cam: { x: CAM_X, y: fromCam } };
  }

  // ------------------------------------------------------------------------------------------
  // Drawing

  function drawBaby(p: Pose, time: number) {
    const ax = p.ax ?? p.x, ay = p.ay ?? p.y;
    const cx = ax + (p.x - ax) * p.sx, cy = ay + (p.y - ay) * p.sy;
    const q = ((p.rot % 4) + 4) % 4, [c, s] = TURN[q];
    const lx = q % 2 ? p.sy : p.sx, ly = q % 2 ? p.sx : p.sy;
    const paint = (top: number, bottom: number, ink?: string) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(Math.round(cx) - 200, top, 400, bottom - top); ctx.clip();
      ctx.transform(c, s, -s, c, Math.round(cx), Math.round(cy));
      paintCreature(ctx, baby, ink ? { clip: p.clip, facing: p.facing, frame: p.frame, x: 0, y: Math.round(HALF * ly), scale: S, sx: lx, sy: ly, ink, halo: null, pattern: false, accessory: null }
        : { clip: p.clip, facing: p.facing, frame: p.frame, x: 0, y: Math.round(HALF * ly), scale: S, sx: lx, sy: ly, time });
      ctx.restore();
    };
    const top = Math.round(cy) - 300, cut = p.cut === undefined ? Math.round(cy) + 300 : Math.round(p.cut);
    if (p.under && p.cut !== undefined) paint(cut, POND.surface + POND.depth * A - A, WATER_DEEP);
    paint(top, cut);
  }

  /** The firework rocket behind the baby (box centre x, y): green nose cone, paper tube with a green spiral, wooden stick, flame 0-1. */
  function drawRocket(x: number, y: number, flame: number, time: number) {
    const X = Math.round(x / A), Y = Math.round(y / A), half = ROCKET.tube / A / 2;
    const top = Y + ROCKET.top / A, bottom = Y + ROCKET.bottom / A, nose = ROCKET.nose / A;
    ctx.save(); ctx.scale(A, A);
    box(ctx, X + 3, bottom - 10, 3, Y + ROCKET.stick / A - bottom + 10, STRAW);
    if (flame > 0) {
      // Flickering flame; half power sputters on and off.
      const tick = reducedMotion ? 0 : Math.floor(time / 45);
      const on = flame >= 1 || tick % 3 !== 0;
      const length = on ? Math.round((flame >= 1 ? 9 : 4) + (tick * 7 % 5)) : 0;
      for (let r = 0; r < length; r++) {
        const w = Math.max(1, Math.round(4 * (1 - r / length)) + (r < 2 ? 1 : 0));
        rect(ctx, X - w - 1, bottom + 2 + r, w * 2 + 2, 1, INK);
        rect(ctx, X - w, bottom + 2 + r, w * 2, 1, r < 2 ? WHITE : r < length * 0.45 ? GOLD : ORANGE);
      }
    }
    rect(ctx, X - 4, bottom, 8, 2, INK);
    box(ctx, X - half, top, half * 2, bottom - top, WHITE);
    for (let j = top + 1; j < bottom - 1; j++) for (let i = 1; i < half * 2 - 1; i++) if ((i + j) % 9 < 3) rect(ctx, X - half + i, j, 1, 1, GREEN);
    rect(ctx, X - half, top + 3, half * 2, 1, INK);
    rect(ctx, X - half, bottom - 4, half * 2, 1, INK);
    for (let r = 0; r < nose; r++) {
      const w = Math.max(1, Math.round(((r + 1) / nose) * (half + 1)));
      rect(ctx, X - w, top - nose + r, w * 2, 1, INK);
      if (w > 1 && r > 1) { rect(ctx, X - w + 1, top - nose + r, w * 2 - 2, 1, GREEN); rect(ctx, X - w + 2, top - nose + r, 1, 1, WHITE); }
    }
    ctx.restore();
  }

  /** The seat strap across the baby's tummy, with a buckle. */
  function drawStrap(p: Pose) {
    const X = Math.round(p.x / A), Y = Math.round((p.y + 24) / A);
    ctx.save(); ctx.scale(A, A);
    rect(ctx, X - 15, Y, 30, 3, INK);
    rect(ctx, X - 14, Y + 1, 28, 1, GREEN);
    box(ctx, X - 2, Y - 1, 5, 5, WHITE);
    ctx.restore();
  }

  /** Parachute: a striped canopy above the baby on four lines; `flat` lays it down over the hay after touchdown. */
  function drawChute(c: Chute) {
    const X = Math.round((c.x + 90 * c.flat) / A), base = Math.round((lerp(c.y - HALF - 108, seat + feet - 18, c.flat)) / A);
    const rx = Math.round(lerp(32, 38, c.flat) * c.open), ry = Math.max(1, Math.round(lerp(18, 4, c.flat) * c.open));
    if (rx < 2) return;
    ctx.save(); ctx.scale(A, A);
    if (c.flat < 0.6) {
      const shoulders = Math.round((c.y - 18) / A), bx = Math.round(c.x / A);
      for (const [from, to] of [[-rx, -5], [-Math.round(rx / 3), -2], [Math.round(rx / 3), 2], [rx, 5]] as const) {
        const steps = Math.max(1, shoulders - base);
        for (let i = 0; i <= steps; i += 2) rect(ctx, Math.round(lerp(X + from, bx + to, i / steps)), base + i, 1, 1, INK);
      }
    }
    const rows = Array.from({ length: ry + 1 }, (_, dy) => [base - ry + dy, Math.round(rx * Math.sqrt(Math.max(0, 1 - ((ry - dy) / ry) ** 2)))] as const);
    // Ink outline first, then the green and white panels inside it.
    for (const [y, half] of rows) rect(ctx, X - half - 1, y - 1, half * 2 + 2, 2, INK);
    for (const [y, half] of rows) for (let i = -half; i < half; i++) rect(ctx, X + i, y, 1, 1, Math.floor((i + rx) / Math.max(1, rx / 3)) % 2 ? GREEN : WHITE);
    rect(ctx, X - rx - 1, base + 1, rx * 2 + 2, 1, INK);
    ctx.restore();
  }

  /** Speed lines beside the baby: `speed` px per ms, positive when it climbs (lines trail below), negative when it falls. */
  function drawSpeedLines(x: number, y: number, speed: number, color: string) {
    const length = Math.min(130, Math.abs(speed) * 300);
    if (length < 20) return;
    const dir = Math.sign(speed), shift = Math.floor(clock / 40) % 3 * 6;
    ctx.fillStyle = color;
    for (const off of [-HALF - 24, -HALF - 50, HALF + 24, HALF + 50]) {
      const start = y + dir * (Math.abs(off) > HALF + 30 ? 10 : 40) + dir * shift;
      for (let d = 0; d < length * (Math.abs(off) > HALF + 30 ? 0.6 : 1); d += 6) ctx.fillRect(Math.round((x + off) / A) * A, Math.round((start + dir * d) / A) * A, A, A);
    }
  }

  function drawSky(camY: number) {
    const rows = art.sky.height, span = Math.ceil(region.h / A) + 1;
    const row = clamp(Math.floor((camY + region.y - SKY.y0) / A), 0, rows - span);
    ctx.drawImage(art.sky, 0, row, ART_W, span, 0, SKY.y0 + row * A - camY, W, span * A);
  }

  function drawStars(shift: number, alpha: number) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    const span = ART_H * A;
    art.stars.forEach((layer, i) => {
      const y = ((Math.round(shift * (1 + i * 1.4) / A) * A) % span + span) % span;
      // Tiles from the first one reaching the region's top (y - span on the plain 640 px band) down past its bottom.
      for (let top = y - span * Math.ceil((y - region.y) / span); top < region.y + region.h; top += span) ctx.drawImage(layer, 0, top, W, span);
    });
    ctx.globalAlpha = 1;
  }

  // Discs are drawn in art units (ctx scaled by A) so every curve stays on the 3 px grid, on the visible rows only.
  const rowsTop = () => Math.floor(region.y / A), rowsBottom = () => Math.ceil((region.y + region.h) / A);
  function drawMoonDisc(cx: number, cy: number, r: number, day: boolean) {
    const fill = day ? GRID : SHADE, lit = day ? WHITE : GRID, pit = day ? SHADE : MUTED;
    const top = rowsTop(), bottom = rowsBottom();
    discRows(cx, cy, r + 1, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, day ? SHADE : INK), top, bottom);
    discRows(cx, cy, r, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, fill), top, bottom);
    discRows(cx - r * 0.16, cy - r * 0.18, r * 0.84, (y, x0, x1) => {
      const span = discSpan(cx, cy, r - 1, y);
      if (span) rect(ctx, Math.max(x0, span[0]), y, Math.min(x1, span[1]) - Math.max(x0, span[0]), 1, lit);
    }, top, bottom);
    for (const [u, v, ru, rv] of MARIA) {
      const ex = cx + u * r, ey = cy + v * r, rx = ru * r, ry = rv * r;
      discRows(ex, ey, rx, (y, x0, x1) => {
        if (Math.abs(y + 0.5 - ey) > ry) return;
        const body = discSpan(cx, cy, r - 1, y);
        if (body && Math.min(x1, body[1]) > Math.max(x0, body[0])) rect(ctx, Math.max(x0, body[0]), y, Math.min(x1, body[1]) - Math.max(x0, body[0]), 1, day ? SHADE : "#CFC8BA");
      }, top, bottom);
    }
    if (r > 40) for (const [u, v] of SPECKS) {
      const x = Math.round(cx + u * r), y = Math.round(cy + v * r), body = discSpan(cx, cy, r - 2, y);
      if (body && x > body[0] && x < body[1] - 1) { rect(ctx, x, y, 2, 1, pit); rect(ctx, x, y + 1, 2, 1, lit); }
    }
    for (const [u, v, ru, rv] of CRATERS) {
      const ex = cx + u * r, ey = cy + v * r, rx = ru * r, ry = Math.max(0.6, rv * r);
      if (rx < 2.5 || ey + ry < top || ey - ry > bottom || ex + rx < 0 || ex - rx > ART_W) continue;
      for (let y = Math.max(top, Math.floor(ey - ry)); y <= Math.min(bottom - 1, Math.ceil(ey + ry)); y++) {
        const dy = (y + 0.5 - ey) * (rx / ry), h2 = rx * rx - dy * dy, body = discSpan(cx, cy, r, y);
        if (h2 <= 0 || !body) continue;
        const half = Math.sqrt(h2), a = Math.max(Math.round(ex - half), body[0]), b = Math.min(Math.round(ex + half), body[1]);
        // Shadowed upper lip, lit lower lip.
        if (b > a) rect(ctx, a, y, b - a, 1, y < ey - ry + 1 ? (day ? SHADE : INK) : y + 1 > ey + ry - 1 ? lit : pit);
      }
    }
  }

  function drawEarth(cx: number, cy: number, r: number, time: number) {
    const top = rowsTop(), bottom = rowsBottom();
    // Atmosphere: a dotted green ring, then ink outline, paper oceans, green land, white clouds, night side.
    discRows(cx, cy, r + 3, (y, x0, x1) => {
      const inner = discSpan(cx, cy, r + 1, y);
      const paint = (a: number, b: number) => { for (let x = Math.max(a, -1); x < Math.min(b, ART_W + 1); x++) if ((x + y) % 2 === 0) rect(ctx, x, y, 1, 1, (x + y) % 4 === 0 ? GREEN : MOSS); };
      if (!inner) paint(x0, x1); else { paint(x0, inner[0]); paint(inner[1], x1); }
    }, top, bottom);
    discRows(cx, cy, r + 1, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, INK), top, bottom);
    discRows(cx, cy, r, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, PAPER), top, bottom);
    const spin = time / 9000;
    const blob = (u: number, v: number, ru: number, rv: number, color: string) => {
      const ex = cx + u * r, ey = cy + v * r, rx = ru * r, ry = Math.max(0.6, rv * r);
      if (ex + rx < -2 || ex - rx > ART_W + 2 || ey + ry < top || ey - ry > bottom) return;
      for (let y = Math.max(top, Math.floor(ey - ry)); y <= Math.min(bottom - 1, Math.ceil(ey + ry)); y++) {
        const dy = (y + 0.5 - ey) * (rx / ry), h2 = rx * rx - dy * dy, body = discSpan(cx, cy, r, y);
        if (h2 <= 0 || !body) continue;
        const half = Math.sqrt(h2), a = Math.max(Math.round(ex - half), body[0]), b = Math.min(Math.round(ex + half), body[1]);
        if (b > a) rect(ctx, a, y, b - a, 1, color);
      }
    };
    // Coast first (moss, one art pixel wider), then land, so overlapping blobs read as one continent.
    const wrap = (u: number) => ((u + spin + 1.7) % 3.4 + 3.4) % 3.4 - 1.7;
    for (const [u, v, ru, rv] of CONTINENTS) blob(wrap(u), v, ru + 1 / r, rv + 1 / r, MOSS);
    for (const [u, v, ru, rv] of CONTINENTS) blob(wrap(u), v, ru, rv, GREEN);
    // Night side (the sun is up and to the left).
    ctx.globalAlpha = 0.42;
    discRows(cx, cy, r, (y, x0, x1) => {
      const lit = discSpan(cx - r * 0.42, cy - r * 0.2, r * 1.08, y);
      const from = lit ? Math.max(x0, lit[1]) : x0;
      if (x1 > from) rect(ctx, from, y, x1 - from, 1, INK);
    }, top, bottom);
    ctx.globalAlpha = 1;
  }

  /** The orbit at x4: a dotted green arc across the sky with its tag (world px). */
  function drawOrbit(cam: Point) {
    if (Math.abs(ORBIT_Y - cam.y - region.y - region.h / 2) > region.h / 2 + 200) return;
    const cx = FLIGHT_X + 60, rx = 1000, ry = 300, cy = ORBIT_Y + ry, march = reducedMotion ? 0 : (clock / 900) % 1;
    for (let i = 0; i < 80; i++) {
      const theta = Math.PI + ((i + march) / 80) * Math.PI, x = cx + rx * Math.cos(theta), y = cy + ry * Math.sin(theta);
      if (x < cam.x - 20 || x > cam.x + W + 20 || i % 2) continue;
      rect(ctx, Math.round(x / A) * A - 6, Math.round(y / A) * A - 6, 12, 12, INK);
      rect(ctx, Math.round(x / A) * A - 3, Math.round(y / A) * A - 3, 6, 6, GREEN);
    }
    const tx = FLIGHT_X + 150, ty = cy - ry * Math.sqrt(1 - ((tx - cx) / rx) ** 2) - 42;
    drawText(ctx, `${multiplierText(400)} ORBIT`, tx, ty, { scale: 3, color: GREEN, outline: INK });
  }

  function drawCloud(sprite: HTMLCanvasElement, cx: number, cy: number, sx = 1, sy = 1) {
    const w = Math.round(sprite.width * A * sx), h = Math.round(sprite.height * A * sy);
    ctx.drawImage(sprite, Math.round(cx - w / 2), Math.round(cy + (sprite.height * A) / 2 - h), w, h);
  }

  function drawStamp(text: string, x: number, y: number, age: number, scale: number, color = WHITE) {
    if (reducedMotion || age < 0 || age > 650) return;
    const pop = age < 70 ? scale - 2 : age < 140 ? scale + 1 : scale;
    ctx.globalAlpha = age > 480 ? 1 - (age - 480) / 170 : 1;
    const rise = Math.round(Math.min(age, 480) / 40);
    const width = textWidth(text, pop);
    const left = clamp(x - width / 2, region.x + 24, region.x + region.w - 24 - width);
    drawText(ctx, text, left, clamp(y - rise, 160, 470), { scale: pop, color, outline: INK });
    ctx.globalAlpha = 1;
  }

  /** A multiplier tag on strings (cloud nine's x2) or on a pole (the roof's x1.5), swaying in the wind. */
  function drawTag(text: string, x: number, y: number, pole: boolean) {
    const sway = reducedMotion ? 0 : Math.round(Math.sin(clock / 400) * 2) * A;
    const w = textWidth(text, 3) + 18;
    if (pole) rect(ctx, x - A, y, A * 2, 78, INK);
    else { rect(ctx, x, y, A, 36, INK); rect(ctx, x + w - A, y, A, 36, INK); }
    const left = pole ? x + A : x - A + sway, top = pole ? y + 3 : y + 36;
    box(ctx, left, top, w + 6, 36, WHITE);
    rect(ctx, left, top, w + 6, A, INK); rect(ctx, left, top + 33, w + 6, A, INK);
    rect(ctx, left, top, A, 36, INK); rect(ctx, left + w + 3, top, A, 36, INK);
    drawText(ctx, text, left + 12, top + 8, { scale: 3, color: INK });
  }

  function shakeAt(e: number) {
    if (reducedMotion || phase !== "ending") return 0;
    const hits: [number, number][] = ending === "jump" ? [[touchAt(), 4]] : ending === "moon" ? [[END.moon.land, 6], [END.moon.rays, 8]] : [[splashAt(), 7]];
    let offset = 0;
    for (const [at, amp] of hits) { const age = e - at; if (age >= 0 && age < 420) offset += amp * Math.exp(-age / 110) * Math.sin(age / 17); }
    return Math.round(offset);
  }

  // ------------------------------------------------------------------------------------------
  // World phase

  function renderWorld() {
    const e = shownAt(), state = worldState(), { pose, cam } = state;
    cam.x = Math.round(cam.x); cam.y = Math.round(cam.y);
    const dark = darkness(cam.y + H / 2);
    drawSky(cam.y);
    drawStars(-cam.y * 0.08, clamp((-cam.y - 1100) / 500));
    // The Moon: a day moon at first, growing overhead as the rocket nears x10 (from the slice's right edge; a portrait
    // slice keeps it half its extra sky higher).
    const near = smooth((GROUND_CAM - cam.y - 1100) / 1500);
    const moon = { x: lerp(DAY_MOON.x, 650, near) + (region.x + region.w - W), y: lerp(DAY_MOON.y, 150, near) + region.y / 2,
      r: Math.exp(lerp(Math.log(DAY_MOON.r), Math.log(170), near)) };
    ctx.save(); ctx.scale(A, A);
    drawMoonDisc(moon.x / A, moon.y / A, moon.r / A, darkness(cam.y) < 0.45);
    ctx.restore();
    if (near > 0.25) {
      // Beside the disc, or across it when the slice has no room on its left.
      const label = `${multiplierText(1000)} MOON`, right = moon.x - moon.r - 24;
      if (right - textWidth(label, 3) >= region.x + 12) drawText(ctx, label, right, moon.y - 10, { scale: 3, color: GREEN, outline: INK, align: "right" });
      else drawText(ctx, label, moon.x, moon.y - 10, { scale: 3, color: GREEN, outline: INK, align: "center" });
    }
    // Far hills and clouds (parallax).
    const hillsTop = 480 - 60 * A + 30 - (cam.y - GROUND_CAM) * 0.3;
    if (hillsTop < H) {
      const ox = -((((cam.x - CAM_X) * 0.3) % W) + W) % W;
      for (const x of [ox, ox + W]) ctx.drawImage(art.hills, Math.round(x), Math.round(hillsTop), W, 60 * A);
      rect(ctx, 0, Math.round(hillsTop + 60 * A), W, H, SHADE);
    }
    art.far.forEach((sprite, i) => {
      const x = ((([150, 520, 830][i] - (cam.x - CAM_X) * 0.5 + clock * 0.012 * (i + 1)) % 1500) + 1500) % 1500 - 250;
      const y = [120, 200, 70][i] - (cam.y - GROUND_CAM) * 0.5;
      if (y > region.y - 80 && y < H + 40) ctx.drawImage(sprite, Math.round(x), Math.round(y), sprite.width * A, sprite.height * A);
    });
    ctx.save();
    ctx.translate(-cam.x, -cam.y + shakeAt(e));
    CLOUDS.forEach(([x, y], i) => {
      if (Math.abs(x - cam.x - W / 2) < 800 && y - cam.y > region.y - 120 && y - cam.y < H + 120) drawCloud(art.clouds[i], x, y);
    });
    ctx.drawImage(art.land, LAND.x0, LAND.y0, LAND.w * A, LAND.h * A);
    drawWindow();
    drawTag(multiplierText(150), ROOF_PEAK.x, ROOF_FLAG_Y - 6, true);
    // Cloud nine with its x2 pennant, and the orbit at x4.
    drawTag(multiplierText(200), CLOUD9.cx - 30, CLOUD9.cy + CLOUD9.h * A / 2 - 6, false);
    drawCloud(art.cloud9, CLOUD9.cx, CLOUD9.cy);
    drawOrbit(cam);
    const hs = hayScale(e), hw = HAY.w * A * (1 + (1 - hs) * 0.6), hh = HAY.h * A * hs;
    ctx.drawImage(art.hay, Math.round(HAY.cx - hw / 2), Math.round(-hh), Math.round(hw), Math.round(hh));
    const splash = splashAt();
    drawPond(e - splash, pose);
    drawDuck(e - splash);
    drawRaft();
    if (!reducedMotion && phase === "flying") drawSpeedLines(pose.x, pose.y, (altitude(flightMs) - altitude(flightMs - 40)) / 40, dark > 0.5 ? GRID : MUTED);
    if (!reducedMotion && ending === "crash" && e > END.air.pop && e < splash) drawSpeedLines(pose.x, pose.y, -(1 + (e - END.air.pop) / fallMs) * 1.2, dark > 0.5 ? GRID : MUTED);
    if (state.chute) drawChute(state.chute);
    if (state.rocket) drawRocket(state.rocket.x, state.rocket.y, state.rocket.flame, clock);
    drawBaby(pose, clock);
    if (state.strap && state.rocket) drawStrap(pose);
    drawGags(e, pose);
    fx.draw(ctx, "floor");
    fx.draw(ctx, "top");
    ctx.restore();
    drawWorldStamps(e, cam);
  }

  /** The raft the rocket stands on, bobbing on the water. */
  function drawRaft() {
    const bob = reducedMotion ? 0 : Math.round(Math.sin(clock / 500)) * A;
    const X = Math.round((FLIGHT_X - RAFT.w / 2) / A), Y = Math.round((RAFT.top + bob) / A), w = RAFT.w / A;
    ctx.save(); ctx.scale(A, A);
    box(ctx, X, Y, w, 4, STRAW);
    for (let i = 4; i < w - 1; i += 5) rect(ctx, X + i, Y + 1, 1, 2, STRAW_DARK);
    rect(ctx, X + 2, Y + 4, w - 4, 1, WATER_DEEP);
    ctx.restore();
  }

  /** The slingshot in the dark window, its band still twanging from the shot, and the shutters it flung open. */
  function drawWindow() {
    const wx = HOUSE.x + HOUSE.win.x * A, wy = HOUSE.y + HOUSE.win.y * A, ww = HOUSE.win.w * A, wh = HOUSE.win.h * A;
    const settle = reducedMotion ? 0 : Math.exp(-clock / 420);
    const cx = wx + ww / 2, base = wy + wh, fork = wy + 45;
    rect(ctx, cx - 6, fork + 12, 12, base - fork - 12, MUTED);
    for (let i = 0; i < 6; i++) { rect(ctx, cx - 6 - i * 6, fork + 12 - i * 6, 9, 9, MUTED); rect(ctx, cx - 3 + i * 6, fork + 12 - i * 6, 9, 9, MUTED); }
    const sag = Math.round(Math.sin(clock / 28) * 24 * settle / A) * A;
    for (let i = 0; i <= 10; i++) {
      const k = i / 10, bend = Math.sin(k * Math.PI) * sag;
      rect(ctx, Math.round((cx - 36 + 72 * k) / A) * A, Math.round((fork - 24 + bend) / A) * A, A, A, GREEN);
    }
    for (const side of [-1, 1]) {
      const swing = Math.abs(Math.cos(Math.sin(clock / 85 + (side > 0 ? 0.7 : 0)) * 1.3 * settle));
      const width = Math.max(A, Math.round(9 * swing) * A), hinge = side < 0 ? wx - 2 * A : wx + ww + 2 * A;
      const left = side < 0 ? hinge - width : hinge;
      rect(ctx, left, wy - 2 * A, width, wh + 4 * A, INK);
      if (width > 2 * A) {
        rect(ctx, left + A, wy - A, width - 2 * A, wh + 2 * A, GREEN);
        for (let j = wy + A; j < wy + wh; j += 3 * A) rect(ctx, left + A, j, width - 2 * A, A, MOSS);
      }
    }
  }

  /** Glints on the water, and after a splash (`after` ms ago): ripples, the splash sheet, droplets, bubbles, the spit. */
  function drawPond(after: number, pose: Pose) {
    const y = POND.surface, drift = reducedMotion ? 0 : Math.floor(clock / 180);
    for (let i = 0; i < 16; i++) if ((i + drift) % 3) rect(ctx, Math.round((POND.x0 + 24 + i * 27) / A) * A, y + 3, 9, A, (i + drift) % 3 === 1 ? WHITE : GRID);
    if (!(after >= 0)) return;
    const x0 = SPLASH_X, P = END.pond;
    for (let k = 0; k < 3; k++) {
      const age = (reducedMotion ? 900 : after) - k * 220;
      if (age < 0 || age > 1500) continue;
      const r = 24 + age * 0.13, ry = Math.max(3, r * 0.14), steps = Math.round(r / 5);
      ctx.fillStyle = WHITE;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2, px = x0 + Math.cos(a) * r;
        if (px < POND.x0 + 12 || px > POND.x1 - 12 || i % 2) continue;
        ctx.fillRect(Math.round(px / A) * A, Math.round((y + 3 + Math.sin(a) * ry) / A) * A, A * 2, A);
      }
    }
    if (reducedMotion) return;
    // Splash: a ragged white sheet shoots up and collapses, with a crown of droplets.
    if (after < 340) {
      const k = after / 340, tall = Math.sin(k * Math.PI) * 160 * (1 - k * 0.3), wide = 84 + k * 70;
      for (let j = 0; j < tall; j += A) {
        const v = j / tall, rag = Math.round(Math.sin(j * 0.21 + after / 30) * 2) * A;
        const width = Math.round((wide * (1 - v * 0.55) + rag) / A) * A, left = Math.round((x0 - width / 2 + rag / 2) / A) * A;
        rect(ctx, left - A, y - j - A, width + 2 * A, A * 2, INK);
        rect(ctx, left, y - j, width, A, v > 0.2 && v < 0.8 && (j / A) % 7 === 3 ? GRID : WHITE);
      }
      for (let i = -2; i <= 2; i++) {
        const bx = Math.round((x0 + i * wide * 0.14) / A) * A, by = Math.round((y - tall - 6 + Math.abs(i) * 4 + (i % 2) * 6) / A) * A;
        if (tall > 20) { rect(ctx, bx - A, by - A, 12, 12, INK); rect(ctx, bx, by, 6, 6, WHITE); }
      }
    }
    if (after < 900) for (let i = 0; i < 18; i++) {
      const spread = (i - 8.5) / 8.5, vx = spread * 0.42, vy = -(0.6 + 0.35 * (1 - Math.abs(spread))) * (i % 3 ? 1 : 0.75);
      for (let tail = 0; tail < 3; tail++) {
        const age = after - tail * 24;
        if (age < 0) continue;
        const dx = vx * age, dy = vy * age + 0.0012 * age * age;
        if (dy > 0) continue;
        const size = tail ? A : A * 2;
        rect(ctx, Math.round((x0 + dx) / A) * A - A, Math.round((y + dy) / A) * A - A, size + A * 2, size + A * 2, INK);
        rect(ctx, Math.round((x0 + dx) / A) * A, Math.round((y + dy) / A) * A, size, size, tail ? GRID : WHITE);
      }
    }
    // Bubbles while it is under.
    if (after > P.sink + 200 && after < P.surface + 100) for (let i = 0; i < 3; i++) {
      const age = (after - P.sink - 200 - i * 90) % 360;
      if (age < 0) continue;
      const bx = x0 - 14 + i * 14 + Math.sin(age / 50 + i) * 4, by = y + 30 - age * 0.12;
      if (by > y) { rect(ctx, Math.round(bx / A) * A - A, Math.round(by / A) * A - A, 9, 9, WHITE); rect(ctx, Math.round(bx / A) * A, Math.round(by / A) * A, A, A, WATER); }
    }
    // The spit: an arc of water from its mouth, straight onto the duck's head.
    if (after >= P.spit) for (let i = 0; i < 12; i++) {
      const age = after - P.spit - i * 24;
      if (age < 0) continue;
      const mx = pose.x + 12, my = y - 14, px = mx + 0.45 * age, py = my - 0.5 * age + 0.0016 * age * age;
      if (py > y || (px > DUCK_X - 20 && py > POND.surface - 52)) continue;
      rect(ctx, Math.round(px / A) * A - A, Math.round(py / A) * A - A, 12, 12, INK);
      rect(ctx, Math.round(px / A) * A, Math.round(py / A) * A, 6, 6, i % 3 ? WHITE : GRID);
    }
  }

  /** The pond's duck pops up to see who dropped in, and gets spat at. */
  const duckHit = END.pond.spit + 260;
  function drawDuck(after: number) {
    const P = END.pond;
    if (!(after >= P.duck)) return;
    const age = after - P.duck, rise = easeOutBack(clamp(age / 260), 2.6);
    const hit = after - duckHit, jolt = hit > 0 && hit < 300 && !reducedMotion ? Math.round(Math.sin(hit / 25) * 5 * (1 - hit / 300)) : 0;
    const bob = age > 260 && !reducedMotion ? Math.round(Math.sin(age / 260 + 1) * 3) : 0;
    const px = 6, w = DUCK.width * px, h = DUCK.height * px;
    const top = POND.surface + 6 - Math.round(lerp(-6, h - 12, rise)) + bob - (hit > 0 && hit < 200 ? 12 : 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(DUCK_X - 60, top - 40, 120, POND.surface + 3 - top + 40); ctx.clip();
    ctx.translate(DUCK_X + jolt + w / 2, top);
    ctx.scale(-1, 1);
    ctx.drawImage(DUCK, 0, 0, w, h);
    ctx.restore();
  }

  /** The "uh oh" beat over the baby, and the duck's lines. */
  function drawGags(e: number, pose: Pose) {
    if (phase !== "ending") return;
    const look = ending === "fizzle" ? [END.pad.look, END.pad.topple] : ending === "crash" ? [END.air.look, END.air.pop] : null;
    if (look && e >= look[0] && e < look[1]) {
      const pop = e - look[0] < 60 ? 5 : 7;
      drawText(ctx, "!", pose.x + 10, pose.y - headTop - 30 - pop * 7, { scale: pop, color: INK, outline: WHITE });
      ctx.drawImage(DROP, Math.round((pose.x - 58) / A) * A, Math.round((pose.y - 40 + ((e - look[0]) / 25)) / A) * A, 18, 24);
    }
    const after = e - splashAt(), P = END.pond;
    if (after >= P.duck + 80 && after < duckHit - 120) drawText(ctx, "QUACK?", DUCK_X - 40, POND.surface - 118, { scale: 3, color: INK, outline: WHITE });
    const hit = after - duckHit;
    if (hit > 0) drawText(ctx, "QUACK!", DUCK_X - 30, POND.surface - 124 - Math.round(Math.min(hit, 600) / 60), { scale: 4, color: INK, outline: WHITE });
  }

  /** Onomatopoeia (world anchors, drawn in screen space so they stay inside the safe band). */
  function drawWorldStamps(e: number, cam: Point) {
    if (phase !== "ending") return;
    const at = (x: number, y: number) => [x - cam.x, y - cam.y] as const;
    if (ending === "fizzle") drawStamp("PFFF...", ...at(FLIGHT_X + 230, PAD_Y - 120), e - 60, 5, WHITE);
    if (ending === "crash") drawStamp("POP!", ...at(from.x + 120, from.y - 150), e - END.air.pop, 6, GOLD);
    if (ending === "fizzle" || ending === "crash") drawStamp("SPLASH!", ...at(SPLASH_X + 8, -230), e - splashAt(), 6);
    if (ending === "jump") {
      drawStamp(exit === null ? "POOF!" : `${multiplierText(exit)}!`, ...at(HAY.cx, HAY_TOP - 200), e - touchAt(), 6, GREEN);
    }
  }

  // ------------------------------------------------------------------------------------------
  // The Moon (screen space, after a white flash)

  function renderMoon(e: number) {
    const M = END.moon;
    rect(ctx, region.x, region.y, region.w, region.h, INK);
    drawStars(reducedMotion ? 0 : (e - M.cut) * 0.02, 1);
    ctx.save();
    ctx.translate(0, shakeAt(e));
    ctx.save(); ctx.scale(A, A);
    // A portrait slice lifts the Earth into its extra sky, so it hangs over the horizon instead of sitting on it.
    drawEarth((region.x + EARTH_FAR.x * region.w / W) / A, (EARTH_FAR.y + region.y * 1.2) / A, EARTH_FAR.r / A, clock);
    drawMoonDisc(MOON_TOP.x / A, (MOON_TOP.y + MOON_R) / A, MOON_R / A, false);
    ctx.restore();
    // The empty rocket zooms off; the baby floats down onto the Moon.
    const away = clamp((e - M.cut) / 800);
    if (away < 1 && !reducedMotion) drawRocket(lerp(470, 330, away), lerp(200, -320, easeInCubic(away)), 1, clock);
    const pose = moonPose(e);
    if (e >= M.rays) drawRays(e, pose);
    drawBaby(pose, clock);
    if (e >= M.flag) drawFlag(e);
    fx.draw(ctx, "floor");
    fx.draw(ctx, "top");
    drawStamp("TOUCHDOWN!", MOON_TOP.x, 250, e - M.land, 4, WHITE);
    ctx.restore();
  }

  /** Jackpot rays: dotted beams turning behind the baby. */
  function drawRays(e: number, pose: Pose) {
    const grow = reducedMotion ? 1 : easeOutCubic(clamp((e - END.moon.rays) / 500));
    const cx = pose.x, cy = MOON_TOP.y - feet;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (reducedMotion ? 0 : clock / 2400);
      for (let d = 70; d < 70 + 190 * grow; d += 15) {
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (y > MOON_TOP.y - 4) continue;
        rect(ctx, Math.round(x / A) * A, Math.round(y / A) * A, 6, 6, i % 2 ? GOLD : GREEN);
      }
    }
  }

  function drawFlag(e: number) {
    // The flag stabs into the ground next to the baby, then its cloth waves.
    const age = e - END.moon.flag, drop = reducedMotion ? 1 : easeInCubic(clamp(age / 140));
    const px = Math.round((MOON_TOP.x + 84) / A) * A, ground = MOON_TOP.y + 3;
    const top = Math.round(lerp(ground - 420, ground - 120, drop) / A) * A, foot = Math.min(ground, top + 120);
    rect(ctx, px - 3, top - 3, 9, foot - top + 3, INK);
    rect(ctx, px, top, 3, foot - top, WHITE);
    const unfurl = reducedMotion ? 1 : easeOutBack(clamp((age - 120) / 260), 1.6);
    const cols = Math.round(20 * unfurl);
    for (let i = 0; i < cols; i++) {
      const wave = reducedMotion ? 0 : Math.round(Math.sin(clock / 120 - i * 0.5) * 1.2) * A;
      const x = px + 3 + i * A, y = top + wave;
      rect(ctx, x, y - 3, A, 42, INK);
      rect(ctx, x, y, A, 36, GREEN);
    }
    if (cols >= 18) {
      // A little heart on the cloth.
      const hx = px + 3 + 7 * A, hy = top + 3 * A + (reducedMotion ? 0 : Math.round(Math.sin(clock / 120 - 3.5) * 1.2) * A);
      for (const [x, y, w] of [[0, 0, 2], [3, 0, 2], [0, 1, 5], [1, 2, 3], [2, 3, 1]] as const) rect(ctx, hx + x * A, hy + y * A, w * A, A, INK);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Frame and timeline

  function render() {
    view.sync();
    frameRegion();
    view.begin(true, region);
    const e = since();
    // Reduced motion: the final frame simply fades in (element opacity, so no draw call can fight it).
    if (reducedMotion) canvas.style.opacity = phase === "ending" && e < 500 ? String(clamp(e / 480)) : "";
    if (ending === "moon" && shownAt() >= END.moon.cut) renderMoon(shownAt()); else renderWorld();
    if (!reducedMotion) {
      // Ignition flash, and the white flash that hides the cut to the Moon.
      const flash = phase === "flying" && flightMs < 90 ? 0.4 * (1 - flightMs / 90)
        : ending === "moon" ? (e < END.moon.cut ? e / END.moon.cut : 1 - (e - END.moon.cut) / 260) * 0.9 : 0;
      if (flash > 0.01) { ctx.globalAlpha = clamp(flash); rect(ctx, region.x, region.y, region.w, region.h, WHITE); ctx.globalAlpha = 1; }
    }
  }

  /** Particles and sound beats on the ending timeline between two moments (ms after end()). */
  function events(previous: number, now: number) {
    const crossed = (at: number) => previous < at && now >= at;
    const nozzle = (p: Point) => [p.x, p.y + ROCKET.bottom + 12] as const;
    switch (ending) {
      case "fizzle":
        if (!reducedMotion && Math.floor(previous / 140) !== Math.floor(now / 140) && now < END.pad.topple) fx.puff(...nozzle({ x: FLIGHT_X, y: PAD_Y }), 3, 14);
        break;
      case "crash":
        if (!reducedMotion && Math.floor(previous / 110) !== Math.floor(now / 110) && now < END.air.pop) fx.puff(...nozzle(from), 2, 12);
        if (crossed(END.air.pop)) {
          fx.confetti(from.x, from.y - 80, [GREEN, WHITE, GOLD, ORANGE], 34, 0.7);
          fx.sparkles(from.x, from.y - 60, 6, 90, GOLD, 3, 30);
          fx.ring(from.x, from.y - 40, 120, WHITE, 3, 320);
        }
        break;
      case "jump": {
        if (crossed(END.jump.hop)) fx.sparkles(from.x + 70, from.y - HALF - 90, 5, 60, GREEN, 3, 30);
        const touch = touchAt();
        if (crossed(touch)) {
          beat("touchdown");
          fx.squares(HAY.cx, HAY_TOP + 10, 22, [STRAW, STRAW_DARK, PAPER], 380);
          fx.puff(HAY.cx, HAY_TOP + 12, 10, 50);
        }
        if (crossed(touch + 420)) fx.hearts(HAY.cx, seat - HALF, 4, 50, 120);
        break;
      }
      case "moon": {
        const M = END.moon, ground = MOON_TOP.y;
        if (crossed(M.land)) { beat("touchdown"); fx.puff(MOON_TOP.x, ground, 14, 50); fx.dust(MOON_TOP.x - 30, ground, 1, 1.4); fx.dust(MOON_TOP.x + 30, ground, -1, 1.4); }
        if (crossed(M.flag)) fx.puff(MOON_TOP.x + 86, ground, 6, 24);
        if (crossed(M.rays)) {
          beat("moon");
          fx.confetti(MOON_TOP.x, ground - 160, [...PRISM, GOLD], 110, 1.3);
          fx.sparkles(MOON_TOP.x, ground - 80, 12, 200, GOLD, 3, 40);
          fx.ring(MOON_TOP.x, ground - 70, 210, GOLD, 6, 520);
          fx.ring(MOON_TOP.x, ground - 70, 140, WHITE, 4, 420, 90);
        }
        break;
      }
    }
    const splash = splashAt();
    if (crossed(splash)) {
      beat("splash");
      fx.squares(SPLASH_X, POND.surface - 6, 16, [WHITE, GRID], 230, INK, 560);
    }
    if (crossed(splash + END.pond.duck)) fx.squares(DUCK_X, POND.surface - 4, 6, [WHITE, GRID], 200, INK, 420);
    if (crossed(splash + END.pond.surface)) fx.squares(SPLASH_X - 16, POND.surface - 6, 8, [WHITE, GRID], 220, INK, 450);
    if (crossed(splash + duckHit)) fx.squares(DUCK_X - 10, POND.surface - 50, 8, [WHITE, GRID], 200, INK, 420);
    if (crossed(endTotal)) finish();
  }

  function finish() {
    const done = resolveEnd; resolveEnd = null;
    done?.();
  }

  function step(dt: number) {
    const previous = since();
    clock += dt;
    if (phase === "ready" && !reducedMotion && Math.floor((clock - dt) / 900) !== Math.floor(clock / 900)) {
      // The fuse fizzes a little: it is waiting to be lit.
      fx.sparkles(FLIGHT_X, PAD_Y + ROCKET.bottom + 18, 1, 8, GOLD, 3, 0);
    }
    if (phase === "flying" && !reducedMotion && Math.floor((clock - dt) / 50) !== Math.floor(clock / 50)) {
      fx.puff(FLIGHT_X + (Math.random() - 0.5) * 12, flightY(flightMs) + ROCKET.bottom + 36, 2, 9);
    }
    if (phase === "ending") {
      if (reducedMotion) { if (since() >= 500) { beat(ending === "jump" ? "touchdown" : ending === "moon" ? "moon" : "splash"); finish(); } }
      else events(previous, since());
    }
    fx.update(dt);
  }

  function loop(now: number) {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    // The final frame keeps animating gently for IDLE_MS, lets the last particles settle, then holds still under the
    // result card. Reduced motion draws only when something changes (and the final fade).
    const live = reducedMotion ? phase === "ending" && since() < 700 : phase !== "ending" || since() < endTotal + IDLE_MS || fx.count > 0;
    step(dt);
    if (live || dirty || view.sync()) { dirty = false; render(); }
  }
  raf = requestAnimationFrame(loop);

  return {
    ignite() {
      if (destroyed || phase !== "ready") return;
      phase = "flying"; flightMs = 0; dirty = true;
      beat("ignite");
      if (reducedMotion) return;
      fx.puff(FLIGHT_X, RAFT.top, 10, 44);
      fx.ring(FLIGHT_X, PAD_Y + ROCKET.bottom + 20, 90, WHITE, 3, 320);
      fx.squares(FLIGHT_X, PAD_Y + ROCKET.bottom + 20, 8, [GREEN, GOLD, WHITE], 240, INK, 500);
    },
    fly(ms) {
      if (destroyed || phase !== "flying" || !Number.isFinite(ms)) return;
      const next = clamp(ms, 0, FLIGHT_MS);
      for (const mark of [200, 400]) if (flightHundredths(flightMs) < mark && flightHundredths(next) >= mark) beat("pass", `pass:${mark}`);
      flightMs = next;
    },
    end(kind, jumpedAt) {
      if (endPromise) return endPromise;
      endPromise = new Promise<void>(resolve => { resolveEnd = resolve; });
      if (destroyed) { finish(); return endPromise; }
      const airborne = phase === "flying" && !reducedMotion;
      from = { x: FLIGHT_X, y: airborne ? flightY(flightMs) : PAD_Y };
      fromCam = airborne ? Math.min(GROUND_CAM, from.y - climbScreenY(flightMs)) : GROUND_CAM;
      fromFocus = airborne ? climbFocus(flightMs) : FOCUS.ready;
      ending = kind; exit = jumpedAt; endAt = clock; phase = "ending"; dirty = true;
      fallMs = clamp(350 + (contact - from.y) * 0.3, 380, 1100);
      descentMs = clamp(900 + (seat - from.y) * 0.35, 1000, 1900);
      endTotal = kind === "fizzle" ? END.pad.land + END.pond.end : kind === "crash" ? END.air.pop + fallMs + END.pond.end
        : kind === "jump" ? END.jump.hop + descentMs + END.jump.settle : END.moon.end;
      if (kind === "jump") beat("jump"); else if (kind !== "moon") beat("sputter");
      if (reducedMotion) fx.clear();
      return endPromise;
    },
    skip() {
      if (destroyed || phase !== "ending") return;
      fx.clear();
      beat(ending === "jump" ? "touchdown" : ending === "moon" ? "moon" : "splash");
      clock = endAt + Math.max(since(), reducedMotion ? 700 : endTotal + 1);
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
