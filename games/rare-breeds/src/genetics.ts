// Rare Breeds genetics: a Friend's 256 on-chain pixels are its DNA.
// A baby takes whole pixel rows from each parent. One row mask is used for all 64 frames (same clip,
// facing and frame index from each parent) so the walk cycle stays coherent. Every frame is then
// repaired into one 8-connected body, and the hatch tier adds a pattern and a shape mutation.
// Pure and deterministic (no SDK runtime import): shared by the game, node tests and dev tools.
import { FACINGS, FRAME_SIZE, type BreedInput, type BreedResult, type Clip, type Creature, type Facing, type Frame, type SpriteSheet, type TierId } from "./types.ts";
import { COLOSSUS, FAMILY_NAMES } from "./sprites.ts";
import { babyName } from "./names.ts";

const N = FRAME_SIZE, CELLS = N * N;
const CLIPS: readonly Clip[] = ["idle", "walk"];
/** A mixed frame must keep at least this much ink (absolute floor, see minInk). */
const MIN_INK = 12;
/** Row masks tried per baby; the best few that pass the hard checks compete on score. */
const MASK_TRIES = 64, MASK_FINALISTS = 16;

type Rows = readonly (0 | 1)[];
type Offset = readonly [dx: number, dy: number];

// ---------------------------------------------------------------------------------------------
// Seeds and randomness

/** 32-bit FNV-1a. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** Stable 32-bit breed seed from the player's Friend, both parent keys and the SDK play. */
export function breedSeed(friendId: bigint, aKey: string, bKey: string, playId: bigint): number {
  return fnv1a(`rare-breeds|${friendId}|${aKey}|${bKey}|${playId}`);
}

/** mulberry32 stream. `salt` keeps independent decisions of one seed (rows, pattern, mutation) uncorrelated. */
function stream(seed: number, salt: string) {
  let state = fnv1a(`${salt}:${seed >>> 0}`);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const shuffle = <T>(list: readonly T[]) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = int(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  return { next, int, shuffle, pick: <T>(list: readonly T[]) => list[int(list.length)] };
}
type Stream = ReturnType<typeof stream>;

// ---------------------------------------------------------------------------------------------
// Frame helpers (row-major 16 x 16, 1 = ink)

const mirrorIndex = (i: number) => i - 2 * (i % N) + N - 1;
const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
const inkOf = (frame: Frame) => { let sum = 0; for (let i = 0; i < CELLS; i++) sum += frame[i]; return sum; };

function mirrored(frame: Frame): Uint8Array {
  const out = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) out[i] = frame[mirrorIndex(i)];
  return out;
}
function isSymmetric(frame: Frame): boolean {
  for (let i = 0; i < CELLS; i++) if (frame[i] !== frame[mirrorIndex(i)]) return false;
  return true;
}
function sameFrame(a: Frame, b: Frame): boolean {
  for (let i = 0; i < CELLS; i++) if (a[i] !== b[i]) return false;
  return true;
}
function difference(a: Frame, b: Frame): number {
  let sum = 0;
  for (let i = 0; i < CELLS; i++) sum += a[i] ^ b[i];
  return sum;
}
/** Topmost ink row of a column, -1 if the column is empty. */
function topOf(frame: Frame, x: number): number {
  for (let y = 0; y < N; y++) if (frame[y * N + x]) return y;
  return -1;
}
/** Leftmost ink column of a row (the back of a right-facing sprite), -1 if the row is empty. */
function backOf(frame: Frame, y: number): number {
  for (let x = 0; x < N; x++) if (frame[y * N + x]) return x;
  return -1;
}

/** Precomputed 8-neighbourhoods; `diagonal` marks corner steps for the bridge tie-break. */
const NEIGHBOURS: number[][] = [], DIAGONAL: boolean[][] = [];
for (let i = 0; i < CELLS; i++) {
  const x = i % N, y = (i / N) | 0, list: number[] = [], corner: boolean[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && inBounds(x + dx, y + dy)) { list.push((y + dy) * N + x + dx); corner.push(dx !== 0 && dy !== 0); }
  }
  NEIGHBOURS.push(list); DIAGONAL.push(corner);
}

/** 8-connected components: labels[i] is 1..count for ink, 0 for paper; sizes[label]. */
function components(frame: Frame) {
  const labels = new Int16Array(CELLS), sizes = [0], stack: number[] = [];
  for (let i = 0; i < CELLS; i++) if (frame[i] && !labels[i]) {
    const id = sizes.length;
    let size = 0;
    labels[i] = id; stack.push(i);
    while (stack.length) {
      const cell = stack.pop()!;
      size++;
      for (const next of NEIGHBOURS[cell]) if (frame[next] && !labels[next]) { labels[next] = id; stack.push(next); }
    }
    sizes.push(size);
  }
  return { labels, sizes, count: sizes.length - 1 };
}

// Tiny binary heap of (cost * 256 + cell) keys for the bridge search.
function heapPush(heap: number[], key: number) {
  let i = heap.push(key) - 1;
  while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent] <= key) break; heap[i] = heap[parent]; i = parent; }
  heap[i] = key;
}
function heapPop(heap: number[]): number {
  const top = heap[0], last = heap.pop()!;
  if (heap.length) {
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= heap.length) break;
      if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
      if (heap[child] >= last) break;
      heap[i] = heap[child]; i = child;
    }
    heap[i] = last;
  }
  return top;
}

/**
 * Cheapest chain of paper cells joining the largest part to any other part. Pixel count dominates the
 * cost; ties prefer cells that hug existing ink (bridges read as necks, not sticks) and straight steps.
 */
function cheapestBridge(frame: Frame, labels: Int16Array, main: number): number[] {
  const cost = new Int32Array(CELLS).fill(0x7fffffff), from = new Int16Array(CELLS).fill(-1), heap: number[] = [];
  const stepCost = (cell: number, diagonal: boolean) => {
    let hug = 0;
    for (const next of NEIGHBOURS[cell]) hug += frame[next];
    return 256 + (8 - hug) * 2 + (diagonal ? 1 : 0);
  };
  for (let i = 0; i < CELLS; i++) if (labels[i] === main) {
    NEIGHBOURS[i].forEach((next, k) => {
      if (frame[next]) return;
      const c = stepCost(next, DIAGONAL[i][k]);
      if (c < cost[next]) { cost[next] = c; from[next] = -1; heapPush(heap, c * 256 + next); }
    });
  }
  while (heap.length) {
    const key = heapPop(heap), cell = key & 255, c = (key - cell) / 256;
    if (c !== cost[cell]) continue;
    if (NEIGHBOURS[cell].some(next => labels[next] && labels[next] !== main)) {
      const path: number[] = [];
      for (let at = cell; at >= 0; at = from[at]) path.push(at);
      return path;
    }
    NEIGHBOURS[cell].forEach((next, k) => {
      if (frame[next]) return;
      const nc = c + stepCost(next, DIAGONAL[cell][k]);
      if (nc < cost[next]) { cost[next] = nc; from[next] = cell; heapPush(heap, nc * 256 + next); }
    });
  }
  return [];
}

/**
 * Joins all ink into one 8-connected piece with the fewest added pixels. With `mirror`, each bridge is
 * mirrored (symmetric frames stay symmetric); a mirror that would itself float is dropped. Mutates.
 */
function connect(frame: Uint8Array, mirror: boolean): number {
  let added = 0;
  for (let guard = 0; guard < 64; guard++) {
    const { labels, sizes, count } = components(frame);
    if (count <= 1) break;
    let main = 1;
    for (let k = 2; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
    const path = cheapestBridge(frame, labels, main);
    if (!path.length) break;
    for (const cell of path) frame[cell] = 1;
    added += path.length;
    if (!mirror) continue;
    const echo = path.map(mirrorIndex).filter(cell => !frame[cell]);
    for (const cell of echo) frame[cell] = 1;
    if (components(frame).count >= count) for (const cell of echo) frame[cell] = 0;
    else added += echo.length;
  }
  return added;
}

/** Row crossover: row y comes from parent A (0) or B (1). */
function mix(a: Frame, b: Frame, rows: Rows): Uint8Array {
  const out = new Uint8Array(CELLS);
  for (let y = 0; y < N; y++) out.set((rows[y] ? b : a).subarray(y * N, y * N + N), y * N);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Parents

/** Side-walker gene: the creature has no front/back art, its down frames are its right frames. */
export function isSideWalker(creature: Creature): boolean {
  if (creature.familyId === COLOSSUS && creature.lineage === 0) return true;
  return CLIPS.every(clip => creature.sheet[clip].down.every((frame, i) => sameFrame(frame, creature.sheet[clip].right[i])));
}

const familyName = (creature: Creature) => FAMILY_NAMES[creature.familyId] ?? "Unknown";
const minInk = (a: Frame, b: Frame) => Math.max(MIN_INK, Math.round(0.4 * Math.min(inkOf(a), inkOf(b))));

/** Bridges in a front or back facing are mirrored when both parents look symmetric from there. */
function mirrorPolicy(a: SpriteSheet, b: SpriteSheet) {
  const facing = { down: false, up: false, left: false, right: false } as Record<Facing, boolean>;
  for (const f of ["down", "up"] as const) facing[f] = isSymmetric(a.idle[f][0]) && isSymmetric(b.idle[f][0]);
  return (clip: Clip, f: Facing, i: number) =>
    (f === "down" || f === "up") && (facing[f] || (isSymmetric(a[clip][f][i]) && isSymmetric(b[clip][f][i])));
}
type MirrorPolicy = ReturnType<typeof mirrorPolicy>;

// ---------------------------------------------------------------------------------------------
// Row mask

/** Alternating segments of 2 to 5 rows; both parents always end up with at least 4 rows. */
function randomRows(rand: Stream): (0 | 1)[] {
  const rows: (0 | 1)[] = [];
  let parent: 0 | 1 = rand.int(2) as 0 | 1;
  while (rows.length < N) {
    const left = N - rows.length;
    const length = rand.pick([2, 3, 4, 5].filter(len => len === left || (len < left && left - len >= 2)));
    for (let k = 0; k < length; k++) rows.push(parent);
    parent = parent ? 0 : 1;
  }
  return rows;
}

/** Ink extent of a row: [left, right], or null for an empty row. */
function span(frame: Frame, y: number): readonly [number, number] | null {
  let left = -1, right = -1;
  for (let x = 0; x < N; x++) if (frame[y * N + x]) { if (left < 0) left = x; right = x; }
  return left < 0 ? null : [left, right];
}

/**
 * Seams are the row boundaries where the parent switches. Each seam costs a little (big recognisable
 * parts beat zebra stripes) and a lot when the rows barely touch. Width steps are fine (a small head on a
 * big body is a body plan), but a band of at most three rows much wider than its neighbours reads as a
 * plank glued on: a Colossus back across a thin neck, or a brim on top.
 */
function seamCost(frame: Frame, rows: Rows): number {
  const widths = Array.from({ length: N }, (_, y) => { const s = span(frame, y); return s ? s[1] - s[0] + 1 : 0; });
  let cost = 0;
  for (let y = 0; y < N - 1; y++) {
    if (rows[y] === rows[y + 1]) continue;
    const upper = span(frame, y), lower = span(frame, y + 1);
    if (!upper || !lower) continue;
    const overlap = Math.min(upper[1], lower[1]) - Math.max(upper[0], lower[0]) + 1;
    cost += 2.5 + (overlap < 2 ? 4 : 0);
  }
  for (let start = 0; start < N;) {
    let end = start;
    while (end + 1 < N && rows[end + 1] === rows[start]) end++;
    const band = widths.slice(start, end + 1), widest = Math.max(...band);
    const above = start > 0 ? widths[start - 1] : 0, below = end < N - 1 ? widths[end + 1] : 0;
    if (band.filter(Boolean).length <= 3 && below) cost += Math.max(0, widest - Math.max(above, below) - 3) * 3;
    start = end + 1;
  }
  return cost;
}

/**
 * How good a baby this mask makes, judged on idle frame 0 of the main views. Hard checks: enough ink,
 * short bridges, visibly different from both parents. Score (lower is better): bridge pixels, balance
 * between parents, seam quality, and distinctness.
 */
function assessRows(a: SpriteSheet, b: SpriteSheet, rows: Rows, views: readonly Facing[], mirror: MirrorPolicy) {
  let ok = true, score = 0;
  for (const facing of views) {
    const fa = a.idle[facing][0], fb = b.idle[facing][0];
    const frame = mix(fa, fb, rows), total = inkOf(frame);
    // Balance by inked rows (recognisable parts) and, more mildly, by ink (a Colossus body is always heavy).
    let fromA = 0, rowsA = 0, rowsInk = 0;
    for (let i = 0; i < CELLS; i++) if (frame[i] && !rows[(i / N) | 0]) fromA++;
    for (let y = 0; y < N; y++) if (span(frame, y)) { rowsInk++; if (!rows[y]) rowsA++; }
    const share = total ? fromA / total : 0, rowShare = rowsInk ? rowsA / rowsInk : 0;
    if (total < minInk(fa, fb)) { ok = false; score += 60; }
    const seams = seamCost(frame, rows);
    const bridged = connect(frame, mirror("idle", facing, 0));
    if (bridged > 6) ok = false;
    const distinct = Math.min(difference(frame, fa), difference(frame, fb));
    if (distinct < 6) ok = false;
    score += bridged * 5 + Math.abs(rowShare - 0.5) * 12 + Math.abs(share - 0.5) * 8 + seams + Math.max(0, 12 - distinct);
  }
  return { ok, score };
}

/** Seeded candidate masks, best first. The caller builds with the first one whose sheet verifies. */
function rankRows(a: SpriteSheet, b: SpriteSheet, seed: number, sideWalker: boolean, mirror: MirrorPolicy): Rows[] {
  const rand = stream(seed, "rows"), seen = new Set<string>(), views: Facing[] = sideWalker ? ["right"] : ["down", "right"];
  const ranked: { rows: Rows; ok: boolean; score: number }[] = [];
  let finalists = 0;
  for (let attempt = 0; attempt < MASK_TRIES && finalists < MASK_FINALISTS; attempt++) {
    const rows = randomRows(rand), key = rows.join("");
    if (seen.has(key)) continue;
    seen.add(key);
    const result = assessRows(a, b, rows, views, mirror);
    if (result.ok) finalists++;
    ranked.push({ rows, ...result });
  }
  ranked.sort((p, q) => Number(q.ok) - Number(p.ok) || p.score - q.score);
  return ranked.map(entry => entry.rows);
}

// ---------------------------------------------------------------------------------------------
// Sheet building

/** 64 frames in registry order: clip (idle, walk) x facing (down, up, left, right) x frame 0-7. */
type Frames = Uint8Array[];
const slot = (clip: Clip, facing: Facing, i: number) => (clip === "idle" ? 0 : 32) + FACINGS.indexOf(facing) * 8 + i;

/**
 * Left frames are processed mirrored, as if they faced right, then mirrored back. Tie-breaks are then
 * mirror-equivariant: a baby's left frames stay the mirror image of its right frames when its parents' do.
 */
function asRight(facing: Facing, frame: Uint8Array, work: (frame: Uint8Array) => void): Uint8Array {
  if (facing !== "left") { work(frame); return frame; }
  const flipped = mirrored(frame);
  work(flipped);
  return mirrored(flipped);
}

function buildBody(a: SpriteSheet, b: SpriteSheet, rows: Rows, sideWalker: boolean, mirror: MirrorPolicy): Frames | null {
  const frames: Frames = new Array(64);
  for (const clip of CLIPS) for (const facing of FACINGS) {
    if (sideWalker && (facing === "down" || facing === "up")) continue;
    for (let i = 0; i < 8; i++) {
      const fa = a[clip][facing][i], fb = b[clip][facing][i];
      const frame = asRight(facing, mix(fa, fb, rows), f => connect(f, mirror(clip, facing, i)));
      if (inkOf(frame) < minInk(fa, fb)) return null;
      frames[slot(clip, facing, i)] = frame;
    }
  }
  if (sideWalker) shareSideFrames(frames);
  return frames;
}

/** Side-walkers reuse their own right-facing frames for down and up, like sheetFromFrames does. */
function shareSideFrames(frames: Frames) {
  for (const clip of CLIPS) for (let i = 0; i < 8; i++) {
    frames[slot(clip, "down", i)] = frames[slot(clip, "right", i)];
    frames[slot(clip, "up", i)] = frames[slot(clip, "right", i)];
  }
}

function toSheet(frames: Frames): SpriteSheet {
  const clip = (clipName: Clip) => Object.freeze(Object.fromEntries(FACINGS.map(facing =>
    [facing, Object.freeze(Array.from({ length: 8 }, (_, i) => frames[slot(clipName, facing, i)] as Frame))])) as Record<Facing, readonly Frame[]>);
  return Object.freeze({ idle: clip("idle"), walk: clip("walk") });
}

// ---------------------------------------------------------------------------------------------
// Shape mutations. A mutation is a set of pieces measured once on each facing's idle frame 0. Every piece
// is anchored to the body (a column's top, or a row's back edge) and follows that anchor per frame, so
// antennae bob with the head and a tail follows the rump through the walk cycle.

type HeadKind = "antennae" | "horns" | "ears" | "crest";
const HEAD_KINDS: readonly HeadKind[] = ["antennae", "horns", "ears", "crest"];
const HEAD_LABEL: Record<HeadKind, readonly [normal: string, bold: string]> = {
  antennae: ["Antennae", "Long Antennae"], horns: ["Horns", "Big Horns"], ears: ["Ears", "Bunny Ears"], crest: ["Crest", "Mohawk"],
};

type Stamp = readonly Offset[];
/**
 * Stamps relative to the anchor pixel (dy < 0 is up), biggest first; index 0 is the bold prismatic
 * variant. Front stamps describe the left piece (dx < 0 points outward) and are mirrored for the right
 * one. Side stamps describe a right-facing sprite (dx > 0 points forward).
 */
const FRONT: Record<HeadKind, readonly Stamp[]> = {
  antennae: [[[0, -1], [0, -2], [-1, -3], [-1, -4], [-2, -4]], [[0, -1], [0, -2], [-1, -3]], [[0, -1], [-1, -2]]],
  horns: [[[-1, 0], [-1, -1], [-2, -1], [-2, -2], [-3, -3]], [[-1, -1], [-2, -2]], [[-1, 0], [-1, -1]]],
  ears: [[[0, -1], [0, -2], [0, -3], [1, -1], [1, -2], [0, -4]], [[0, -1], [1, -1], [0, -2]]],
  crest: [[[0, -1], [0, -2], [0, -3], [-1, -1], [-1, -2]], [[0, -1], [0, -2]], [[0, -1]]],
};
const SIDE: Record<HeadKind, readonly Stamp[]> = {
  antennae: [[[0, -1], [0, -2], [1, -3], [1, -4], [2, -4]], [[0, -1], [0, -2], [1, -3]], [[0, -1], [1, -2]]],
  horns: [[[-1, 0], [-1, -1], [-2, -1], [-2, -2], [-3, -3]], [[-1, -1], [-2, -2]], [[-1, 0], [-1, -1]]],
  ears: [[[0, -1], [0, -2], [0, -3], [-1, -1], [-1, -2], [0, -4]], [[0, -1], [-1, -1], [0, -2]]],
  crest: [[[0, -1], [0, -2], [0, -3], [-1, -1], [-1, -2], [1, -1]], [[0, -1], [0, -2], [-1, -1]], [[0, -1], [-1, -1]]],
};
const TAIL: readonly Stamp[] = [[[-1, 0], [-2, 0], [-3, -1], [-3, -2], [-2, -3]], [[-1, 0], [-2, -1], [-2, -2]]];

type Piece = Readonly<{ anchor: "top" | "back"; line: number; ref: number; offsets: Stamp }>;
const flipX = (stamp: Stamp): Stamp => stamp.map(([dx, dy]) => [-dx, dy] as const);
const topPiece = (frame: Frame, x: number, offsets: Stamp): Piece => ({ anchor: "top", line: x, ref: topOf(frame, x), offsets });

/** Where a piece lands in one frame: anchored to that frame's own silhouette. Null if it leaves the frame. */
function placePiece(frame: Frame, piece: Piece): number[] | null {
  const now = piece.anchor === "top" ? topOf(frame, piece.line) : backOf(frame, piece.line);
  const shift = now < 0 ? 0 : now - piece.ref;
  const cells: number[] = [];
  for (const [dx, dy] of piece.offsets) {
    const x = piece.anchor === "top" ? piece.line + dx : piece.ref + shift + dx;
    const y = piece.anchor === "top" ? piece.ref + shift + dy : piece.line + dy;
    if (!inBounds(x, y)) return null;
    cells.push(y * N + x);
  }
  return cells;
}

/** Front view: the head's top row over the central columns, and its left corner column. */
function frontHead(frame: Frame) {
  let top = N;
  for (let x = 4; x < N - 4; x++) { const t = topOf(frame, x); if (t >= 0) top = Math.min(top, t); }
  if (top === N) return null;
  let corner = -1;
  for (let x = 2; x <= 7 && corner < 0; x++) { const t = topOf(frame, x); if (t >= top && t <= top + 1) corner = x; }
  return { top, corner };
}

/**
 * Right-facing view: head candidates, highest column in the front half first (a sparkle or horn tip may
 * win but leave no room; the next peaks are real heads). A head is the run of columns level with its
 * peak, at most 6 wide.
 */
function sideHeads(frame: Frame) {
  let left = N, right = -1;
  for (let x = 0; x < N; x++) if (topOf(frame, x) >= 0) { left = Math.min(left, x); right = Math.max(right, x); }
  const peaks: number[] = [];
  for (let x = right; x >= left + Math.ceil(0.5 * (right - left)); x--) if (topOf(frame, x) >= 0) peaks.push(x);
  peaks.sort((p, q) => topOf(frame, p) - topOf(frame, q) || q - p);
  const heads: { back: number; front: number }[] = [];
  for (const peak of peaks) {
    const top = topOf(frame, peak), near = (x: number) => topOf(frame, x) >= top && topOf(frame, x) <= top + 1;
    let back = peak, front = peak;
    while (back - 1 >= left && peak - back < 4 && near(back - 1)) back--;
    while (front + 1 <= right && front - back < 5 && near(front + 1)) front++;
    if (!heads.some(head => head.back <= peak && peak <= head.front)) heads.push({ back, front });
    if (heads.length === 3) break;
  }
  return heads;
}

function headPieces(kind: HeadKind, stamp: Stamp, frame: Frame, head: Readonly<{ back: number; front: number }> | null): Piece[] {
  if (!head) {
    const front = frontHead(frame);
    if (!front) return [];
    const pair = (x: number) => [topPiece(frame, x, stamp), topPiece(frame, N - 1 - x, flipX(stamp))];
    if (kind === "crest") return pair(7);
    if (kind === "antennae") {
      for (const x of [5, 6, 4]) if (topOf(frame, x) >= 0 && topOf(frame, x) <= front.top + 2) return pair(x);
      return [];
    }
    return front.corner < 0 ? [] : pair(front.corner);
  }
  const { back, front } = head, width = front - back + 1;
  if (kind === "crest") return [topPiece(frame, Math.round((back + front) / 2), stamp)];
  if (kind === "antennae") {
    const x = back + Math.round(0.6 * (width - 1));
    return width >= 4 ? [topPiece(frame, x, stamp), topPiece(frame, x - 2, stamp)] : [topPiece(frame, x, stamp)];
  }
  return width >= 3 ? [topPiece(frame, back, stamp), topPiece(frame, front, flipX(stamp))] : [topPiece(frame, back, stamp)];
}

/** Tail on the back of the rump of a right-facing view (the row that reaches furthest back). */
function tailPieces(stamp: Stamp, frame: Frame): Piece[] {
  let bottom = -1;
  for (let y = N - 1; y >= 0 && bottom < 0; y--) if (backOf(frame, y) >= 0) bottom = y;
  let row = -1;
  for (let y = bottom - 2; y >= Math.max(0, bottom - 6); y--) {
    const x = backOf(frame, y);
    if (x >= 0 && (row < 0 || x < backOf(frame, row))) row = y;
  }
  return row < 0 ? [] : [{ anchor: "back", line: row, ref: backOf(frame, row), offsets: stamp }];
}

/**
 * Pieces fit a facing when they stay inside the frame in all 16 frames of that facing and are fully
 * visible in the reference frame (every cell lands on paper, no two pieces overlap).
 */
function fits(pieces: readonly Piece[], frames: readonly Frame[]): boolean {
  if (!pieces.length || pieces.some(piece => piece.ref < 0)) return false;
  for (const frame of frames) for (const piece of pieces) if (!placePiece(frame, piece)) return false;
  const ref = frames[0], seen = new Set<number>();
  for (const piece of pieces) for (const cell of placePiece(ref, piece)!) {
    if (ref[cell] || seen.has(cell)) return false;
    seen.add(cell);
  }
  return true;
}

type FacingFrames = Readonly<{ facing: Facing; view: "front" | "side"; frames: Uint8Array[] }>;

/** The 16 frames of one facing (idle then walk); left frames are mirrored to face right. */
function facingFrames(frames: Frames, facing: Facing): FacingFrames {
  const list: Uint8Array[] = [];
  for (const clip of CLIPS) for (let i = 0; i < 8; i++) {
    const frame = frames[slot(clip, facing, i)];
    list.push(facing === "left" ? mirrored(frame) : frame);
  }
  return { facing, view: facing === "down" || facing === "up" ? "front" : "side", frames: list };
}

type MutationPlan = Readonly<{ labels: readonly string[]; pieces: Partial<Record<Facing, Piece[]>> }>;

/** Largest stamp variant of a kind that fits this facing (bold variants only for prismatic). */
function fitHead(kind: HeadKind, set: FacingFrames, bold: boolean) {
  const variants = (set.view === "front" ? FRONT : SIDE)[kind], ref = set.frames[0];
  const heads = set.view === "front" ? [null] : sideHeads(ref);
  for (const head of heads) for (let v = bold ? 0 : 1; v < variants.length; v++) {
    const pieces = headPieces(kind, variants[v], ref, head);
    if (fits(pieces, set.frames)) return { pieces, bold: v === 0 };
  }
  return null;
}

/**
 * Head mutation in seeded order: the first kind that fits every facing wins, else the first that fits the
 * main facing. Prismatic babies first look for a kind whose bold variant fits the main facing, and also
 * grow a tail; mutants fall back to a tail when no head kind fits.
 */
function planMutation(frames: Frames, seed: number, bold: boolean, sideWalker: boolean): MutationPlan {
  const rand = stream(seed, "mutation"), kinds = rand.shuffle(HEAD_KINDS);
  const sets = (sideWalker ? ["right", "left"] as const : ["down", "up", "right", "left"] as const).map(facing => facingFrames(frames, facing));
  type Choice = { kind: HeadKind; bold: boolean; pieces: Partial<Record<Facing, Piece[]>> };
  let chosen: Choice | null = null;
  for (const needBold of bold ? [true, false] : [false]) {
    let fallback: Choice | null = null;
    for (const kind of kinds) {
      const pieces: Partial<Record<Facing, Piece[]>> = {};
      let everywhere = true, big = false;
      for (const set of sets) {
        const fit = fitHead(kind, set, bold);
        if (!fit) { everywhere = false; continue; }
        pieces[set.facing] = fit.pieces;
        if (set === sets[0]) big = fit.bold;
      }
      if (!pieces[sets[0].facing] || (needBold && !big)) continue;
      if (everywhere) { chosen = { kind, bold: big, pieces }; break; }
      fallback ??= { kind, bold: big, pieces };
    }
    chosen ??= fallback;
    if (chosen) break;
  }
  const labels: string[] = [], pieces: Partial<Record<Facing, Piece[]>> = { ...chosen?.pieces };
  if (chosen) labels.push(HEAD_LABEL[chosen.kind][chosen.bold ? 1 : 0]);
  if (bold || !chosen) {
    let tailed = false;
    for (const set of sets) if (set.view === "side") for (const stamp of bold ? TAIL : TAIL.slice(1)) {
      const plan = tailPieces(stamp, set.frames[0]);
      if (fits(plan, set.frames)) { pieces[set.facing] = [...(pieces[set.facing] ?? []), ...plan]; tailed = true; break; }
    }
    if (tailed) labels.push("Tail");
  }
  return { labels, pieces };
}

/** Grow the planned pieces on every frame (then re-check connectivity); returns each frame's new cells. */
function applyMutation(frames: Frames, plan: MutationPlan, sideWalker: boolean, mirror: MirrorPolicy): Map<number, number[]> {
  const added = new Map<number, number[]>();
  for (const clip of CLIPS) for (const facing of FACINGS) {
    const pieces = plan.pieces[facing];
    if (!pieces) continue;
    for (let i = 0; i < 8; i++) {
      const index = slot(clip, facing, i), before = frames[index];
      const after = asRight(facing, before.slice(), frame => {
        for (const piece of pieces) for (const cell of placePiece(frame, piece) ?? []) frame[cell] = 1;
        connect(frame, mirror(clip, facing, i));
      });
      const gained: number[] = [];
      for (let c = 0; c < CELLS; c++) if (after[c] && !before[c]) gained.push(c);
      frames[index] = after;
      added.set(index, gained);
    }
  }
  if (sideWalker) {
    shareSideFrames(frames);
    for (const clip of CLIPS) for (let i = 0; i < 8; i++) {
      const gained = added.get(slot(clip, "right", i)) ?? [];
      added.set(slot(clip, "down", i), gained);
      added.set(slot(clip, "up", i), gained);
    }
  }
  return added;
}

// ---------------------------------------------------------------------------------------------
// Patterns. Dna.pattern is one sprite-space stencil for all 64 frames, so designs prefer calm cells (ink
// in every frame of a facing, with an unchanged neighbourhood) and stable rows (identical in every frame):
// such pattern pixels never slide against the body while it bobs or walks. Spots fall back to less calm
// cells on very animated bodies so that every patterned tier shows its pattern.

type PatternKind = "spots" | "stripes" | "patch";
const PATTERN_LABEL: Record<PatternKind, string> = { spots: "Spots", stripes: "Stripes", patch: "Patch" };

/**
 * Pattern ground for one facing. `calm`: ink in all 16 frames with an unchanged neighbourhood (never
 * slides). `steady`: ink in all 16 frames. `first`: ink of idle frame 0. Plus stable rows and the extent.
 */
type Ground = Readonly<{ calm: Uint8Array; steady: Uint8Array; first: Frame; rows: readonly boolean[]; top: number; bottom: number }>;

function ground(frames: Frames, facing: Facing): Ground {
  const list = CLIPS.flatMap(clip => Array.from({ length: 8 }, (_, i) => frames[slot(clip, facing, i)]));
  const first = list[0], calm = new Uint8Array(CELLS), steady = new Uint8Array(CELLS), rows: boolean[] = [];
  const same = (c: number) => list.every(frame => frame[c] === first[c]);
  for (let c = 0; c < CELLS; c++) {
    const x = c % N;
    steady[c] = Number(first[c] === 1 && same(c));
    calm[c] = Number(steady[c] === 1 && (c < N || same(c - N)) && (c >= CELLS - N || same(c + N))
      && (x === 0 || same(c - 1)) && (x === N - 1 || same(c + 1)));
  }
  for (let y = 0; y < N; y++) {
    let stable = true;
    for (let x = 0; x < N && stable; x++) stable = same(y * N + x);
    rows.push(stable);
  }
  let top = -1, bottom = -1;
  for (let c = 0; c < CELLS; c++) if (first[c]) { if (top < 0) top = (c / N) | 0; bottom = (c / N) | 0; }
  return { calm, steady, first, rows, top, bottom };
}

function symmetrise(stencil: Uint8Array): Uint8Array {
  for (let i = 0; i < CELLS; i++) if (stencil[i]) stencil[mirrorIndex(i)] = 1;
  return stencil;
}

/** Share of a frame's ink covered by a stencil. */
function coverage(stencil: Uint8Array, frame: Frame): number {
  let ink = 0, hit = 0;
  for (let i = 0; i < CELLS; i++) if (frame[i]) { ink++; hit += stencil[i]; }
  return ink ? hit / ink : 0;
}

/**
 * Symmetric spots, preferring 2 x 2 blocks on calm torso cells that also show from the side. Falls back
 * to steady cells, then to idle frame 0, so a body with any ink always gets its spots.
 */
function spotsStencil(front: Ground, side: Ground, rand: Stream, count: number): Uint8Array | null {
  const lower = (y: number) => front.top < 0 ? 0 : Math.max(0, (y - front.top) / Math.max(1, front.bottom - front.top));
  for (const cells of [front.calm, front.steady, front.first]) for (const size of [2, 1]) {
    const candidates: { x: number; y: number; score: number }[] = [];
    for (let y = 0; y <= N - size; y++) for (let x = 1; x <= 7; x++) {
      // A spot must not touch its own mirror, or the pair reads as one blob; 7-8 is one centred spot.
      if (size === 2 && x === 6 || size === 1 && x === 7) continue;
      const block = (size === 2 ? [0, 1, N, N + 1] : [0]).map(d => y * N + x + d);
      if (!block.every(c => cells[c] && front.first[mirrorIndex(c)])) continue;
      // Favour spots that both mirrored copies show from the side, sit inside the body, low on the torso.
      const shown = block.reduce((sum, c) => sum + side.steady[c] + side.steady[mirrorIndex(c)], 0) / (2 * block.length);
      const inside = block.every(c => [c - 1, c + 1, c - N, c + N].every(k => k >= 0 && k < CELLS && front.first[k])) ? 1 : 0;
      candidates.push({ x, y, score: shown * 3 + inside + lower(y) * 3 + rand.next() * 2 });
    }
    candidates.sort((p, q) => q.score - p.score);
    const stencil = new Uint8Array(CELLS), chosen: typeof candidates = [];
    for (const spot of candidates) {
      if (chosen.length >= count) break;
      if (chosen.some(other => Math.abs(other.x - spot.x) <= size && Math.abs(other.y - spot.y) <= size)) continue;
      chosen.push(spot);
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) stencil[(spot.y + dy) * N + spot.x + dx] = 1;
    }
    if (chosen.length >= Math.min(2, count)) return symmetrise(stencil);
  }
  return null;
}

/** Two or three horizontal bands on rows that are identical in every frame (so they never slide). */
function stripesStencil(front: Ground, side: Ground, rand: Stream, most: number): Uint8Array | null {
  const inkRow = (y: number) => front.first.subarray(y * N, y * N + N).some(Boolean);
  const rows = Array.from({ length: N }, (_, y) => y).filter(y => front.rows[y] && side.rows[y] && inkRow(y));
  const offset = rand.int(2), picked: number[] = [];
  for (const y of rows.slice(offset).concat(rows.slice(0, offset))) {
    if (picked.length < most && picked.every(other => Math.abs(other - y) >= 2)) picked.push(y);
  }
  if (picked.length < 2) return null;
  const stencil = new Uint8Array(CELLS);
  for (const y of picked) stencil.fill(1, y * N, y * N + N);
  return stencil;
}

/** A belly patch: a centred ellipse on the lower body, kept to calm cells. */
function patchStencil(front: Ground, rand: Stream): Uint8Array | null {
  if (front.top < 0) return null;
  const cy = front.top + 0.6 * (front.bottom - front.top), rx = 2.4 + rand.next(), ry = 1.6 + rand.next();
  const stencil = new Uint8Array(CELLS);
  let hits = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (((x - 7.5) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && front.calm[y * N + x]) { stencil[y * N + x] = 1; hits++; }
  }
  return hits >= 4 ? symmetrise(stencil) : null;
}

/**
 * The tier's stencil. Spotted and mutant get one design in the accent colour; prismatic turns the whole
 * body into rainbow and keeps a dark design as structure. Mutant and prismatic also light up grown cells.
 */
function makePattern(frames: Frames, tier: TierId, seed: number, sideWalker: boolean, mutated: Map<number, number[]>) {
  const stencil = new Uint8Array(CELLS);
  if (tier === "common") return { stencil, label: null };
  const rand = stream(seed, "pattern"), main: Facing = sideWalker ? "right" : "down";
  const front = ground(frames, main), side = ground(frames, "right");
  let label = "Rainbow";
  if (tier === "prismatic") {
    // Dark bands give the rainbow the most structure; the coat must still cover most of the body.
    stencil.fill(1);
    for (const dark of [stripesStencil(front, side, rand, 2), spotsStencil(front, side, rand, 3)]) {
      if (!dark) continue;
      const coat = dark.map(value => 1 - value);
      if (coverage(coat, front.first) >= 0.65) { stencil.set(coat); break; }
    }
  } else {
    const designs: Record<PatternKind, () => Uint8Array | null> = {
      spots: () => spotsStencil(front, side, rand, 2 + rand.int(2)), stripes: () => stripesStencil(front, side, rand, 3), patch: () => patchStencil(front, rand),
    };
    // Seeded favourite first; spots always succeed on a body with ink, so they close the list.
    const preferred = rand.pick(["spots", "stripes", "patch"] as const);
    for (const kind of [preferred, ...(["stripes", "patch", "spots"] as const).filter(kind => kind !== preferred)]) {
      const art = designs[kind]();
      if (art) { stencil.set(art); label = PATTERN_LABEL[kind]; break; }
    }
  }
  if (tier === "mutant" || tier === "prismatic") {
    // Grown cells glow in the tier accent, except where any frame has plain body ink.
    const grown = new Uint8Array(CELLS), body = new Uint8Array(CELLS);
    frames.forEach((frame, index) => {
      const own = new Set(mutated.get(index) ?? []);
      for (let c = 0; c < CELLS; c++) if (frame[c] && !own.has(c)) body[c] = 1;
      own.forEach(c => { grown[c] = 1; });
    });
    for (let c = 0; c < CELLS; c++) if (grown[c] && !body[c] && !body[mirrorIndex(c)]) stencil[c] = 1;
  }
  return { stencil: symmetrise(stencil), label };
}

// ---------------------------------------------------------------------------------------------
// Family label

/** "Cellular × Mask" -> ["Cellular", "Mask"] (the A and B side lines); null for a single family name. */
export function familySides(label: string): readonly [string, string] | null {
  const parts = label.split(/\s+[×x]\s+/).map(part => part.trim());
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

/** The family line of each of a parent's rows as the parent records it: one family, or its label's A and B sides. */
function rowLines(parent: Creature): readonly string[] {
  const rowSource = parent.lineage > 0 ? parent.dna?.rowSource : undefined;
  const sides = rowSource ? familySides(parent.family) : null;
  return Array.from({ length: N }, (_, y) => sides && rowSource ? sides[rowSource[y] ?? 0] : familyName(parent));
}

const rowInk = (frame: Frame, y: number) => { let sum = 0; for (let x = 0; x < N; x++) sum += frame[y * N + x]; return sum; };

/**
 * The baby's label "<A side> × <B side>". A side is named by a family line it really passes on: the lines of
 * the rows the baby takes from that parent, weighted by their ink (row count when those rows are empty),
 * heaviest first. Each side prefers a line the other side lacks, so two babies of one Friend give
 * "Mask × Sparkling" instead of "Cellular × Cellular"; when both sides carry the same lines and would show the
 * same name, the side whose other line weighs more shows that one. F1 stays "<family A> × <family B>".
 * Exact through F2; from F3 on, a baby parent's rows count as the lines its own label names
 * (legacy.ts traces every row to its real ancestor when a lookup is available).
 */
function familyLabel(a: Creature, b: Creature, rows: Rows, view: Facing): string {
  const ranked = [a, b].map((parent, side) => {
    const lines = rowLines(parent), frame = parent.sheet.idle[view][0];
    const mine = Array.from({ length: N }, (_, y) => y).filter(y => rows[y] === side);
    const inked = mine.some(y => rowInk(frame, y) > 0);
    const weights = new Map<string, number>();
    for (const y of mine) {
      const weight = inked ? rowInk(frame, y) : 1;
      if (weight) weights.set(lines[y], (weights.get(lines[y]) ?? 0) + weight);
    }
    // Map order is first appearance (top row first), which the stable sort keeps for equal weights.
    const list = [...weights].map(([name, weight]) => ({ name, weight })).sort((p, q) => q.weight - p.weight);
    return list.length ? list : [{ name: familyName(parent), weight: 0 }];
  });
  const carries = (side: number, name: string) => ranked[side].some(entry => entry.name === name);
  const names = ranked.map((list, side) => (list.find(entry => !carries(1 - side, entry.name)) ?? list[0]).name);
  if (names[0] === names[1]) {
    const other = ranked.map(list => list.find(entry => entry.name !== names[0]));
    const side = (other[0]?.weight ?? -1) > (other[1]?.weight ?? -1) ? 0 : 1;
    if (other[side]) names[side] = other[side].name;
  }
  return `${names[0]} × ${names[1]}`;
}

// ---------------------------------------------------------------------------------------------
// Breeding

/**
 * Breed a baby; deterministic for the same input. Pick the row mask (seeded candidates ranked on the main
 * views), mix all 64 frames and repair each into one body, grow the tier's mutation, then derive the
 * pattern stencil. Parents may be babies themselves (lineage > 0).
 */
export function breed(input: BreedInput): BreedResult {
  const { a, b, seed, tier } = input;
  const sideWalker = isSideWalker(a) || isSideWalker(b);
  const mirror = mirrorPolicy(a.sheet, b.sheet);
  let rows: Rows | null = null, frames: Frames | null = null;
  for (const candidate of rankRows(a.sheet, b.sheet, seed, sideWalker, mirror)) {
    frames = buildBody(a.sheet, b.sheet, candidate, sideWalker, mirror);
    if (frames) { rows = candidate; break; }
  }
  if (!rows || !frames) {
    // Degenerate parents (nearly empty art): fall back to a fixed half and half mask, no ink floor.
    rows = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];
    frames = fallbackBody(a.sheet, b.sheet, rows, sideWalker, mirror);
  }
  const traits: string[] = [];
  let mutated = new Map<number, number[]>();
  if (tier === "mutant" || tier === "prismatic") {
    const plan = planMutation(frames, seed, tier === "prismatic", sideWalker);
    mutated = applyMutation(frames, plan, sideWalker, mirror);
    traits.push(...plan.labels);
  }
  const { stencil, label } = makePattern(frames, tier, seed, sideWalker, mutated);
  if (label) traits.push(label);
  if (sideWalker) traits.push("Side-walker");
  const fromB = rows.reduce<number>((sum, row) => sum + row, 0);
  const dominant = fromB > N - fromB ? b : a;
  return Object.freeze({
    sheet: toSheet(frames),
    dna: Object.freeze({
      rowSource: Object.freeze(rows.slice()),
      pattern: stencil,
      mutations: Object.freeze(mutated.get(slot("idle", "down", 0)) ?? []),
      traits: Object.freeze(traits),
    }),
    name: babyName(seed),
    family: familyLabel(a, b, rows, sideWalker ? "right" : "down"),
    familyId: dominant.familyId,
    lineage: Math.max(a.lineage, b.lineage) + 1,
  });
}

/** Last resort for broken inputs: never returns an empty frame (a 2 x 2 blob stands in). */
function fallbackBody(a: SpriteSheet, b: SpriteSheet, rows: Rows, sideWalker: boolean, mirror: MirrorPolicy): Frames {
  const frames: Frames = new Array(64);
  for (const clip of CLIPS) for (const facing of FACINGS) for (let i = 0; i < 8; i++) {
    const fa = a[clip][facing][i], fb = b[clip][facing][i];
    let frame = asRight(facing, mix(fa, fb, rows), f => connect(f, mirror(clip, facing, i)));
    if (!inkOf(frame)) frame = (inkOf(fa) >= inkOf(fb) ? fa : fb).slice();
    if (!inkOf(frame)) for (const cell of [183, 184, 199, 200]) frame[cell] = 1;
    connect(frame, false);
    frames[slot(clip, facing, i)] = frame;
  }
  if (sideWalker) shareSideFrames(frames);
  return frames;
}
