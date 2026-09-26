// Feet-box collision and grid pathing for the nursery (logical pixels).
import type { Rect } from "./room.ts";

export type Point = { x: number; y: number };

/** Feet box around the anchor: half width, and how far it reaches above / below the anchor. */
export type Foot = Readonly<{ half: number; up: number; down: number }>;
const FOOT: Foot = { half: 11, up: 9, down: 1 };
const CELL = 12;

/** `walk` bounds the anchor; `foot` is the box tested against obstacles (bigger creatures, bigger feet). */
export function createNavigator(walk: Rect, obstacles: readonly Rect[], foot: Foot = FOOT) {
  const [wx0, wy0, wx1, wy1] = walk;
  const blocked = (x: number, y: number) => {
    if (x < wx0 || x > wx1 || y < wy0 || y > wy1) return true;
    const fx0 = x - foot.half, fx1 = x + foot.half, fy0 = y - foot.up, fy1 = y + foot.down;
    for (const [x0, y0, x1, y1] of obstacles) if (fx1 > x0 && fx0 < x1 && fy1 > y0 && fy0 < y1) return true;
    return false;
  };

  const cols = Math.ceil((wx1 - wx0) / CELL) + 1, rows = Math.ceil((wy1 - wy0) / CELL) + 1;
  const cellX = (col: number) => Math.min(wx1, wx0 + col * CELL), cellY = (row: number) => Math.min(wy1, wy0 + row * CELL);
  const free = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) free[row * cols + col] = blocked(cellX(col), cellY(row)) ? 0 : 1;
  const toCell = (p: Point) => ({
    col: Math.max(0, Math.min(cols - 1, Math.round((p.x - wx0) / CELL))),
    row: Math.max(0, Math.min(rows - 1, Math.round((p.y - wy0) / CELL))),
  });

  const segmentClear = (a: Point, b: Point) => {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(distance / 4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (blocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  };

  /** Closest free point to p (p itself when it is free). */
  const nearestFree = (p: Point): Point | null => {
    if (!blocked(p.x, p.y)) return { x: p.x, y: p.y };
    const start = toCell(p);
    let best: Point | null = null, bestDistance = Infinity;
    for (let radius = 0; radius < Math.max(cols, rows); radius++) {
      for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const row = start.row + dr, col = start.col + dc;
        if (row < 0 || col < 0 || row >= rows || col >= cols || !free[row * cols + col]) continue;
        const candidate = { x: cellX(col), y: cellY(row) };
        const distance = Math.hypot(candidate.x - p.x, candidate.y - p.y);
        if (distance < bestDistance) { bestDistance = distance; best = candidate; }
      }
      if (best && radius > 1) break;
    }
    return best;
  };

  /** Waypoints from `from` to `to` (excluding the start), or null if unreachable. */
  const route = (from: Point, to: Point): Point[] | null => {
    const goal = nearestFree(to);
    if (!goal) return null;
    if (segmentClear(from, goal)) return [goal];
    const start = toCell(from), end = toCell(goal);
    const startIndex = start.row * cols + start.col, endIndex = end.row * cols + end.col;
    const g = new Float32Array(cols * rows).fill(Infinity);
    const parent = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const open: number[] = [startIndex];
    const f = new Float32Array(cols * rows).fill(Infinity);
    const h = (index: number) => Math.hypot((index % cols) - end.col, ((index / cols) | 0) - end.row);
    g[startIndex] = 0; f[startIndex] = h(startIndex);
    let found = false;
    while (open.length) {
      let bestAt = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bestAt]]) bestAt = i;
      const current = open.splice(bestAt, 1)[0];
      if (current === endIndex) { found = true; break; }
      closed[current] = 1;
      const col = current % cols, row = (current / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const next = nr * cols + nc;
        if (closed[next] || (!free[next] && next !== endIndex)) continue;
        if (dr && dc && (!free[row * cols + nc] || !free[nr * cols + col])) continue; // no corner cutting
        const cost = g[current] + (dr && dc ? Math.SQRT2 : 1);
        if (cost < g[next]) {
          g[next] = cost; f[next] = cost + h(next); parent[next] = current;
          if (!open.includes(next)) open.push(next);
        }
      }
    }
    if (!found) return null;
    const cells: Point[] = [];
    for (let at = endIndex; at !== -1 && at !== startIndex; at = parent[at]) cells.unshift({ x: cellX(at % cols), y: cellY((at / cols) | 0) });
    cells[cells.length - 1] = goal;
    // String pulling: skip waypoints that are directly visible.
    const path: Point[] = [];
    let anchor = from, index = 0;
    while (index < cells.length) {
      let far = index;
      for (let j = cells.length - 1; j > index; j--) if (segmentClear(anchor, cells[j])) { far = j; break; }
      path.push(cells[far]);
      anchor = cells[far];
      index = far + 1;
    }
    return path;
  };

  return { blocked, segmentClear, nearestFree, route };
}

export function pathLength(from: Point, path: readonly Point[]) {
  let total = 0, previous = from;
  for (const point of path) { total += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point; }
  return total;
}
