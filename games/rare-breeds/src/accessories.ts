// Cosmetic head accessories: pixel art that sits on each frame's own head, so it bobs with the walk.
// Catalog and API are the lead's contract. Pure and deterministic, cached per sheet, frame and item.
import type { AccessoryId, Clip, Facing, Frame, SpriteSheet } from "./types.ts";

export type AccessoryPixel = Readonly<{ x: number; y: number; color: string }>;
export type AccessoryInfo = Readonly<{ id: AccessoryId; name: string; price: number; blurb: string }>;

/** Ordered cheapest first. Prices are in Hearts (game points, never RF). */
export const ACCESSORIES: readonly AccessoryInfo[] = [
  { id: "party-hat", name: "Party hat", price: 20, blurb: "Every hatch is a party." },
  { id: "bow", name: "Bow", price: 20, blurb: "Tied with care." },
  { id: "flower", name: "Flower", price: 25, blurb: "Fresh from the nursery plants." },
  { id: "beanie", name: "Beanie", price: 35, blurb: "Cosy on cold chain days." },
  { id: "headphones", name: "Headphones", price: 50, blurb: "Lo-fi beats to hatch to." },
  { id: "top-hat", name: "Top hat", price: 80, blurb: "Very distinguished." },
  { id: "crown", name: "Crown", price: 150, blurb: "Royalty of the brood." },
  { id: "halo", name: "Halo", price: 250, blurb: "Pure, prismatic vibes." },
];

/** Accessory cells may leave the 16 x 16 box by this much: up to 8 rows above, 2 columns either side. */
export const ACCESSORY_BOUNDS = Object.freeze({ left: -2, right: 17, top: -8, bottom: 15 });

const N = 16;
const INK = "#111111", GREEN = "#CCFF00", GOLD = "#FFB800", PALE_GOLD = "#FFE27A", PINK = "#FF5FA2";

type View = "front" | "back" | "side";
type Cell = Readonly<{ x: number; y: number; color: string }>;
/** Pixel art rows, top to bottom: "." paper, "#" ink, "a" accent, "b" second accent. */
type Art = readonly string[];

// ---------------------------------------------------------------------------------------------
// Pixel art. Hats come in widths so they fit heads from 4 to 12 pixels wide; each is centred on the
// head and rests on it.

const HAT_ART: Record<"party-hat" | "beanie" | "top-hat" | "crown" | "halo", Record<number, Art>> = {
  "party-hat": {
    3: [".a.", ".#.", "###", "aaa"],
    4: [".aa.", ".##.", "#aa#", "aaaa"],
    5: ["..a..", "..#..", ".#a#.", ".###.", "aaaaa"],
    6: ["..aa..", "..##..", ".#aa#.", ".####.", "aaaaaa"],
  },
  beanie: {
    4: [".aa.", "####", "aaaa"],
    5: ["..a..", ".###.", "#####", "aaaaa"],
    6: ["..aa..", ".####.", "######", "aaaaaa"],
    7: ["...a...", ".#####.", "#######", "aaaaaaa"],
    8: ["...aa...", ".######.", "########", "aaaaaaaa"],
  },
  "top-hat": {
    4: [".##.", ".##.", ".aa.", "####"],
    5: [".###.", ".###.", ".aaa.", "#####"],
    6: [".####.", ".####.", ".aaaa.", "######"],
    7: [".#####.", ".#####.", ".aaaaa.", "#######"],
    8: ["..####..", "..####..", "..####..", "..aaaa..", "########"],
  },
  crown: {
    4: ["a..a", "aaaa", "a##a"],
    5: ["a.a.a", "aaaaa", "aa#aa"],
    6: ["a.aa.a", "aaaaaa", "aa##aa"],
    7: ["a..a..a", "aaaaaaa", "aaa#aaa"],
  },
  halo: {
    4: [".bb.", "a..a", ".aa."],
    5: [".bbb.", "a...a", ".aaa."],
    6: [".bbbb.", "a....a", ".aaaa."],
    7: [".bbbbb.", "a.....a", ".aaaaa."],
    8: ["..bbbb..", ".b....b.", "a......a", ".aaaaaa."],
  },
};
const HAT_COLORS: Record<keyof typeof HAT_ART, Readonly<Record<string, string>>> = {
  "party-hat": { a: GREEN }, beanie: { a: GREEN }, "top-hat": { a: GREEN }, crown: { a: GOLD }, halo: { a: GOLD, b: PALE_GOLD },
};
/** Preferred widths per item, relative to the head width, and the largest allowed. */
const HAT_FIT: Record<keyof typeof HAT_ART, Readonly<{ extra: number; min: number; max: number }>> = {
  "party-hat": { extra: -2, min: 3, max: 6 }, beanie: { extra: 0, min: 4, max: 8 }, "top-hat": { extra: 0, min: 4, max: 8 },
  crown: { extra: -1, min: 4, max: 7 }, halo: { extra: 0, min: 4, max: 8 },
};

/** Ornaments worn on a top corner of the head: a pink bow with an ink knot, a pink flower with a gold heart. */
const ORNAMENT_ART: Record<"bow" | "flower", Art> = {
  bow: ["a...a", "aa#aa", "a...a"],
  flower: [".a.", "aba", ".a."],
};

// ---------------------------------------------------------------------------------------------
// Head geometry

type Head = Readonly<{
  /** Row of the head's top run and its extent. */
  row: number; left: number; right: number;
  /** Per column: top of the head surface (ignoring 1-2 pixel protrusions), or N if none. */
  surface: readonly number[];
}>;

const inkAt = (frame: Frame, x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && frame[y * N + x] === 1;

/** Runs of ink in one row: [left, right] pairs. */
function runs(frame: Frame, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < N; x++) if (inkAt(frame, x, y) && !inkAt(frame, x - 1, y)) {
    let end = x;
    while (inkAt(frame, end + 1, y)) end++;
    out.push([x, end]);
  }
  return out;
}

/** The largest 8-connected part of a frame (sparkles and shadows around a body are not its head). */
function mainBody(frame: Frame): Frame {
  const label = new Int16Array(N * N), sizes = [0];
  for (let start = 0; start < N * N; start++) if (frame[start] && !label[start]) {
    const id = sizes.length, stack = [start];
    let size = 0;
    label[start] = id;
    while (stack.length) {
      const cell = stack.pop()!, x = cell % N, y = (cell / N) | 0;
      size++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const next = (y + dy) * N + x + dx;
        if (inkAt(frame, x + dx, y + dy) && !label[next]) { label[next] = id; stack.push(next); }
      }
    }
    sizes.push(size);
  }
  let main = 1;
  for (let k = 2; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
  return Uint8Array.from(label, value => Number(value === main));
}

/**
 * The head's top: the highest run of at least 3 pixels of the main body over the centre (front and back
 * views). Side views face right here and the head leads, so a run scores by height and by how close it
 * reaches to the front (a Colossus head sits lower than its back, a baby's head above a Colossus body).
 * Thinner bits above it (antennae, tufts, horn tips) are protrusions the accessory is worn under.
 */
function findHead(frame: Frame, view: View): Head | null {
  const body = mainBody(frame);
  let maxX = -1;
  for (let i = 0; i < N * N; i++) if (body[i]) maxX = Math.max(maxX, i % N);
  if (maxX < 0) return null;
  const surface = Array.from({ length: N }, () => N);
  for (let y = N - 1; y >= 0; y--) for (const [left, right] of runs(body, y)) {
    if (right - left >= 2) for (let x = left; x <= right; x++) surface[x] = y;
  }
  let best: Head | null = null, bestScore = Infinity;
  for (let y = 0; y < N; y++) for (const [left, right] of runs(body, y)) {
    if (right - left < 2) continue;
    if (view !== "side") { if (left <= 9 && right >= 6) return { row: y, left, right, surface }; continue; }
    // A flat back reads as one long run: only its front part (at most 7 columns) is the head.
    const score = y + 0.5 * (maxX - right);
    if (score < bestScore) { best = { row: y, left: Math.max(left, right - 6), right, surface }; bestScore = score; }
  }
  if (best) return best;
  // Nothing wide enough (tiny or broken art): use the topmost ink.
  for (let y = 0; y < N; y++) { const first = runs(body, y)[0]; if (first) return { row: y, left: first[0], right: first[1], surface }; }
  return null;
}

/** Topmost ink row over columns [from, to], protrusions included (N if none). */
function topOf(frame: Frame, from: number, to: number): number {
  for (let y = 0; y < N; y++) for (let x = Math.max(0, from); x <= Math.min(N - 1, to); x++) if (inkAt(frame, x, y)) return y;
  return N;
}

/** Highest surface point under columns [from, to]: the row a hat standing there rests on. */
function restOn(head: Head, from: number, to: number): number {
  let top = N;
  for (let x = Math.max(0, from); x <= Math.min(N - 1, to); x++) top = Math.min(top, head.surface[x]);
  return top === N ? head.row : top;
}

function paint(art: Art, colors: Readonly<Record<string, string>>, left: number, bottom: number): Cell[] {
  const cells: Cell[] = [];
  art.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      const key = line[c];
      if (key !== ".") cells.push({ x: left + c, y: bottom - (art.length - 1 - r), color: key === "#" ? INK : colors[key] });
    }
  });
  return cells;
}
const mirrorArt = (art: Art): Art => art.map(line => line.split("").reverse().join(""));

// ---------------------------------------------------------------------------------------------
// Layouts: where the accessory sits on a facing's reference frame (idle frame 0)

/** Chebyshev distance from painted cells to the nearest body ink (worn items touch: 1). */
function reach(frame: Frame, cells: readonly Cell[]): number {
  let best = Infinity;
  for (const cell of cells) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (inkAt(frame, cell.x + dx, cell.y + dy)) best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
  }
  return best;
}

/**
 * Hats: centred exactly on the head's top run (widths of the same parity only, so symmetric heads get
 * symmetric hats), as wide as fits without losing many cells under horns or ears, resting on the head.
 */
function hatLayout(id: keyof typeof HAT_ART, frame: Frame, head: Head): Cell[] {
  const fit = HAT_FIT[id], centre2 = head.left + head.right, width = head.right - head.left + 1;
  const wanted = Math.max(fit.min, Math.min(fit.max, width + fit.extra));
  const widths = Object.keys(HAT_ART[id]).map(Number).filter(w => (centre2 - w + 1) % 2 === 0).sort((p, q) => q - p);
  let best: Cell[] = [], bestCost = Infinity;
  for (const w of widths) {
    const left = (centre2 - w + 1) / 2, art = HAT_ART[id][w], top = topOf(frame, left, left + w - 1);
    // Worn on the head (thin protrusions poke through), or perched on them when that would hide too much
    // of the hat; perching costs more the higher it lifts. A halo floats one row clear of everything.
    const rest = restOn(head, left, left + w - 1);
    const options = id === "halo" ? [[top - 2, 0]] : [[rest - 1, 0], [top - 1, 6 + 2 * (rest - top)]];
    for (const [bottom, perched] of options) {
      let cells = paint(art, HAT_COLORS[id], left, bottom);
      // The halo must not touch anything (a horn or ear beside its footprint): lift it until clear.
      for (let lift = 1; id === "halo" && lift <= 3 && reach(frame, cells) < 2; lift++) cells = paint(art, HAT_COLORS[id], left, bottom - lift);
      // Cost: cells lost under protrusions, any difference from the wanted width, perching.
      const cost = cells.filter(cell => inkAt(frame, cell.x, cell.y)).length * 3 + Math.abs(wanted - w) + perched;
      if (cost < bestCost) { best = cells; bestCost = cost; }
    }
  }
  return best;
}

/**
 * Bow and flower: on a top corner of the head (the viewer's right in front, left from behind, the back of
 * the head from the side). Horns or ears in the way push the ornament towards the middle or on top.
 */
function ornamentLayout(id: "bow" | "flower", frame: Frame, head: Head, view: View): Cell[] {
  const base = ORNAMENT_ART[id], w = base[0].length, colors = { a: PINK, b: PALE_GOLD };
  const toRight = view !== "side" && (view === "front") !== (id === "flower");
  const art = view === "back" ? mirrorArt(base) : base;
  const preferred = toRight ? head.right - w + 2 : head.left - 1, inward = toRight ? -1 : 1;
  let best: Cell[] = [], bestCost = Infinity;
  for (let step = 0; step <= w; step++) {
    const left = preferred + inward * step;
    const rest = restOn(head, left, left + w - 1);
    for (const bottom of [rest - 1, rest, topOf(frame, left, left + w - 1) - 1]) {
      const cells = paint(art, colors, left, bottom);
      const cost = cells.filter(cell => inkAt(frame, cell.x, cell.y)).length * 4 + step + (reach(frame, cells) === 1 ? 0 : 20);
      if (cost < bestCost) { best = cells; bestCost = cost; }
    }
  }
  return best;
}

/**
 * Headphones: an ink band arching one row above the head (the white halo keeps it apart from the head),
 * green cups at ear height beside the head. From the side only the near cup shows, behind the head, moving
 * up beside the head's top corner when a neck is in the way; a cup with no free spot at all is left out.
 */
function headphonesLayout(frame: Frame, head: Head, view: View): Cell[] {
  // Band on the head; if antennae or sparkles swallow most of it, arch it over them instead.
  const worn = headphonesAt(frame, head, view, restOn(head, head.left, head.right));
  const shown = (cells: readonly Cell[]) => cells.filter(cell => !inkAt(frame, cell.x, cell.y)).length;
  if (shown(worn) >= worn.length * 0.7) return worn;
  const over = headphonesAt(frame, head, view, topOf(frame, head.left - 1, head.right + 1) + 1);
  return shown(over) > shown(worn) ? over : worn;
}

function headphonesAt(frame: Frame, head: Head, view: View, top: number): Cell[] {
  const cells: Cell[] = [];
  // Cups hang just outside the head near its top (never further than 2 columns from the head's top run).
  let leftEdge = head.left, rightEdge = head.right;
  for (let y = top; y <= top + 3; y++) for (const [l, r] of runs(frame, y)) {
    if (r < head.left - 1 || l > head.right + 1) continue;
    leftEdge = Math.min(leftEdge, Math.max(l, head.left - 2));
    rightEdge = Math.max(rightEdge, Math.min(r, head.right + 2));
  }
  const free = (xs: readonly number[], from: number) => xs.every(x => [from, from + 1, from + 2].every(y => !inkAt(frame, x, y)));
  const left = leftEdge - 1, right = view === "side" ? head.right + 1 : rightEdge + 1;
  // Cup rows: ear height, or (from the side, when a neck is in the way) up beside the head's top corner.
  const cupAt = (xs: readonly number[]) => [top + 1, ...(view === "side" ? [top, top - 1] : [])].find(y => free(xs, y)) ?? null;
  const leftCup = cupAt([left - 1, left]), rightCup = view === "side" ? null : cupAt([right, right + 1]);
  const from = leftCup !== null ? left : head.left - 1, to = rightCup !== null ? right : head.right + 1;
  for (let x = from + 1; x < to; x++) cells.push({ x, y: top - 2, color: INK });
  const hang = (x: number, xs: readonly number[], cup: number | null) => {
    cells.push({ x, y: top - 1, color: INK });
    if (cup === null) return;
    for (let y = top; y < cup; y++) cells.push({ x, y, color: INK });
    for (let y = cup; y <= cup + 2; y++) for (const cx of xs) cells.push({ x: cx, y, color: GREEN });
  };
  hang(from, [left - 1, left], leftCup);
  hang(to, [right, right + 1], rightCup);
  return cells;
}

function layout(id: AccessoryId, frame: Frame, head: Head, view: View): Cell[] {
  const cells = id === "bow" || id === "flower" ? ornamentLayout(id, frame, head, view)
    : id === "headphones" ? headphonesLayout(frame, head, view) : hatLayout(id, frame, head);
  // One colour per cell; later strokes (cups over connectors) win.
  return [...new Map(cells.map(cell => [`${cell.x},${cell.y}`, cell])).values()];
}

// ---------------------------------------------------------------------------------------------
// Per-frame anchoring

/**
 * How far this frame's head moved from the reference frame: the (dx, dy) that best matches the head
 * region of the main body (protrusions above the top run and a few rows below; sparkles around the body
 * are ignored). Ties prefer the smallest move, so still frames stay put.
 */
function headShift(refBody: Frame, body: Frame, head: Head): readonly [number, number] {
  let best: readonly [number, number] = [0, 0], bestScore = -Infinity;
  for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) {
    let score = 0;
    for (let y = head.row - 4; y <= head.row + 3; y++) for (let x = head.left - 1; x <= head.right + 1; x++) {
      const a = inkAt(refBody, x, y), b = inkAt(body, x + dx, y + dy);
      score += a && b ? 2 : a !== b ? -1 : 0;
    }
    score -= (Math.abs(dx) + Math.abs(dy)) * 0.1;
    if (score > bestScore) { bestScore = score; best = [dx, dy]; }
  }
  return best;
}

const mirrorFrame = (frame: Frame): Frame => {
  const out = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = frame[i - 2 * (i % N) + N - 1];
  return out;
};
const sameFrame = (a: Frame, b: Frame) => a === b || a.every((value, i) => value === b[i]);

/**
 * Keep the item worn in frames that are not a clean translation of the reference (row-mixed babies whose
 * protrusions come and go): starting from the head match, pick the vertical offset within 4 rows that
 * keeps the reference contact and loses no extra cells under ink, preferring the smallest correction.
 * Judged against the main body, so a drifting sparkle neither holds an item up nor pushes it away.
 */
function settle(cells: readonly Cell[], frame: Frame, dx: number, dy: number, contact: number, lost: number): number {
  let best = dy, bestCost = Infinity;
  for (let d = dy - 4; d <= dy + 4; d++) {
    const moved = cells.map(cell => ({ ...cell, x: cell.x + dx, y: cell.y + d }));
    const hidden = moved.filter(cell => inkAt(frame, cell.x, cell.y)).length, touch = reach(frame, moved);
    const cost = Math.abs(d - dy) + Math.max(0, hidden - lost) * 3 + Math.max(0, touch - contact) * 10;
    if (cost < bestCost) { best = d; bestCost = cost; }
  }
  return best;
}

type Placed = Readonly<{ cells: Cell[]; head: Head | null; refBody: Frame; contact: number; lost: number }>;
type SheetCache = { layouts: Map<string, Placed>; pixels: Map<string, readonly AccessoryPixel[]>; sideOnly: boolean };
const caches = new WeakMap<SpriteSheet, SheetCache>();

function cacheFor(sheet: SpriteSheet): SheetCache {
  let cache = caches.get(sheet);
  if (!cache) {
    // Side-walkers (Colossus and its babies) show their right-facing frames from every side.
    const sideOnly = sheet.idle.down.every((frame, i) => sameFrame(frame, sheet.idle.right[i]));
    cache = { layouts: new Map(), pixels: new Map(), sideOnly };
    caches.set(sheet, cache);
  }
  return cache;
}

/**
 * Pixels of an accessory for one animation frame, in sprite coordinates (0-15 is the sprite box;
 * y may go negative up to -8 above the head, x may extend 2 cells either side). Anchored to that
 * frame's own head so the accessory moves with the walk cycle. Never covers body ink.
 */
export function accessoryPixels(sheet: SpriteSheet, clip: Clip, facing: Facing, frame: number, id: AccessoryId): readonly AccessoryPixel[] {
  const index = frame & 7, cache = cacheFor(sheet), key = `${id}|${clip}|${facing}|${index}`;
  const hit = cache.pixels.get(key);
  if (hit) return hit;
  // Side views are worked out facing right; left is processed mirrored and mirrored back.
  const side = facing === "left" || facing === "right" || cache.sideOnly, flip = facing === "left";
  const source: Facing = side && !flip ? "right" : facing;
  const orient = (f: Frame) => flip ? mirrorFrame(f) : f;
  const view: View = side ? "side" : facing === "up" ? "back" : "front";
  const layoutKey = `${id}|${source}`;
  let placed = cache.layouts.get(layoutKey);
  if (!placed) {
    const ref = orient(sheet.idle[source][0]);
    const head = findHead(ref, view), cells = head ? layout(id, ref, head, view) : [];
    const refBody = mainBody(ref);
    placed = { cells, head, refBody, contact: reach(refBody, cells), lost: cells.filter(cell => inkAt(refBody, cell.x, cell.y)).length };
    cache.layouts.set(layoutKey, placed);
  }
  const current = orient(sheet[clip][source][index]), body = mainBody(current);
  const [dx, match] = placed.head ? headShift(placed.refBody, body, placed.head) : [0, 0];
  const dy = settle(placed.cells, body, dx, match, placed.contact, placed.lost);
  const out: AccessoryPixel[] = [];
  for (const cell of placed.cells) {
    const x = cell.x + dx, y = cell.y + dy;
    if (inkAt(current, x, y)) continue;
    const fx = flip ? N - 1 - x : x;
    if (fx < ACCESSORY_BOUNDS.left || fx > ACCESSORY_BOUNDS.right || y < ACCESSORY_BOUNDS.top || y > ACCESSORY_BOUNDS.bottom) continue;
    out.push(Object.freeze({ x: fx, y, color: cell.color }));
  }
  const result = Object.freeze(out);
  cache.pixels.set(key, result);
  return result;
}
