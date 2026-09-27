// The Moon Slingshot overlay: the baby shoots out of the nursery window, flies past the landing zones and
// lands in the zone src/slingshot.ts already drew, with one slapstick gag per zone. Side view: the camera
// follows it over the garden, the pond, the hay field and the village, up to the clouds and, for the two far
// zones, into space. World art sits on the room's 3 px art grid; the baby flies at sprite scale 8 so the
// gags read on phones.
import { WORLD_HEIGHT as H, WORLD_WIDTH as W, type LaunchSequence, type LaunchSequenceOptions } from "../api.ts";
import { multiplierLabel, zoneInfo } from "../slingshot.ts";
import { FRAME_SIZE, type Clip, type Facing, type Frame, type LaunchZoneId } from "../types.ts";
import {
  GREEN, GRID, INK, MOSS, MUTED, PAPER, SHADE, WHITE, bitmap, box, clamp, dither, easeInCubic, easeOutBack, easeOutCubic,
  ellipseBox, lerp, makeCanvas, rect, rng,
} from "./art.ts";
import { paintCreature } from "./creatures.ts";
import { drawText, textWidth } from "./font.ts";
import { createParticles } from "./fx.ts";
import { createPixelView } from "./view.ts";

type Beat = "launch" | "apex" | "land";
type Point = { x: number; y: number };
/** How the baby is drawn. x, y: centre of its 16 x 16 box (world px, or screen px in space). */
type Pose = {
  x: number; y: number;
  /** Quarter turns clockwise. */
  rot: number;
  clip: Clip; facing: Facing; frame: number;
  /** Screen-space squash and stretch around (ax, ay), default the box centre. */
  sx: number; sy: number; ax?: number; ay?: number;
  /** Nothing below this y is drawn (water line, hay); `under` shows that part as a dim silhouette (water). */
  cut?: number;
  under?: boolean;
};

const A = 3, S = 8, HALF = 8 * S, BOX = 16 * S;
const ART_W = W / A, ART_H = Math.ceil(H / A);

/** How long the landed frame keeps its gentle idle after `end` before it holds still. */
const IDLE_MS = 2000;
// Timeline (ms). apex and land are beats (arc apexes are measured from the path), title shows the zone name,
// end resolves play(). Durations grow with the distance so every extra second means "further".
const T = {
  pond: { apex: 520, look: 690, drop: 830, land: 1030, sink: 1110, duck: 1200, surface: 1380, spit: 1470, title: 1260, end: 2250 },
  haystack: { apex: 0, land: 1500, title: 1830, end: 2900 },
  rooftop: { apex: 0, land: 1950, bounce: 2230, edge: 2720, clonk: 3040, title: 3180, end: 3700 },
  cloud: { apex: 0, land: 2550, settle: 3840, title: 2960, end: 4300 },
  orbit: { apex: 1450, insert: 2250, land: 2700, title: 3000, end: 4900 },
  moon: { apex: 1450, leave: 2250, descend: 3480, land: 4300, flag: 4560, title: 4760, end: 5500 },
} as const;

// World layout (logical px; ground is y = 0, up is negative).
/** Camera top when the ground is framed (ground line at screen y 480), and the camera left at the start. */
const GROUND_CAM = -480, START_CAM_X = -470;
/** The nursery facade (art canvas, 120 x 132 art px) and its open window. */
const HOUSE = { x: -390, y: -396, win: { x: 62, y: 54, w: 44, h: 42 } };
/** Where the baby leaves the window (box centre). */
const EXIT: Point = { x: HOUSE.x + (HOUSE.win.x + HOUSE.win.w / 2) * A, y: HOUSE.y + (HOUSE.win.y + HOUSE.win.h / 2) * A };
const POND = { x0: 170, x1: 560, surface: 6, depth: 22 };
const STALL: Point = { x: 345, y: -300 };
const HAY = { cx: 770, w: 74, h: 54 };
const HAY_TOP = -HAY.h * A;
const HOUSES = [
  { cx: 1010, w: 44, wall: 36, roof: 22, chimney: 1 },
  { cx: 1210, w: 72, wall: 46, roof: 46, chimney: -1 },
  { cx: 1420, w: 46, wall: 34, roof: 24, chimney: 0 },
  { cx: 1590, w: 52, wall: 40, roof: 28, chimney: 1 },
] as const;
const OVERHANG = 4;
const TARGET = HOUSES[1];
const PEAK: Point = { x: TARGET.cx, y: -(TARGET.wall + TARGET.roof) * A };
const SLOPE = TARGET.roof / (TARGET.w / 2 + OVERHANG);
const roofY = (x: number) => PEAK.y + Math.abs(x - PEAK.x) * SLOPE;
const EAVE_X = PEAK.x + (TARGET.w / 2 + OVERHANG) * A;
const CLOUD9 = { cx: 1600, cy: -520, w: 92, h: 34 };
const CLOUD9_TOP = CLOUD9.cy - (CLOUD9.h * A) / 2 + 9;
/** Decorative clouds (world px, art size, seed). The high ones pass by on the way to orbit and the Moon. */
const CLOUDS = [
  [-250, -600, 46, 16, 1], [430, -760, 58, 20, 2], [880, -900, 64, 22, 3], [1230, -690, 50, 18, 4], [1880, -740, 60, 20, 5],
  [1900, -420, 44, 16, 6], [1190, -1080, 56, 20, 7], [150, -1080, 62, 22, 8], [520, -1260, 70, 24, 10], [80, -1640, 58, 20, 11],
  [640, -1720, 76, 26, 12],
] as const;
const LAND = { x0: -600, y0: -420, w: 860, h: 200 };
const SKY = { y0: -3000, y1: 240 };
const FINAL_CAM: Partial<Record<LaunchZoneId, Point>> = {
  pond: { x: 20, y: GROUND_CAM }, haystack: { x: 400, y: GROUND_CAM }, rooftop: { x: 840, y: -600 }, cloud: { x: 1120, y: -960 },
};
// Space (screen px).
const GLOBE = { x: 480, y: 360, r: 150 };
const ORBIT = { rx: 320, ry: 112, tilt: -0.17, period: 1100 };
const MOON_TOP: Point = { x: 560, y: 430 }, MOON_R = 900;
const EARTH_FAR = { x: 190, y: 372, r: 48 };
const DAY_MOON = { x: 800, y: 118, r: 27 };

const WATER = MUTED, WATER_LIGHT = "#A39E94", WATER_DEEP = "#77726A", ROOF = "#2E2E2E", STRAW = "#EADBA8", STRAW_DARK = "#C9B278";
const SKY_RAMP = [WHITE, PAPER, GRID, SHADE, "#BDB6A8", MUTED, "#6A655D", "#45423D", "#2A2927", "#1A1A1A", INK];
const PRISM = ["#FF4D6D", "#FFB800", GREEN, "#3DDCFF", "#8A4DFF", WHITE];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const STAMP: Record<LaunchZoneId, string> = { pond: "SPLASH!", haystack: "POOF!", rooftop: "BONK!", cloud: "BOING!", orbit: "WHEEE!", moon: "TOUCHDOWN!" };
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
const TILE = bitmap(["########", "#mmmmmm#", "#mmmmmm#", "#ssssss#", "########"]);
const DIZZY = bitmap(["..#..", ".#G#.", "#GwG#", ".#G#.", "..#.."]);
const DROP = bitmap([".#.", "#w#", "#w#", ".#."]);

const smooth = (x: number) => { x = clamp(x); return x * x * (3 - 2 * x); };
const pack = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (255 << 24 | (n & 0xff) << 16 | ((n >> 8) & 0xff) << 8 | (n >> 16)) >>> 0;
};
/** Sky darkness at an altitude: 0 day, 1 space. */
const darkness = (y: number) => Math.pow(clamp((-y - 180) / 1700), 1.4);

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
// Static art, painted once and shared by every launch

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
  // Picket fence along the garden.
  for (let x = X(-20); x < X(135); x += 5) { box(g, x, ground - 10, 3, 11, WHITE); rect(g, x + 1, ground - 11, 1, 1, INK); }
  rect(g, X(-20), ground - 7, X(135) - X(-20), 1, INK);
  rect(g, X(-20), ground - 3, X(135) - X(-20), 1, INK);
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
  for (const [px, r] of [[cx - 34, 5], [cx + 22, 4], [cx + 44, 3]] as const) {
    ellipseBox(g, Math.round(px), surface, r, 1, GREEN);
    rect(g, Math.round(px) + 1, surface - 1, 1, 2, INK);
  }
  sign(150, "×0");
  // Hay field: pitchfork and sign (the haystack itself is drawn live, it squashes).
  sign(640, multiplierText(5000));
  const fork = X(HAY.cx + HAY.w * A / 2 + 18);
  for (let i = 0; i < 26; i++) rect(g, fork + Math.floor(i / 5), ground - i, 1, 1, INK);
  for (let i = 0; i < 3; i++) rect(g, fork + 4 + i * 2, ground - 32, 1, 6, MUTED);
  rect(g, fork + 4, ground - 27, 5, 1, MUTED);
  // Village.
  sign(905, "×1");
  for (const house of HOUSES) paintVillageHouse(g, house, X(house.cx), ground);
  for (const [x, r] of [[1290, 5], [1450, 6], [1640, 7], [1760, 5]] as const) {
    ellipseBox(g, X(x), ground - r, r + 1, r, GREEN);
    rect(g, X(x) - 2, ground - r - 2, 2, 1, WHITE);
  }
  return canvas;
}

function multiplierText(bps: number) { return multiplierLabel(bps).replace(/^x/, "×"); }

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
  const { canvas, baby, zone, onBeat } = options;
  const reducedMotion = options.reducedMotion;
  const pull = clamp(Number.isFinite(options.pull) ? options.pull : 0.5);
  /** Cosmetic: a harder pull front-loads the launch and spins faster. Paths and landings never change. */
  const kick = 0.3 + 0.7 * pull;
  let destroyed = false, dirty = true, raf = 0, last = 0;
  let t = 0, started = false, finished = false;
  let playPromise: Promise<void> | null = null, resolvePlay: (() => void) | null = null;
  const fired = new Set<string>();
  const view = createPixelView(canvas, W, H, () => { dirty = true; });
  const ctx = view.ctx;
  const fx = createParticles();
  const art = cachedArt ??= paintArt();
  const info = zoneInfo(zone);
  const multiplier = multiplierText(info.multiplierBps);
  const space = zone === "orbit" || zone === "moon";
  const plan = T[zone];
  // Ink extents of the baby, for contact points: feet below the centre, head above it, front edge (facing right).
  const front = inkBox(baby.sheet.idle.down[0]), side = inkBox(baby.sheet.idle.right[0]);
  const feet = (front.maxY + 1 - 8) * S, head = (8 - side.minY) * S, belly = (side.maxX + 1 - 8) * S;
  const headTop = (8 - front.minY) * S;
  if (!canvas.hasAttribute("aria-label")) canvas.setAttribute("aria-label", `${baby.name} flies out of the nursery window: ${info.label}, ${multiplier}.`);

  const beat = (name: Beat) => {
    if (fired.has(name)) return;
    fired.add(name);
    try { onBeat?.(name); } catch { /* sound errors must not break the show */ }
  };

  // ------------------------------------------------------------------------------------------
  // Paths (pure functions of time)

  const flail = (time: number) => Math.floor(time / (72 - 22 * pull)) % 8;
  function arc(time: number, t1: number, to: Point, height: number): Point {
    const raw = clamp(time / t1), u = raw + kick * raw * (1 - raw) ** 2;
    return { x: lerp(EXIT.x, to.x, u), y: lerp(EXIT.y, to.y, u) - 4 * height * u * (1 - u) };
  }
  /** Quarter turns: tumbles from `start` and settles on `final` (mod 4) at `stop`. */
  function tumble(time: number, start: number, stop: number, final: number) {
    const turns = 4 * Math.max(1, Math.round((stop - start) / (600 - 260 * pull))) + final;
    return Math.floor(turns * clamp((time - start) / (stop - start)));
  }
  const flying = (p: Point, time: number, rot: number): Pose => ({ ...p, rot, clip: "walk", facing: "right", frame: flail(time), sx: 1, sy: 1 });

  function pondPose(time: number): Pose {
    const P = T.pond;
    if (time < P.apex) {
      // Out of the window with a somersault, then it simply runs out of steam above the pond.
      const u = time / P.apex, e = 1 - Math.pow(1 - u, 2.2 + pull);
      return flying({ x: lerp(EXIT.x, STALL.x, e), y: lerp(EXIT.y, STALL.y, e) }, time, Math.floor(4 * clamp(u * 1.3)));
    }
    if (time < P.drop) {
      const looking = time >= P.look, hover = Math.round(Math.sin((time - P.apex) / 80) * 2);
      return { x: STALL.x, y: STALL.y + hover, rot: 0, clip: looking ? "idle" : "walk", facing: looking ? "down" : "right", frame: looking ? 0 : Math.floor(time / 40) % 8, sx: 1, sy: 1 };
    }
    const contact = POND.surface - belly;
    if (time < P.land) {
      const u = (time - P.drop) / (P.land - P.drop);
      return { x: STALL.x + 8 * u, y: lerp(STALL.y, contact, easeInCubic(u)), rot: u > 0.25 ? 1 : 0, clip: "idle", facing: u > 0.25 ? "right" : "down", frame: 0, sx: 0.9, sy: 1.14 };
    }
    const since = time - P.land;
    if (time < P.surface) {
      const flat = since < 150 ? 1 - Math.sin((since / 150) * Math.PI) * 0.4 : 1;
      const sink = easeInCubic(clamp((time - P.sink) / 240)) * (BOX + 30);
      return { x: STALL.x + 8, y: contact + sink, rot: 1, clip: "idle", facing: "right", frame: 0, sx: 1 / Math.sqrt(flat), sy: flat, ay: POND.surface, cut: POND.surface, under: true };
    }
    // Surfaces up to its chin, spits a fountain at the duck, then bobs.
    const up = time - P.surface, rise = easeOutBack(clamp(up / 280), 2.4);
    const rest = POND.surface - (front.minY + 8) * S + HALF;
    const spitting = time >= P.spit && time < P.spit + 300;
    const bob = up > 280 ? Math.round(Math.sin((up - 280) / 240) * 3) : 0;
    return {
      x: STALL.x - 8, y: lerp(POND.surface + HALF + 6, rest, rise) + bob, rot: 0, clip: "idle", facing: "down", frame: spitting ? 0 : Math.floor(up / 170) % 8,
      sx: spitting ? 1.08 : 1, sy: spitting ? 0.94 : 1, ay: POND.surface, cut: POND.surface, under: true,
    };
  }

  /** Haystack squash: vertical scale of the stack after the dive. */
  const hayScale = (time: number) => {
    const since = time - T.haystack.land;
    return since < 0 ? 1 : 1 - 0.16 * Math.exp(-since / 200) * Math.cos(since / 55);
  };
  function hayPose(time: number): Pose {
    const P = T.haystack;
    const contact = HAY_TOP - head;
    if (time < P.land) return flying(arc(time, P.land, { x: HAY.cx, y: contact }, 250), time, tumble(time, 110, P.land - 260, 2));
    // Head first into the hay: only the legs stick out, kicking, with a pause for comic timing.
    const since = time - P.land, top = HAY_TOP * hayScale(time);
    const plunge = easeOutCubic(clamp(since / 130));
    const loop = since - 1250;
    const kicking = since < 620 || (loop > 0 && loop % 1300 < 760);
    const jiggle = kicking ? Math.round(Math.sin(since / 30) * 6) : 0;
    return { x: HAY.cx + jiggle, y: lerp(contact, top - 10 * S + HALF + 6, plunge), rot: 2, clip: kicking ? "walk" : "idle", facing: since < 90 ? "right" : "down", frame: kicking ? Math.floor(since / 50) % 8 : 0, sx: 1, sy: 1, cut: top + 6 };
  }

  const HIT_X = PEAK.x + 16, SEAT_X = PEAK.x + 36, EDGE_X = EAVE_X - 16;
  const roofHit: Point = { x: HIT_X, y: roofY(HIT_X) - belly };
  const edgeFeet = roofY(EDGE_X);
  function roofPose(time: number): Pose {
    const P = T.rooftop;
    if (time < P.land) return flying(arc(time, P.land, roofHit, 300), time, tumble(time, 110, P.land - 200, 1));
    const since = time - P.land;
    if (since < 70) return { ...roofHit, rot: 1, clip: "idle", facing: "right", frame: 0, sx: 1.18, sy: 0.8, ay: roofY(HIT_X) };
    if (time < P.bounce) {
      // Bounces off with a flip and lands on its bottom further down the slope.
      const u = (since - 70) / (P.bounce - P.land - 70), seat = { x: SEAT_X, y: roofY(SEAT_X) - feet };
      return { x: lerp(roofHit.x, seat.x, u), y: lerp(roofHit.y, seat.y, u) - 4 * 80 * u * (1 - u), rot: 1 + Math.floor(3 * clamp(u * 1.4)), clip: "walk", facing: "right", frame: Math.floor(time / 45) % 8, sx: 1, sy: 1 };
    }
    if (time < P.edge) {
      const u = (time - P.bounce) / (P.edge - P.bounce), x = lerp(SEAT_X, EDGE_X, u * u);
      return { x, y: roofY(x) - feet, rot: 0, clip: "idle", facing: "right", frame: 0, sx: 1, sy: 1 };
    }
    if (time < P.clonk) {
      // Stops right at the edge and teeters, then looks at us: phew.
      const k = (time - P.edge) / (P.clonk - P.edge);
      return { x: EDGE_X + Math.round(Math.sin(k * Math.PI * 5) * 4 * (1 - k)), y: edgeFeet - feet, rot: 0, clip: "idle", facing: k > 0.45 ? "down" : "right", frame: 0, sx: 1, sy: 1 };
    }
    const hit = time - P.clonk, squash = hit < 170 ? 1 - Math.sin((hit / 170) * Math.PI) * 0.24 : 1;
    return { x: EDGE_X + Math.round(Math.sin(hit / 260) * 3), y: edgeFeet - feet, rot: 0, clip: "idle", facing: "down", frame: Math.floor(hit / 200) % 8, sx: 1 / Math.sqrt(squash), sy: squash, ay: edgeFeet };
  }
  /** The roof tile knocked loose by the first bonk: up it goes, and down on the baby's head. */
  function tileAt(time: number) {
    const P = T.rooftop, u = clamp((time - P.land) / (P.clonk - P.land));
    const to = edgeFeet - feet - headTop;
    return { x: lerp(HIT_X, EDGE_X, u), y: lerp(roofY(HIT_X), to, u) - 4 * 290 * u * (1 - u), rot: Math.floor((time - P.land) / 85) };
  }

  // Cloud bounces after the landing: [start, end, kind, amount]. dip: sinks into the fluff, air: hops.
  const BOUNCES = [[0, 110, "dip", 36], [110, 210, "rise", 36], [210, 600, "air", 150], [600, 670, "dip", 18], [670, 740, "rise", 18],
    [740, 980, "air", 54], [980, 1020, "dip", 8], [1020, 1060, "rise", 8], [1060, 1200, "air", 16], [1200, 1250, "dip", 4], [1250, 1290, "rise", 4]] as const;
  function bounceAt(since: number) {
    for (const [a, b, kind, amount] of BOUNCES) {
      if (since < a || since >= b) continue;
      const u = (since - a) / (b - a);
      if (kind === "air") return { dip: 0, lift: 4 * amount * u * (1 - u), flip: a === 210 ? Math.floor(4 * clamp(u * 1.2)) : 0 };
      return { dip: amount * Math.sin((kind === "dip" ? u : 1 - u) * Math.PI / 2), lift: 0, flip: 0 };
    }
    return { dip: since < 0 ? 0 : 3, lift: 0, flip: 0 };
  }
  function cloudPose(time: number): Pose {
    const P = T.cloud, rest = CLOUD9_TOP - feet;
    if (time < P.land) return flying(arc(time, P.land, { x: CLOUD9.cx, y: rest }, 620), time, tumble(time, 110, P.land - 320, 0));
    const since = time - P.land, b = bounceAt(since), sat = time >= P.settle;
    const squash = 1 - b.dip / 150;
    return {
      x: CLOUD9.cx, y: rest + b.dip - b.lift, rot: b.flip, clip: b.lift > 0 ? "walk" : "idle", facing: sat ? "down" : "right",
      frame: sat ? Math.floor(since / 190) % 8 : Math.floor(since / 45) % 8, sx: 1 / Math.sqrt(squash), sy: squash, ay: CLOUD9_TOP + b.dip,
    };
  }

  function ascentPose(time: number): Pose {
    const raw = clamp(time / T.orbit.apex), u = raw + kick * 0.5 * raw * (1 - raw) ** 2;
    return flying({ x: EXIT.x + 640 * (1 - Math.pow(1 - u, 2.2)), y: EXIT.y - 2232 * (0.45 * u + 0.55 * u * u) }, time, Math.floor(4 * clamp(u / 0.35)));
  }

  function worldPose(time: number): Pose {
    switch (zone) {
      case "pond": return pondPose(time);
      case "haystack": return hayPose(time);
      case "rooftop": return roofPose(time);
      case "cloud": return cloudPose(time);
      default: return ascentPose(Math.min(time, T.orbit.apex));
    }
  }

  // The camera holds on the window for the burst, follows the baby (a centred moving average smooths the
  // turns), then settles on the landing frame.
  function follow(time: number): Point {
    const p = worldPose(clamp(time, 0, space ? T.orbit.apex : plan.end));
    return { x: Math.max(START_CAM_X, p.x - 400), y: Math.min(GROUND_CAM, p.y - 150) };
  }
  function cameraAt(time: number): Point {
    let x = 0, y = 0;
    for (let k = -3; k <= 3; k++) { const c = follow(time + k * 45); x += c.x; y += c.y; }
    x = lerp(START_CAM_X, x / 7, smooth((time - 90) / 460)); y = lerp(GROUND_CAM, y / 7, smooth((time - 30) / 240));
    const final = FINAL_CAM[zone];
    if (final) { const k = smooth((time - (plan.land - 700)) / 900); x = lerp(x, final.x, k); y = lerp(y, final.y, k); }
    return { x: Math.round(x), y: Math.round(y) };
  }

  // Space (orbit and moon), screen coordinates. The flight enters where the world camera last showed it.
  const entry = (() => { const p = ascentPose(T.orbit.apex), c = cameraAt(T.orbit.apex); return { x: p.x - c.x, y: p.y - c.y }; })();
  const orbitPoint = (theta: number) => {
    const c = Math.cos(ORBIT.tilt), s = Math.sin(ORBIT.tilt), ex = ORBIT.rx * Math.cos(theta), ey = ORBIT.ry * Math.sin(theta);
    return { x: GLOBE.x + ex * c - ey * s, y: GLOBE.y + ex * s + ey * c };
  };
  const orbitAngle = (time: number) => Math.PI - (2 * Math.PI * (time - T.orbit.land)) / ORBIT.period;
  function spacePose(time: number): Pose {
    const since = time - T.orbit.apex;
    const rise = easeOutCubic(clamp(since / 800));
    const lazy = Math.floor(time / 110) % 8;
    let x = lerp(entry.x, 480, rise), y = lerp(entry.y, 170, rise);
    if (zone === "orbit") {
      if (time < T.orbit.insert) return { x, y, rot: 0, clip: "walk", facing: "right", frame: lazy, sx: 1, sy: 1 };
      if (time < T.orbit.land) {
        // Swoops down into the orbit on a curve that meets it at its left end, moving down.
        const k0 = (time - T.orbit.insert) / (T.orbit.land - T.orbit.insert), k = k0 * (1.25 - 0.25 * k0);
        const end = orbitPoint(Math.PI), c = { x: end.x, y: end.y - 190 };
        x = (1 - k) ** 2 * 480 + 2 * k * (1 - k) * c.x + k * k * end.x;
        y = (1 - k) ** 2 * 170 + 2 * k * (1 - k) * c.y + k * k * end.y;
        return { x, y, rot: Math.floor(k0 * 2), clip: "walk", facing: "right", frame: flail(time), sx: 1, sy: 1 };
      }
      const p = orbitPoint(orbitAngle(time));
      return { ...p, rot: Math.floor((time - T.orbit.land) / 110), clip: "walk", facing: "right", frame: flail(time), sx: 1, sy: 1 };
    }
    const P = T.moon;
    if (time < P.descend) {
      // Keeps going past the orbit, floats with a lazy somersault while the Moon comes closer.
      const k = clamp((time - P.leave) / (P.descend - P.leave));
      return { x: x + 20 * smooth(k), y: y - 18 * Math.sin(k * Math.PI), rot: time > P.leave + 300 ? Math.floor(4 * clamp((time - P.leave - 300) / 900)) : 0, clip: "walk", facing: "right", frame: lazy, sx: 1, sy: 1 };
    }
    const top = MOON_TOP.y - feet;
    if (time < P.land) {
      const k = smooth((time - P.descend) / (P.land - P.descend));
      return { x: lerp(500, MOON_TOP.x, k), y: lerp(170, top, k), rot: 0, clip: k > 0.7 ? "idle" : "walk", facing: "right", frame: k > 0.7 ? 0 : lazy, sx: 1, sy: 1 };
    }
    const after = time - P.land;
    const squash = after < 200 ? 1 - Math.sin((after / 200) * Math.PI) * 0.25 : 1;
    // Low-gravity happy hops after the jackpot.
    const hop = time > P.title ? Math.max(0, Math.sin(((time - P.title) / 900) * Math.PI * 2)) * 34 : 0;
    return { x: MOON_TOP.x, y: top - hop, rot: 0, clip: hop > 0 ? "walk" : "idle", facing: time > P.flag - 60 ? "down" : "right", frame: Math.floor(after / 170) % 8, sx: 1 / Math.sqrt(squash), sy: squash, ay: MOON_TOP.y };
  }

  function earthAt(time: number) {
    const k = easeOutCubic(clamp((time - T.orbit.apex) / 1100));
    const r = Math.exp(lerp(Math.log(2600), Math.log(GLOBE.r), k)), top = lerp(700, GLOBE.y - GLOBE.r, k);
    const e = { x: GLOBE.x, y: top + r, r };
    if (zone !== "moon") return e;
    const m = smooth((time - T.moon.leave) / 1300);
    return { x: lerp(e.x, EARTH_FAR.x, m), y: lerp(e.y, EARTH_FAR.y, m), r: Math.exp(lerp(Math.log(e.r), Math.log(EARTH_FAR.r), m)) };
  }
  /** Where the day moon sits for a camera (world phase), and the Moon in space. */
  const dayMoon = (cam: Point) => ({ x: DAY_MOON.x - (cam.x - START_CAM_X) * 0.03, y: DAY_MOON.y - (cam.y - GROUND_CAM) * 0.05, r: DAY_MOON.r });
  const skyMoon = dayMoon(cameraAt(T.orbit.apex));
  function moonAt(time: number) {
    if (zone !== "moon") return { x: skyMoon.x, y: skyMoon.y, r: skyMoon.r };
    const m = smooth((time - T.moon.leave - 100) / 1300);
    const r = Math.exp(lerp(Math.log(skyMoon.r), Math.log(MOON_R), m));
    const topX = lerp(skyMoon.x, MOON_TOP.x, m), topY = lerp(skyMoon.y - skyMoon.r, MOON_TOP.y, m);
    return { x: topX, y: topY + r, r };
  }

  // Beat times: arc apexes are measured from the path.
  const apexAt = (() => {
    if (plan.apex) return plan.apex;
    let best = 0, high = Infinity;
    for (let time = 0; time < plan.land; time += 10) { const y = worldPose(time).y; if (y < high) { high = y; best = time; } }
    return best;
  })();

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

  /** Speed lines trailing the baby, from its motion over the last frames. */
  function drawTrail(poseAt: (time: number) => Pose, time: number, color: string) {
    const now = poseAt(time), before = poseAt(time - 40);
    const vx = now.x - before.x, vy = now.y - before.y, speed = Math.hypot(vx, vy);
    if (speed < 14) return;
    const ux = vx / speed, uy = vy / speed, px = -uy, py = ux;
    ctx.fillStyle = color;
    for (let i = -1; i <= 1; i++) {
      const length = Math.min(90, speed * 2.2) * (i ? 0.7 : 1), off = i * 30 + ((Math.floor(time / 60) + i) % 2) * 4;
      for (let d = HALF; d < HALF + length; d += 6) {
        ctx.fillRect(Math.round((now.x - ux * d + px * off) / A) * A, Math.round((now.y - uy * d + py * off) / A) * A, A, A);
      }
    }
  }

  function drawSky(camY: number) {
    const rows = art.sky.height;
    const row = clamp(Math.floor((camY - SKY.y0) / A), 0, rows - ART_H - 1);
    ctx.drawImage(art.sky, 0, row, ART_W, ART_H + 1, 0, SKY.y0 + row * A - camY, W, (ART_H + 1) * A);
  }

  function drawStars(shift: number, alpha: number) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    const span = ART_H * A;
    art.stars.forEach((layer, i) => {
      const y = ((Math.round(shift * (1 + i * 1.4) / A) * A) % span + span) % span;
      ctx.drawImage(layer, 0, y, W, span);
      ctx.drawImage(layer, 0, y - span, W, span);
    });
    ctx.globalAlpha = 1;
  }

  // Discs are drawn in art units (ctx scaled by A) so every curve stays on the 3 px grid.
  function drawMoonDisc(cx: number, cy: number, r: number, day: boolean) {
    const fill = day ? GRID : SHADE, lit = day ? WHITE : GRID, pit = day ? SHADE : MUTED;
    discRows(cx, cy, r + 1, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, day ? SHADE : INK));
    discRows(cx, cy, r, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, fill));
    discRows(cx - r * 0.16, cy - r * 0.18, r * 0.84, (y, x0, x1) => {
      const span = discSpan(cx, cy, r - 1, y);
      if (span) rect(ctx, Math.max(x0, span[0]), y, Math.min(x1, span[1]) - Math.max(x0, span[0]), 1, lit);
    });
    for (const [u, v, ru, rv] of MARIA) {
      const ex = cx + u * r, ey = cy + v * r, rx = ru * r, ry = rv * r;
      discRows(ex, ey, rx, (y, x0, x1) => {
        if (Math.abs(y + 0.5 - ey) > ry) return;
        const body = discSpan(cx, cy, r - 1, y);
        if (body && Math.min(x1, body[1]) > Math.max(x0, body[0])) rect(ctx, Math.max(x0, body[0]), y, Math.min(x1, body[1]) - Math.max(x0, body[0]), 1, day ? SHADE : "#CFC8BA");
      });
    }
    if (r > 40) for (const [u, v] of SPECKS) {
      const x = Math.round(cx + u * r), y = Math.round(cy + v * r), body = discSpan(cx, cy, r - 2, y);
      if (body && x > body[0] && x < body[1] - 1) { rect(ctx, x, y, 2, 1, pit); rect(ctx, x, y + 1, 2, 1, lit); }
    }
    for (const [u, v, ru, rv] of CRATERS) {
      const ex = cx + u * r, ey = cy + v * r, rx = ru * r, ry = Math.max(0.6, rv * r);
      if (rx < 2.5 || ey + ry < 0 || ey - ry > ART_H || ex + rx < 0 || ex - rx > ART_W) continue;
      for (let y = Math.max(0, Math.floor(ey - ry)); y <= Math.min(ART_H - 1, Math.ceil(ey + ry)); y++) {
        const dy = (y + 0.5 - ey) * (rx / ry), h2 = rx * rx - dy * dy, body = discSpan(cx, cy, r, y);
        if (h2 <= 0 || !body) continue;
        const half = Math.sqrt(h2), a = Math.max(Math.round(ex - half), body[0]), b = Math.min(Math.round(ex + half), body[1]);
        // Shadowed upper lip, lit lower lip.
        if (b > a) rect(ctx, a, y, b - a, 1, y < ey - ry + 1 ? (day ? SHADE : INK) : y + 1 > ey + ry - 1 ? lit : pit);
      }
    }
  }

  function drawEarth(cx: number, cy: number, r: number, time: number) {
    // Atmosphere: a dotted green ring, then ink outline, paper oceans, green land, white clouds, night side.
    discRows(cx, cy, r + 3, (y, x0, x1) => {
      const inner = discSpan(cx, cy, r + 1, y);
      const paint = (a: number, b: number) => { for (let x = Math.max(a, -1); x < Math.min(b, ART_W + 1); x++) if ((x + y) % 2 === 0) rect(ctx, x, y, 1, 1, (x + y) % 4 === 0 ? GREEN : MOSS); };
      if (!inner) paint(x0, x1); else { paint(x0, inner[0]); paint(inner[1], x1); }
    });
    discRows(cx, cy, r + 1, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, INK));
    discRows(cx, cy, r, (y, x0, x1) => rect(ctx, x0, y, x1 - x0, 1, PAPER));
    const spin = time / 9000;
    const blob = (u: number, v: number, ru: number, rv: number, color: string) => {
      const ex = cx + u * r, ey = cy + v * r, rx = ru * r, ry = Math.max(0.6, rv * r);
      if (ex + rx < -2 || ex - rx > ART_W + 2 || ey + ry < 0 || ey - ry > ART_H) return;
      for (let y = Math.max(0, Math.floor(ey - ry)); y <= Math.min(ART_H - 1, Math.ceil(ey + ry)); y++) {
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
    });
    ctx.globalAlpha = 1;
  }

  function drawOrbitRing(e: { x: number; y: number; r: number }, half: "back" | "front", time: number, alpha: number) {
    if (alpha <= 0.01) return;
    const scale = e.r / GLOBE.r, c = Math.cos(ORBIT.tilt), s = Math.sin(ORBIT.tilt);
    ctx.globalAlpha = alpha;
    const count = 72, march = (time / 600) % 1;
    for (let i = 0; i < count; i++) {
      const theta = ((i + march) / count) * Math.PI * 2, front = Math.sin(theta) > 0;
      if (front !== (half === "front") || i % 2) continue;
      const ex = ORBIT.rx * scale * Math.cos(theta), ey = ORBIT.ry * scale * Math.sin(theta);
      const size = front ? 2 * A : A;
      rect(ctx, Math.round((e.x + ex * c - ey * s) / A) * A - size / 2, Math.round((e.y + ex * s + ey * c) / A) * A - size / 2, size, size, front ? GREEN : MUTED);
    }
    if (half === "front") {
      const tag = { x: e.x + ORBIT.rx * scale * c + 14, y: e.y + ORBIT.rx * scale * s - 10 };
      drawText(ctx, multiplierText(40_000), tag.x, tag.y, { scale: 3, color: GREEN, outline: INK });
    }
    ctx.globalAlpha = 1;
  }

  function drawCloud(sprite: HTMLCanvasElement, cx: number, cy: number, sx = 1, sy = 1) {
    const w = Math.round(sprite.width * A * sx), h = Math.round(sprite.height * A * sy);
    ctx.drawImage(sprite, Math.round(cx - w / 2), Math.round(cy + (sprite.height * A) / 2 - h), w, h);
  }

  function drawStamp(text: string, x: number, y: number, since: number, scale: number, color = WHITE) {
    if (since < 0 || since > 650) return;
    const pop = since < 70 ? scale - 2 : since < 140 ? scale + 1 : scale;
    ctx.globalAlpha = since > 480 ? 1 - (since - 480) / 170 : 1;
    const rise = Math.round(Math.min(since, 480) / 40);
    const width = textWidth(text, pop);
    const left = clamp(x - width / 2, 24, W - 24 - width);
    drawText(ctx, text, left, clamp(y - rise, 160, 470), { scale: pop, color, outline: INK });
    ctx.globalAlpha = 1;
  }

  function drawTitle(time: number) {
    const since = reducedMotion ? 9999 : time - plan.title;
    if (since < 0) return;
    const label = info.label.toUpperCase(), big = zone === "moon";
    const labelScale = 3, multScale = big ? 7 : 5;
    const lw = textWidth(label, labelScale), mw = textWidth(multiplier, multScale), gap = 18;
    const width = lw + gap + mw + 36, height = multScale * 7 + 26;
    const drop = easeOutBack(clamp(since / 380), 1.8);
    const left = Math.round(W / 2 - width / 2), top = Math.round(lerp(-height - 10, 70, drop));
    rect(ctx, left - 3, top - 3, width + 6, height + 6, info.multiplierBps >= 20_000 ? GREEN : PAPER);
    rect(ctx, left, top, width, height, INK);
    drawText(ctx, label, left + 18, top + (height - 7 * labelScale) / 2, { scale: labelScale, color: PAPER });
    const colors = info.multiplierBps === 0 ? MUTED : info.multiplierBps < 20_000 ? WHITE : GREEN;
    drawText(ctx, multiplier, left + 18 + lw + gap, top + 13, {
      scale: multScale, color: colors, colorAt: big ? (i => PRISM[(i + Math.floor(time / 120)) % 5]) : undefined,
    });
  }

  function shakeAt(time: number) {
    if (reducedMotion) return 0;
    const hits: [number, number][] = zone === "pond" ? [[T.pond.land, 7]] : zone === "haystack" ? [[T.haystack.land, 6]] : zone === "rooftop" ? [[T.rooftop.land, 9], [T.rooftop.clonk, 5]]
      : zone === "cloud" ? [[T.cloud.land, 4]] : zone === "moon" ? [[T.moon.land, 6], [T.moon.title, 8]] : [];
    let offset = 0;
    for (const [at, amp] of hits) { const since = time - at; if (since >= 0 && since < 420) offset += amp * Math.exp(-since / 110) * Math.sin(since / 17); }
    return Math.round(offset);
  }

  // ------------------------------------------------------------------------------------------
  // World phase

  function renderWorld(time: number) {
    const cam = cameraAt(time);
    const pose = worldPose(time);
    drawSky(cam.y);
    drawStars(-cam.y * 0.08, clamp((-cam.y - 1500) / 700));
    // Day moon (far away: it barely moves).
    const moon = dayMoon(cam);
    ctx.save(); ctx.scale(A, A);
    drawMoonDisc(moon.x / A, moon.y / A, moon.r / A, darkness(cam.y) < 0.45);
    ctx.restore();
    // Far hills and clouds (parallax).
    const hillsTop = 480 - 60 * A + 30 - (cam.y - GROUND_CAM) * 0.3;
    if (hillsTop < H) {
      const ox = -((((cam.x - START_CAM_X) * 0.3) % W) + W) % W;
      for (const x of [ox, ox + W]) ctx.drawImage(art.hills, Math.round(x), Math.round(hillsTop), W, 60 * A);
      rect(ctx, 0, Math.round(hillsTop + 60 * A), W, H, SHADE);
    }
    art.far.forEach((sprite, i) => {
      const x = ((([150, 520, 830][i] - (cam.x - START_CAM_X) * 0.5 + time * 0.012 * (i + 1)) % 1500) + 1500) % 1500 - 250;
      const y = [120, 200, 70][i] - (cam.y - GROUND_CAM) * 0.5;
      if (y > -80 && y < H + 40) ctx.drawImage(sprite, Math.round(x), Math.round(y), sprite.width * A, sprite.height * A);
    });
    const shake = shakeAt(time);
    ctx.save();
    ctx.translate(-cam.x, -cam.y + shake);
    CLOUDS.forEach(([x, y], i) => {
      if (Math.abs(x - cam.x - W / 2) < 800 && y - cam.y > -120 && y - cam.y < H + 120) drawCloud(art.clouds[i], x, y);
    });
    ctx.drawImage(art.land, LAND.x0, LAND.y0, LAND.w * A, LAND.h * A);
    drawWindow(time);
    drawPond(time, pose);
    // Haystack (squashes on the dive).
    const hs = zone === "haystack" ? hayScale(time) : 1, hw = HAY.w * A * (1 + (1 - hs) * 0.6), hh = HAY.h * A * hs;
    ctx.drawImage(art.hay, Math.round(HAY.cx - hw / 2), Math.round(-hh), Math.round(hw), Math.round(hh));
    if (zone === "rooftop" && time >= T.rooftop.land) {
      // The hole the bonk left in the roof.
      const hx = Math.round(HIT_X / A) * A, hy = Math.round(roofY(HIT_X) / A) * A;
      rect(ctx, hx - 9, hy + 3, 21, 9, INK);
      rect(ctx, hx - 6, hy + 6, 15, 3, "#3A3A3A");
    }
    // Cloud nine with its pennant; it squashes under the landing.
    const dip = zone === "cloud" && time >= T.cloud.land ? bounceAt(time - T.cloud.land).dip : 0;
    const bob = zone === "cloud" && time > T.cloud.settle && !reducedMotion ? Math.round(Math.sin((time - T.cloud.settle) / 500) * 3) : 0;
    drawPennant(CLOUD9.cx - 30, CLOUD9.cy + CLOUD9.h * A / 2 - 6 + bob, time);
    drawCloud(art.cloud9, CLOUD9.cx, CLOUD9.cy + dip * 0.35 + bob, 1 + dip / 260, 1 - dip / 120);
    // The baby, and what flies with it.
    if (zone === "pond") drawDuck(time);
    if (time > 60 && time < plan.land) drawTrail(worldPose, time, darkness(cam.y) > 0.5 ? GRID : MUTED);
    const shown = zone === "cloud" && bob ? { ...pose, y: pose.y + bob, ay: (pose.ay ?? pose.y) + bob } : pose;
    drawBaby(shown, time);
    if (zone === "cloud" && time >= T.cloud.land) {
      // A tuft of fluff in front of its feet, so it sits in the cloud rather than on it.
      const fx0 = Math.round(CLOUD9.cx / A), fy = Math.round((CLOUD9_TOP + dip + bob) / A);
      ctx.save(); ctx.scale(A, A);
      for (const [dx, dy, r] of [[-16, 2, 5], [-6, 0, 6], [6, 1, 6], [16, 3, 4]] as const) ellipseBox(ctx, fx0 + dx, fy + dy, r, Math.max(3, r - 2), WHITE);
      rect(ctx, fx0 - 19, fy + 2, 38, 4, WHITE);
      ctx.restore();
    }
    drawGags(time, pose);
    fx.draw(ctx, "floor");
    fx.draw(ctx, "top");
    ctx.restore();
    drawWorldStamps(time, cam);
  }

  /** The slingshot in the dark window, its band still twanging, and the shutters the burst flung open. */
  function drawWindow(time: number) {
    const wx = HOUSE.x + HOUSE.win.x * A, wy = HOUSE.y + HOUSE.win.y * A, ww = HOUSE.win.w * A, wh = HOUSE.win.h * A;
    const settle = reducedMotion ? 0 : Math.exp(-time / 420);
    const cx = wx + ww / 2, base = wy + wh, fork = wy + 45;
    rect(ctx, cx - 6, fork + 12, 12, base - fork - 12, MUTED);
    for (let i = 0; i < 6; i++) { rect(ctx, cx - 6 - i * 6, fork + 12 - i * 6, 9, 9, MUTED); rect(ctx, cx - 3 + i * 6, fork + 12 - i * 6, 9, 9, MUTED); }
    const sag = Math.round(Math.sin(time / 28) * 24 * settle / A) * A;
    for (let i = 0; i <= 10; i++) {
      const k = i / 10, bend = Math.sin(k * Math.PI) * sag;
      rect(ctx, Math.round((cx - 36 + 72 * k) / A) * A, Math.round((fork - 24 + bend) / A) * A, A, A, GREEN);
    }
    for (const side of [-1, 1]) {
      const swing = Math.abs(Math.cos(Math.sin(time / 85 + (side > 0 ? 0.7 : 0)) * 1.3 * settle));
      const width = Math.max(A, Math.round(9 * swing) * A), hinge = side < 0 ? wx - 2 * A : wx + ww + 2 * A;
      const left = side < 0 ? hinge - width : hinge;
      rect(ctx, left, wy - 2 * A, width, wh + 4 * A, INK);
      if (width > 2 * A) {
        rect(ctx, left + A, wy - A, width - 2 * A, wh + 2 * A, GREEN);
        for (let j = wy + A; j < wy + wh; j += 3 * A) rect(ctx, left + A, j, width - 2 * A, A, MOSS);
      }
    }
  }

  function drawPond(time: number, pose: Pose) {
    // Surface glints drift along the water.
    const y = POND.surface, drift = reducedMotion ? 0 : Math.floor(time / 180);
    for (let i = 0; i < 13; i++) if ((i + drift) % 3) rect(ctx, Math.round((POND.x0 + 24 + i * 27) / A) * A, y + 3, 9, A, (i + drift) % 3 === 1 ? WHITE : GRID);
    if (zone !== "pond" || time < T.pond.land) return;
    const since = time - T.pond.land, x0 = STALL.x + 8;
    // Ripple rings (flat on the water).
    for (let k = 0; k < 3; k++) {
      const age = (reducedMotion ? 900 : since) - k * 220;
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
    if (since < 340) {
      const k = since / 340, tall = Math.sin(k * Math.PI) * 160 * (1 - k * 0.3), wide = 84 + k * 70;
      for (let j = 0; j < tall; j += A) {
        const v = j / tall, rag = Math.round(Math.sin(j * 0.21 + since / 30) * 2) * A;
        const width = Math.round((wide * (1 - v * 0.55) + rag) / A) * A, left = Math.round((x0 - width / 2 + rag / 2) / A) * A;
        rect(ctx, left - A, y - j - A, width + 2 * A, A * 2, INK);
        rect(ctx, left, y - j, width, A, v > 0.2 && v < 0.8 && (j / A) % 7 === 3 ? GRID : WHITE);
      }
      for (let i = -2; i <= 2; i++) {
        const bx = Math.round((x0 + i * wide * 0.14) / A) * A, by = Math.round((y - tall - 6 + Math.abs(i) * 4 + (i % 2) * 6) / A) * A;
        if (tall > 20) { rect(ctx, bx - A, by - A, 12, 12, INK); rect(ctx, bx, by, 6, 6, WHITE); }
      }
    }
    if (since < 900) for (let i = 0; i < 18; i++) {
      const spread = (i - 8.5) / 8.5, vx = spread * 0.42, vy = -(0.6 + 0.35 * (1 - Math.abs(spread))) * (i % 3 ? 1 : 0.75);
      for (let tail = 0; tail < 3; tail++) {
        const age = since - tail * 24;
        if (age < 0) continue;
        const dx = vx * age, dy = vy * age + 0.0012 * age * age;
        if (dy > 0) continue;
        const size = tail ? A : A * 2;
        rect(ctx, Math.round((x0 + dx) / A) * A - A, Math.round((y + dy) / A) * A - A, size + A * 2, size + A * 2, INK);
        rect(ctx, Math.round((x0 + dx) / A) * A, Math.round((y + dy) / A) * A, size, size, tail ? GRID : WHITE);
      }
    }
    // Bubbles while it is under.
    if (time > T.pond.sink + 200 && time < T.pond.surface + 100) for (let i = 0; i < 3; i++) {
      const age = (time - T.pond.sink - 200 - i * 90) % 360;
      if (age < 0) continue;
      const bx = x0 - 14 + i * 14 + Math.sin(age / 50 + i) * 4, by = y + 30 - age * 0.12;
      if (by > y) { rect(ctx, Math.round(bx / A) * A - A, Math.round(by / A) * A - A, 9, 9, WHITE); rect(ctx, Math.round(bx / A) * A, Math.round(by / A) * A, A, A, WATER); }
    }
    // The spit: an arc of water from its mouth, straight onto the duck's head.
    if (time >= T.pond.spit) for (let i = 0; i < 12; i++) {
      const age = time - T.pond.spit - i * 24;
      if (age < 0) continue;
      const mx = pose.x + 12, my = y - 14, px = mx + 0.45 * age, py = my - 0.5 * age + 0.0016 * age * age;
      if (py > y || (px > DUCK_X - 20 && py > POND.surface - 52)) continue;
      rect(ctx, Math.round(px / A) * A - A, Math.round(py / A) * A - A, 12, 12, INK);
      rect(ctx, Math.round(px / A) * A, Math.round(py / A) * A, 6, 6, i % 3 ? WHITE : GRID);
    }
  }

  /** The pond's duck pops up to see who dropped in, and gets spat at. */
  const DUCK_X = 480;
  function duckHitAt() { return T.pond.spit + 260; }
  function drawDuck(time: number) {
    if (time < T.pond.duck) return;
    const since = time - T.pond.duck, rise = easeOutBack(clamp(since / 260), 2.6);
    const hit = time - duckHitAt(), jolt = hit > 0 && hit < 300 ? Math.round(Math.sin(hit / 25) * 5 * (1 - hit / 300)) : 0;
    const bob = since > 260 && !reducedMotion ? Math.round(Math.sin(since / 260 + 1) * 3) : 0;
    const px = 6, w = DUCK.width * px, h = DUCK.height * px;
    const top = POND.surface + 6 - Math.round(lerp(-6, h - 12, rise)) + bob - (hit > 0 && hit < 200 ? 12 : 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(DUCK_X - 60, top - 40, 120, POND.surface + 3 - top + 40); ctx.clip();
    ctx.translate(DUCK_X + jolt + w / 2, top);
    ctx.scale(-1, 1);
    ctx.drawImage(DUCK, 0, 0, w, h);
    ctx.restore();
  }

  function drawPennant(x: number, y: number, time: number) {
    // Two strings down from cloud nine to its little multiplier flag.
    const sway = reducedMotion ? 0 : Math.round(Math.sin(time / 400) * 2) * A;
    const w = textWidth(multiplierText(20_000), 3) + 18;
    rect(ctx, x, y, A, 36, INK); rect(ctx, x + w - A, y, A, 36, INK);
    box(ctx, x - A + sway, y + 36, w + 6, 36, WHITE);
    rect(ctx, x - A + sway, y + 36, w + 6, A, INK); rect(ctx, x - A + sway, y + 69, w + 6, A, INK);
    rect(ctx, x - A + sway, y + 36, A, 36, INK); rect(ctx, x + w + sway, y + 36, A, 36, INK);
    drawText(ctx, multiplierText(20_000), x + 9 + sway, y + 44, { scale: 3, color: INK });
  }

  /** Per-zone props and effects drawn over the baby. */
  function drawGags(time: number, pose: Pose) {
    if (zone === "pond") {
      if (time >= T.pond.look && time < T.pond.drop) {
        const pop = time - T.pond.look < 60 ? 5 : 7;
        drawText(ctx, "!", pose.x + 10, pose.y - HALF - 20 - pop * 7, { scale: pop, color: INK, outline: WHITE });
        ctx.drawImage(DROP, Math.round((pose.x - 58) / A) * A, Math.round((pose.y - 40 + ((time - T.pond.look) / 25)) / A) * A, 18, 24);
      }
      if (time >= T.pond.duck + 80 && time < duckHitAt() - 120) drawText(ctx, "QUACK?", DUCK_X - 40, POND.surface - 118, { scale: 3, color: INK, outline: WHITE });
      const hit = time - duckHitAt();
      if (hit > 0 && hit < T.pond.end - duckHitAt() - 10) drawText(ctx, "QUACK!", DUCK_X - 30, POND.surface - 124 - Math.round(hit / 60), { scale: 4, color: INK, outline: WHITE });
    }
    if (zone === "haystack" && time >= T.haystack.land && pose.clip === "walk" && !reducedMotion) {
      // Kick lines either side of the flailing legs.
      const flick = Math.floor(time / 90) % 2, top = HAY_TOP * hayScale(time) - 10 * S;
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const x = Math.round((HAY.cx + side * (58 + i * 4 + flick * 6)) / A) * A, y = Math.round((top + 14 + i * 16) / A) * A;
        rect(ctx, side < 0 ? x - 12 : x, y, 12, A, INK);
      }
    }
    if (zone === "haystack" && time >= T.haystack.land && !reducedMotion) {
      // Straw bits drifting down after the poof.
      for (let i = 0; i < 9; i++) {
        const age = time - T.haystack.land - i * 60;
        if (age < 0 || age > 1500) continue;
        const x = HAY.cx + (i - 4) * 22 + Math.sin(age / 180 + i) * 14, y = HAY_TOP - 110 + ((i * 37) % 50) + age * 0.09;
        if (y > -6) continue;
        rect(ctx, Math.round(x / A) * A, Math.round(y / A) * A, i % 2 ? 9 : 3, i % 2 ? 3 : 9, i % 3 ? STRAW_DARK : STRAW);
      }
    }
    if (zone === "rooftop") {
      if (time >= T.rooftop.land && time < T.rooftop.clonk) {
        const tile = tileAt(time), q = ((tile.rot % 4) + 4) % 4;
        ctx.save(); ctx.translate(Math.round(tile.x), Math.round(tile.y));
        const [c, s] = TURN[q]; ctx.transform(c, s, -s, c, 0, 0);
        ctx.drawImage(TILE, -12, -8, 24, 15);
        ctx.restore();
      }
      if (time >= T.rooftop.clonk) {
        // Dizzy stars circling its head.
        const cx = pose.x, cy = edgeFeet - feet - headTop - 12;
        for (let i = 0; i < 3; i++) {
          const a = (reducedMotion ? 0.6 : time / 230) + (i * Math.PI * 2) / 3;
          ctx.drawImage(DIZZY, Math.round((cx + Math.cos(a) * 52 - 15) / A) * A, Math.round((cy + Math.sin(a) * 12 - 15) / A) * A, 30, 30);
        }
      }
    }
  }

  /** Onomatopoeia at the impact (world anchor, drawn in screen space so it stays inside the safe band). */
  function drawWorldStamps(time: number, cam: Point) {
    if (reducedMotion) return;
    const since = time - plan.land, at = (x: number, y: number) => [x - cam.x, y - cam.y] as const;
    if (zone === "pond") drawStamp(STAMP.pond, ...at(STALL.x + 8, -230), since, 6);
    if (zone === "haystack") drawStamp(STAMP.haystack, ...at(HAY.cx, HAY_TOP - 170), since, 6);
    if (zone === "rooftop") {
      drawStamp(STAMP.rooftop, ...at(HIT_X - 40, PEAK.y - 170), since, 6);
      drawStamp("CLONK!", ...at(EDGE_X + 60, edgeFeet - BOX - 110), time - T.rooftop.clonk, 5, GREEN);
    }
    if (zone === "cloud") drawStamp(STAMP.cloud, ...at(CLOUD9.cx + 250, CLOUD9_TOP - 120), since, 6, GREEN);
  }

  // ------------------------------------------------------------------------------------------
  // Space phase (orbit, moon)

  function renderSpace(time: number) {
    rect(ctx, 0, 0, W, H, INK);
    const since = time - T.orbit.apex;
    const shift0 = -cameraAt(T.orbit.apex).y * 0.08;
    const drift = zone === "moon" && time < T.moon.land ? (time - T.orbit.apex) * 0.02 : zone === "moon" ? (T.moon.land - T.orbit.apex) * 0.02 : 0;
    drawStars(shift0 + 240 * (1 - Math.exp(-since / 700)) + drift, 1);
    const shake = shakeAt(time);
    ctx.save();
    ctx.translate(0, shake);
    const earth = earthAt(time), moon = moonAt(time), pose = spacePose(time);
    const ringAlpha = zone === "orbit" ? smooth((time - 2050) / 300) : smooth((time - 2050) / 300) * (1 - smooth((time - T.moon.leave - 400) / 500));
    // The Moon: small and far for an orbit, growing as the moon flight closes in.
    const moonFirst = zone !== "moon" || moon.r < 120;
    ctx.save(); ctx.scale(A, A);
    if (moonFirst) drawMoonDisc(moon.x / A, moon.y / A, moon.r / A, false);
    ctx.restore();
    const behind = zone === "orbit" && time >= T.orbit.land && Math.sin(orbitAngle(time)) < 0;
    drawOrbitRing(earth, "back", time, ringAlpha);
    if (behind) drawBaby(pose, time);
    ctx.save(); ctx.scale(A, A);
    drawEarth(earth.x / A, earth.y / A, earth.r / A, time);
    if (!moonFirst) drawMoonDisc(moon.x / A, moon.y / A, moon.r / A, false);
    ctx.restore();
    drawOrbitRing(earth, "front", time, ringAlpha);
    if (zone === "moon") drawMoonProps(time, pose);
    if (!behind) {
      if (since < 900) drawTrail(spacePose, time, GRID);
      drawBaby(pose, time);
    }
    if (zone === "moon" && time >= T.moon.flag) drawFlag(time);
    fx.draw(ctx, "floor");
    fx.draw(ctx, "top");
    if (!reducedMotion) {
      if (zone === "orbit") drawStamp(STAMP.orbit, 250, 250, time - T.orbit.land, 6, GREEN);
      if (zone === "moon") drawStamp(STAMP.moon, MOON_TOP.x, 250, time - T.moon.land, 4, WHITE);
    }
    ctx.restore();
  }

  function drawMoonProps(time: number, pose: Pose) {
    if (time < T.moon.title) return;
    // Jackpot rays: dotted beams turning behind the baby.
    const since = time - T.moon.title, grow = reducedMotion ? 1 : easeOutCubic(clamp(since / 500));
    const cx = pose.x, cy = MOON_TOP.y - feet;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (reducedMotion ? 0 : time / 2400);
      for (let d = 70; d < 70 + 190 * grow; d += 15) {
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (y > MOON_TOP.y - 4) continue;
        rect(ctx, Math.round(x / A) * A, Math.round(y / A) * A, 6, 6, i % 2 ? "#FFE27A" : GREEN);
      }
    }
  }

  function drawFlag(time: number) {
    // The flag stabs into the ground next to the baby, then its cloth waves.
    const since = time - T.moon.flag, drop = reducedMotion ? 1 : easeInCubic(clamp(since / 140));
    const px = Math.round((MOON_TOP.x + 84) / A) * A, ground = MOON_TOP.y + 3;
    const top = Math.round(lerp(ground - 420, ground - 120, drop) / A) * A, foot = Math.min(ground, top + 120);
    rect(ctx, px - 3, top - 3, 9, foot - top + 3, INK);
    rect(ctx, px, top, 3, foot - top, WHITE);
    const unfurl = reducedMotion ? 1 : easeOutBack(clamp((since - 120) / 260), 1.6);
    const cols = Math.round(20 * unfurl);
    for (let i = 0; i < cols; i++) {
      const wave = reducedMotion ? 0 : Math.round(Math.sin(time / 120 - i * 0.5) * 1.2) * A;
      const x = px + 3 + i * A, y = top + wave;
      rect(ctx, x, y - 3, A, 42, INK);
      rect(ctx, x, y, A, 36, GREEN);
    }
    if (cols >= 18) {
      // A little heart on the cloth.
      const hx = px + 3 + 7 * A, hy = top + 3 * A + (reducedMotion ? 0 : Math.round(Math.sin(time / 120 - 3.5) * 1.2) * A);
      for (const [x, y, w] of [[0, 0, 2], [3, 0, 2], [0, 1, 5], [1, 2, 3], [2, 3, 1]] as const) rect(ctx, hx + x * A, hy + y * A, w * A, A, INK);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Frame

  const finalTime = plan.end;
  function render(time: number) {
    view.sync();
    view.begin(true);
    // Reduced motion: the landed frame simply fades in (element opacity, so no draw call can fight it).
    if (reducedMotion) canvas.style.opacity = time < 500 ? String(clamp(time / 480)) : "";
    const shown = reducedMotion ? finalTime : time;
    if (space && shown >= T.orbit.apex) renderSpace(shown); else renderWorld(shown);
    drawTitle(shown);
    // The launch flash as it bursts out of the window, and the Moon jackpot flash.
    if (!reducedMotion && time < 90) { ctx.globalAlpha = 0.5 * (1 - time / 90); rect(ctx, 0, 0, W, H, WHITE); ctx.globalAlpha = 1; }
    if (!reducedMotion && zone === "moon" && time >= T.moon.title && time < T.moon.title + 220) {
      ctx.globalAlpha = 0.75 * (1 - (time - T.moon.title) / 220); rect(ctx, 0, 0, W, H, WHITE); ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Events on the timeline

  function events(previous: number, now: number) {
    const crossed = (at: number) => previous < at && now >= at;
    const every = (period: number) => now > plan.end && now < plan.end + IDLE_MS && Math.floor((previous - plan.end) / period) !== Math.floor((now - plan.end) / period);
    if (previous === 0) { beat("launch"); fx.ring(EXIT.x + 30, EXIT.y, 110, WHITE, 3, 320); fx.squares(EXIT.x + 60, EXIT.y, 5, [GREEN, WHITE], 220, INK, 500); }
    if (crossed(apexAt)) beat("apex");
    if (crossed(plan.land)) beat("land");
    switch (zone) {
      case "pond":
        if (crossed(T.pond.land)) fx.squares(STALL.x + 8, POND.surface - 6, 16, [WHITE, GRID], 230, INK, 560);
        if (crossed(T.pond.duck)) fx.squares(DUCK_X, POND.surface - 4, 6, [WHITE, GRID], 200, INK, 420);
        if (crossed(T.pond.surface)) fx.squares(STALL.x - 8, POND.surface - 6, 8, [WHITE, GRID], 220, INK, 450);
        if (crossed(duckHitAt())) fx.squares(DUCK_X - 10, POND.surface - 50, 8, [WHITE, GRID], 200, INK, 420);
        break;
      case "haystack":
        if (crossed(T.haystack.land)) {
          fx.squares(HAY.cx, HAY_TOP + 10, 26, [STRAW, STRAW_DARK, PAPER], 420);
          fx.puff(HAY.cx, HAY_TOP + 12, 12, 60);
        }
        break;
      case "rooftop":
        if (crossed(T.rooftop.land)) { fx.squares(HIT_X, roofY(HIT_X), 12, [MUTED, INK, SHADE], 320); fx.sparkles(HIT_X, roofY(HIT_X) - 40, 5, 50, WHITE, 3, 20); }
        if (crossed(T.rooftop.bounce)) fx.dust(SEAT_X, roofY(SEAT_X), -1, 1.2);
        if (crossed(T.rooftop.edge)) fx.puff(EDGE_X, edgeFeet, 6, 30);
        if (crossed(T.rooftop.clonk)) { fx.squares(EDGE_X, edgeFeet - feet - headTop, 14, [MUTED, SHADE, INK], 300); fx.sparkles(EDGE_X, edgeFeet - feet - headTop - 10, 4, 40, GREEN, 3, 20); }
        break;
      case "cloud":
        if (crossed(T.cloud.land)) { fx.puff(CLOUD9.cx, CLOUD9_TOP + 20, 12, 70); fx.sparkles(CLOUD9.cx, CLOUD9_TOP - 40, 5, 70, GREEN, 3, 30); }
        if (crossed(T.cloud.settle)) fx.hearts(CLOUD9.cx, CLOUD9_TOP - BOX, 4, 50, 140);
        if (every(1500)) fx.hearts(CLOUD9.cx + 20, CLOUD9_TOP - BOX, 1, 30);
        break;
      case "orbit":
        if (crossed(T.orbit.land)) { const p = orbitPoint(Math.PI); fx.sparkles(p.x, p.y, 6, 70, GREEN, 3, 30); }
        if (every(ORBIT.period)) { const p = orbitPoint(Math.PI); fx.sparkles(p.x, p.y, 2, 30, WHITE, 3, 40); }
        break;
      case "moon": {
        const ground = MOON_TOP.y;
        if (crossed(T.moon.land)) { fx.puff(MOON_TOP.x, ground, 14, 50); fx.dust(MOON_TOP.x - 30, ground, 1, 1.4); fx.dust(MOON_TOP.x + 30, ground, -1, 1.4); }
        if (crossed(T.moon.flag)) fx.puff(MOON_TOP.x + 86, ground, 6, 24);
        if (crossed(T.moon.title)) {
          fx.confetti(MOON_TOP.x, ground - 160, [...PRISM, "#FFE27A"], 110, 1.3);
          fx.sparkles(MOON_TOP.x, ground - 80, 12, 200, "#FFE27A", 3, 40);
          fx.ring(MOON_TOP.x, ground - 70, 210, "#FFE27A", 6, 520);
          fx.ring(MOON_TOP.x, ground - 70, 140, WHITE, 4, 420, 90);
        }
        if (every(700)) fx.sparkles(MOON_TOP.x + (Math.random() - 0.5) * 300, ground - 60 - Math.random() * 200, 2, 30, Math.random() < 0.5 ? "#FFE27A" : GREEN, 3, 60);
        break;
      }
    }
    if (crossed(plan.end)) finish();
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
      if (previous === 0) beat("launch");
      if (t >= 500) { beat("land"); finish(); }
    } else events(previous, t);
    fx.update(dt);
  }

  function loop(now: number) {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    // The landed frame keeps animating gently (bobbing, kicking legs, orbiting) for IDLE_MS, lets the last particles
    // settle, then holds still under the result card; reduced motion stays still.
    const live = started && (reducedMotion ? t < 700 : t < plan.end + IDLE_MS || fx.count > 0);
    if (live) step(dt);
    if (live || dirty || view.sync()) { dirty = false; render(started ? t : 0); }
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
      fx.clear();
      if (!fired.has("land")) beat("land");
      fired.add("launch"); fired.add("apex");
      t = Math.max(t, reducedMotion ? 700 : plan.end + 1);
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
