// Gene Lab bench for the DNA lab: Parent A, a rail of row locks, a ghost preview of the baby, a rail, Parent B, on one
// 16 row grid, as in the game's Matchmaker (src/ui/GeneLab.tsx). Press a row on a parent (slide to adjust, release) to
// lock it to that parent, press it again to free it; the preview frees a row too. Keys: Up and Down pick a row, Left
// locks it to Parent A, Right to Parent B, Space or Delete frees it. A toggle that would leave no possible baby is
// disabled (lockOptions in src/genetics.ts). Free here; in the game each locked row costs Hearts, never RF.
import { drawCreature } from "../../src/draw.ts";
import { isSideWalker, lockCount, lockOptions, MASK_COUNT, NO_LOCKS, type LockOptions } from "../../src/genetics.ts";
import { FRAME_SIZE, type Creature, type Facing, type RowLock } from "../../src/types.ts";
import { $, $$, pixelView, reducedMotion, shortId } from "./core.ts";

type Side = 0 | 1 | "baby";

/** Sprite box in sprite pixels: the 16 x 16 frame plus a one pixel halo on every side (as in the game's lab). */
const BOX = FRAME_SIZE + 2;
const ROWS = Array.from({ length: FRAME_SIZE }, (_, row) => row);
const FRAME_MS = 110;
/** Row bands behind locked rows (parent A's paper tint is invisible on paper, so it gets a darker paper band). */
const BAND: readonly [string, string] = ["#D6CFBF", "rgba(204, 255, 0, .62)"];
/** Rows locked away from a parent are washed out on its portrait. */
const WASH = "rgba(244, 241, 234, .74)";
/** Free rows of the preview: both parents, faint. */
const FAINT = 0.26;

/** "Rows 1-4, 14-16" (as rowsLabel in src/ui/DnaTrio.tsx). */
export function rowsLabel(rows: readonly number[]) {
  const runs: string[] = [];
  for (let k = 0; k < rows.length;) {
    let end = k;
    while (end + 1 < rows.length && rows[end + 1] === rows[end] + 1) end++;
    runs.push(end === k ? `${rows[k] + 1}` : `${rows[k] + 1}-${rows[end] + 1}`);
    k = end + 1;
  }
  return `${rows.length === 1 ? "Row" : "Rows"} ${runs.join(", ")}`;
}

export type GeneLab = Readonly<{
  /** Shows a new pair; a different pair starts with every row free. */
  setPair(a: Creature, b: Creature): void;
  /** The current 16 locks, for breed(). */
  locks(): readonly RowLock[];
  /** Paints the portraits (called from the lab's animation loop). */
  frame(now: number): void;
}>;

export function mountGeneLab(root: HTMLElement): GeneLab {
  const bench = $("#gl-bench", root);
  const caption = $(".gl-caption", root);
  const free = $<HTMLButtonElement>("#gl-free", root);
  const slots = $$<HTMLElement>(".gl-slot", root);
  const rails = $$<HTMLElement>(".gl-rail", root);
  const sideOf = (element: HTMLElement): Side => element.dataset.side === "baby" ? "baby" : Number(element.dataset.side) as 0 | 1;
  const views = slots.map(slot => ({ side: sideOf(slot), view: pixelView($<HTMLCanvasElement>("canvas", slot), BOX, BOX) }));
  const cells = rails.map(rail => ROWS.map(row => {
    const cell = document.createElement("span");
    cell.className = "gl-cell";
    cell.style.gridRow = String(row + 2);
    rail.append(cell);
    return cell;
  }));

  let a: Creature | null = null, b: Creature | null = null;
  let locks: readonly RowLock[] = NO_LOCKS, options: LockOptions | null = null;
  let cursor: number | null = null, press: Readonly<{ side: Side; row: number; pointer: number }> | null = null;
  let message = "", lastFrame = -1, dirty = true;

  const names = () => [shortId(a!.name), shortId(b!.name)] as const;
  const editable = () => !!options && options.possible > 0;
  const status = (row: number) => locks[row] === null ? `Row ${row + 1} is free.` : `Row ${row + 1} is locked to ${names()[locks[row]!]}.`;
  const describe = (row: number, side: Side) => {
    const lock = locks[row];
    if (side === "baby") return lock === null ? `Row ${row + 1} is free: the seed picks its parent.` : `Row ${row + 1}: release to free it.`;
    if (lock === side) return `Row ${row + 1} of ${names()[side]}: release to free it.`;
    return options?.allowed[row][side] ? `Row ${row + 1} of ${names()[side]}: release to lock it.`
      : `Row ${row + 1} cannot come from ${names()[side]} with these locks.`;
  };

  function render() {
    if (!a || !b) return;
    const [nameA, nameB] = names();
    const count = lockCount(locks), fromA = locks.filter(lock => lock === 0).length;
    rails.forEach((rail, i) => {
      const side = Number(rail.dataset.side) as 0 | 1;
      cells[i].forEach((cell, row) => {
        cell.classList.toggle("on", locks[row] === side);
        cell.classList.toggle("no", !!options && locks[row] !== side && !options.allowed[row][side]);
        cell.classList.toggle("hot", cursor === row);
      });
    });
    $(".gl-name-a", root).innerHTML = `<b>${nameA}</b><small><i class="gl-swatch gl-swatch-a"></i>${fromA} locked</small>`;
    $(".gl-name-b", root).innerHTML = `<b>${nameB}</b><small><i class="gl-swatch gl-swatch-b"></i>${count - fromA} locked</small>`;
    $(".gl-name-baby", root).innerHTML = options ? `<b>${options.possible}<span> of ${MASK_COUNT}</span></b><small>possible babies</small>` : "<b>-</b><small>possible babies</small>";
    root.style.setProperty("--gl-row", String(cursor ?? 0));
    root.classList.toggle("has-cursor", cursor !== null);
    free.disabled = !count;
    bench.setAttribute("aria-label", `Gene Lab. ${count ? `${count} ${count === 1 ? "row" : "rows"} locked: ${fromA} to ${nameA}, ${count - fromA} to ${nameB}` : "No rows locked"}. `
      + `${options?.possible ?? 0} of ${MASK_COUNT} possible babies. Up and Down pick a row, Left locks it to ${nameA}, Right to ${nameB}, Space frees it.`);
    caption.textContent = message || (a === b ? "A Friend cannot be both parents. Pick another one."
      : !options?.possible ? "These two look too alike to design: every mix copies a parent. Try another mate."
      : "Tap a row on a parent to lock it, tap it again to free it. On a phone, press and slide.");
    dirty = true;
  }

  function setLocks(next: readonly RowLock[]) {
    locks = next;
    options = a && b && a !== b ? lockOptions(a, b, locks) : null;
  }

  /** Press released (or a key): toggle the row on that side, when allowed. */
  function apply(row: number, side: Side) {
    if (!editable()) return;
    cursor = row;
    const lock = locks[row];
    const target: RowLock = side === "baby" || lock === side ? null : side;
    if (target === lock) message = target === null ? `Row ${row + 1} is already free.` : `Row ${row + 1} is already locked to ${names()[target]}.`;
    else if (target !== null && !options!.allowed[row][target]) message = `Row ${row + 1} cannot come from ${names()[target]} with these locks.`;
    else {
      const next = locks.slice();
      next[row] = target;
      setLocks(next);
      message = target === null ? `Row ${row + 1} is free again. ${options!.possible} of ${MASK_COUNT} possible babies.`
        : `Row ${row + 1} locked to ${names()[target]}. ${options!.possible} of ${MASK_COUNT} possible babies.`;
    }
    render();
  }

  // Press, slide to adjust, release: the band and the caption show which row a finger is on (rows are a few pixels tall).
  const rowAt = (event: PointerEvent, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.min(FRAME_SIZE - 1, Math.floor((event.clientY - box.top) / (box.height / BOX)) - 1));
  };
  for (const surface of [...slots, ...rails]) {
    const side = sideOf(surface);
    surface.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !editable()) return;
      event.preventDefault();
      // Keep the slide on this surface; a synthetic pointer (assistive tech) cannot be captured and still taps.
      try { surface.setPointerCapture(event.pointerId); } catch { /* not an active pointer */ }
      const row = rowAt(event, surface);
      press = { side, row, pointer: event.pointerId };
      cursor = row; message = describe(row, side);
      bench.focus({ preventScroll: true });
      render();
    });
    surface.addEventListener("pointermove", event => {
      if (!press || press.pointer !== event.pointerId) return;
      const row = rowAt(event, surface);
      if (row === press.row) return;
      press = { ...press, row };
      cursor = row; message = describe(row, side);
      render();
    });
    surface.addEventListener("pointerup", event => {
      if (!press || press.pointer !== event.pointerId) return;
      const { row } = press;
      press = null;
      apply(row, side);
    });
    surface.addEventListener("pointercancel", () => { press = null; message = ""; render(); });
  }

  bench.addEventListener("keydown", event => {
    if (!editable()) return;
    const row = cursor ?? 0;
    let handled = true;
    const move = (next: number) => { cursor = next; message = status(next); render(); };
    if (event.key === "ArrowDown") move(cursor === null ? 0 : Math.min(FRAME_SIZE - 1, row + 1));
    else if (event.key === "ArrowUp") move(cursor === null ? FRAME_SIZE - 1 : Math.max(0, row - 1));
    else if (event.key === "Home" || event.key === "End") move(event.key === "Home" ? 0 : FRAME_SIZE - 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // Left and Right choose the side; the row's own side again keeps it.
      const side = event.key === "ArrowLeft" ? 0 : 1;
      if (locks[row] === side) move(row); else apply(row, side);
    }
    else if (event.key === " " || event.key === "Delete" || event.key === "Backspace") apply(row, "baby");
    else handled = false;
    if (handled) event.preventDefault();
  });
  bench.addEventListener("blur", () => { if (press) return; cursor = null; message = ""; render(); });
  free.addEventListener("click", () => { setLocks(NO_LOCKS); cursor = null; message = "All rows are free again."; render(); });

  function paint(side: Side, view: ReturnType<typeof pixelView>, frame: number, now: number) {
    const ctx = view.ctx, facing: Facing = isSideWalker(a!) || isSideWalker(b!) ? "right" : "down";
    view.sync();
    view.begin(true);
    ROWS.forEach(row => {
      const lock = locks[row];
      if (lock === null || (side !== "baby" && side !== lock)) return;
      ctx.fillStyle = BAND[lock];
      ctx.fillRect(0, 1 + row, BOX, 1);
    });
    const draw = (creature: Creature, alpha = 1, halo: string | null = null) =>
      drawCreature(ctx, creature, { clip: "walk", facing, frame, x: BOX / 2, y: BOX - 1, scale: 1, time: now, alpha, halo, accessory: null });
    const within = (rows: readonly number[], work: () => void) => {
      if (!rows.length) return;
      ctx.save();
      ctx.beginPath();
      for (const row of rows) ctx.rect(0, 1 + row, BOX, 1);
      ctx.clip();
      work();
      ctx.restore();
    };
    if (side === "baby") {
      // The ghost: locked rows solid from their parent, free rows both parents faint, the same walk frame as both.
      within(ROWS.filter(row => locks[row] === 0), () => draw(a!));
      within(ROWS.filter(row => locks[row] === 1), () => draw(b!));
      within(ROWS.filter(row => locks[row] === null), () => { draw(a!, FAINT); draw(b!, FAINT); });
      return;
    }
    draw(side ? b! : a!, 1, "#ffffff");
    ctx.fillStyle = WASH;
    ROWS.forEach(row => { if (locks[row] !== null && locks[row] !== side) ctx.fillRect(0, 1 + row, BOX, 1); });
  }

  return Object.freeze({
    setPair(nextA: Creature, nextB: Creature) {
      if (nextA === a && nextB === b) return;
      a = nextA; b = nextB;
      cursor = null; message = "";
      setLocks(NO_LOCKS);
      render();
    },
    locks: () => locks,
    frame(now: number) {
      if (!a || !b) return;
      const frame = reducedMotion() ? 0 : Math.floor(now / FRAME_MS) % 8;
      const resized = views.map(({ view }) => view.sync()).some(Boolean);
      if (frame === lastFrame && !dirty && !resized) return;
      lastFrame = frame; dirty = false;
      for (const { side, view } of views) paint(side, view, frame, now);
    },
  });
}
