import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { drawCreature } from "../draw.ts";
import { edgeLocks, isSideWalker, lockCount, lockOptions, lockOptionsReady, MASK_COUNT, NO_LOCKS, type LabEdge, type LabShape, type LockOptions } from "../genetics.ts";
import { FRAME_SIZE, PARENT_TINT, TIER_STYLE, type Creature, type Facing, type RowLock } from "../types.ts";
import { rowsLabel } from "./DnaTrio.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { cx, pixelMetrics, subscribeTick, useDevicePixelRatio, useReducedMotion, useRootSize } from "./shared.ts";

export type GeneLabProps = Readonly<{
  a: Creature;
  b: Creature;
  /** 16 entries: null (free), 0 (from Parent A) or 1 (from Parent B). */
  locks: readonly RowLock[];
  /** Stores a new lock set (one row or one shape at a time). Omit for a read-only lab, e.g. an egg already laid with these locks. */
  onChange?: (locks: readonly RowLock[]) => void;
  /** The cost line, e.g. "5 locks, 4 Hearts" (see lockCostLabel in src/hearts.ts), and a short note under it. */
  cost: string;
  costNote?: string;
  /** The cost line reads as a warning (not enough Hearts). */
  short?: boolean;
  reducedMotion?: boolean;
  /** Shown beside the bench at the bench's own scale, e.g. the dream child to compare rows with (DreamRows). */
  aside?: (grid: Readonly<{ device: number; css: number; facing: Facing; animate: boolean }>) => ReactNode;
}>;

/** Sprite box in sprite pixels: the 16 x 16 frame plus a one pixel halo on every side (as in DnaTrio). */
const BOX = FRAME_SIZE + 2;
const ROWS = Array.from({ length: FRAME_SIZE }, (_, row) => row);
const FRAME_MS = 110;
const PAPER = "#F4F1EA", RULE = "#E6E1D6", INK = "#111111";
/** Row bands behind locked rows: parent A's paper tint is invisible on paper, so it gets DnaTrio's darker paper band. */
const BAND: readonly [string, string] = ["#D6CFBF", "rgba(204, 255, 0, .62)"];
/** Free rows of the preview: both parents, faint. Rows locked away from a parent are washed out on its portrait. */
const FAINT = "rgba(17, 17, 17, .24)", WASH = "rgba(244, 241, 234, .74)";
/** A parent's passable shape cells (violet, like an inherited shape on the result card). */
const SHAPE_WASH = "rgba(138, 77, 255, .55)", SHAPE_HOT = TIER_STYLE.mutant.accent;

type Side = 0 | 1 | "baby";

/** While a pair's first lockOptions runs (after a paint): every row open, no shapes, nothing can be toggled yet. */
const PENDING: LockOptions = Object.freeze({ possible: 0, allowed: ROWS.map(() => [true, true] as const), shapes: [] });

/** After the next paint (a frame, then a task), so the frame that shows the lab or a new pair is painted first. */
function afterPaint(work: () => void) {
  let timer = 0;
  const frame = requestAnimationFrame(() => { timer = window.setTimeout(work, 0); });
  return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
}

/**
 * lockOptions without blocking a render: a pair's first call (assessing its 630 masks, tens of ms on a laptop, several
 * times that on slow phones) runs after a paint, null until then. Later lock sets of the pair only filter that report,
 * so they stay synchronous. `enabled` false skips it (null).
 */
export function useLockOptions(a: Creature | undefined, b: Creature | undefined, locks: readonly RowLock[], enabled = true): LockOptions | null {
  const [, setAssessed] = useState(0);
  const ready = enabled && !!a && !!b && lockOptionsReady(a, b);
  useEffect(() => {
    if (!enabled || !a || !b || lockOptionsReady(a, b)) return;
    return afterPaint(() => { lockOptions(a, b, NO_LOCKS); setAssessed(count => count + 1); });
  }, [a, b, enabled]);
  return useMemo(() => ready ? lockOptions(a!, b!, locks) : null, [ready, a, b, locks]);
}

/** Assesses a pair while the browser is idle (the Matchmaker's Parents tab), so its Gene Lab opens without a wait. */
export function usePrefetchLockOptions(a: Creature | undefined, b: Creature | undefined, enabled = true) {
  useEffect(() => {
    if (!enabled || !a || !b || lockOptionsReady(a, b)) return;
    const work = () => { if (!lockOptionsReady(a, b)) lockOptions(a, b, NO_LOCKS); };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(work, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const id = window.setTimeout(work, 400);
    return () => clearTimeout(id);
  }, [a, b, enabled]);
}

/** The edge shortcuts' places while a pair is being assessed (disabled, same labels, so nothing moves). */
const EDGE_PLACEHOLDERS: readonly LabEdge[] = (["top", "bottom"] as const).flatMap(edge => ([0, 1] as const).map(side => ({ edge, side, rows: [], lockable: false })));

/** Full name, plus "#77949" for a Friend on narrow benches (as in DnaTrio). */
function Name({ creature }: { creature: Creature }) {
  if (creature.tokenId === undefined) return <>{creature.name}</>;
  return <><span className="rb-long">{creature.name}</span><span className="rb-short">#{String(creature.tokenId)}</span></>;
}
const railWidth = (scale: number) => Math.max(16, scale * 3);
/** The grid's width at a scale; `gap` and `border` (both sides of a portrait) are read from style.css. */
const labWidth = (scale: number, gap: number, border: number) => 3 * (BOX * scale + border) + 2 * railWidth(scale) + 4 * gap;

/** One frame's cells of a parent's shape (walk frames are lists 8-15), for the facing shown. */
function shapeCells(parent: Creature, label: string, facing: Facing, frame: number) {
  return parent.dna?.shapes?.find(shape => shape.label === label)?.cells[facing]?.[8 + frame] ?? [];
}

/**
 * One portrait on the lab's 16 row grid: a parent (its rows locked to the other parent washed out, its own locked rows on a
 * band, its passable shapes violet) or the preview baby (locked rows solid from their parent, free rows both parents faint).
 */
function LabCanvas({ side, a, b, locks, shapes, hotShape, device, css, facing, animate, label }: {
  side: Side; a: Creature; b: Creature; locks: readonly RowLock[]; shapes: readonly LabShape[]; hotShape: LabShape | null;
  device: number; css: number; facing: Facing; animate: boolean; label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = BOX * device;
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    element.width = size;
    element.height = size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const line = Math.max(1, Math.round(device / 6));
    const cell = (index: number) => [(1 + index % FRAME_SIZE) * device, (1 + Math.floor(index / FRAME_SIZE)) * device] as const;
    const paint = (frame: number, time: number) => {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = RULE;
      for (let row = 0; row <= FRAME_SIZE; row++) ctx.fillRect(0, (1 + row) * device - (row === FRAME_SIZE ? line : 0), size, line);
      ROWS.forEach(row => {
        const lock = locks[row];
        if (lock === null || (side !== "baby" && side !== lock)) return;
        ctx.fillStyle = BAND[lock];
        ctx.fillRect(0, (1 + row) * device, size, device);
        // Parent A's band is paper on paper: an ink rule above and below each run of its rows keeps it visible.
        if (lock !== 0) return;
        ctx.fillStyle = INK;
        if (locks[row - 1] !== 0) ctx.fillRect(0, (1 + row) * device, size, line);
        if (locks[row + 1] !== 0) ctx.fillRect(0, (2 + row) * device - line, size, line);
      });
      if (side === "baby") {
        // The preview: whole rows copied in place, the same walk frame as both parents.
        const frames = [a.sheet.walk[facing][frame], b.sheet.walk[facing][frame]];
        for (let index = 0; index < FRAME_SIZE * FRAME_SIZE; index++) {
          const lock = locks[Math.floor(index / FRAME_SIZE)];
          const [x, y] = cell(index);
          if (lock !== null) {
            if (!frames[lock][index]) continue;
            ctx.fillStyle = INK;
            ctx.fillRect(x, y, device, device);
          } else for (const source of frames) if (source[index]) { ctx.fillStyle = FAINT; ctx.fillRect(x, y, device, device); }
        }
        // A shape whose rows are all locked to its parent is sure to pass on: violet, as on the result card.
        for (const shape of shapes) if (shape.rows.every(row => locks[row] === shape.side)) {
          ctx.fillStyle = shape === hotShape ? SHAPE_HOT : SHAPE_WASH;
          for (const index of shapeCells(shape.side ? b : a, shape.label, facing, frame)) { const [x, y] = cell(index); ctx.fillRect(x, y, device, device); }
        }
        return;
      }
      const parent = side ? b : a;
      drawCreature(ctx, parent, { clip: "walk", facing, frame, x: (FRAME_SIZE / 2 + 1) * device, y: (FRAME_SIZE + 1) * device, scale: device, time, accessory: null });
      for (const shape of shapes) if (shape.side === side) {
        ctx.fillStyle = shape === hotShape ? SHAPE_HOT : SHAPE_WASH;
        for (const index of shapeCells(parent, shape.label, facing, frame)) { const [x, y] = cell(index); ctx.fillRect(x, y, device, device); }
      }
      ctx.fillStyle = WASH;
      ROWS.forEach(row => { if (locks[row] !== null && locks[row] !== side) ctx.fillRect(0, (1 + row) * device, size, device); });
    };
    paint(0, 0);
    if (!animate) return;
    let last = -1, visible = true;
    const observer = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); });
    observer?.observe(element);
    const stop = subscribeTick(now => {
      if (!visible) return;
      const frame = Math.floor(now / FRAME_MS) % 8;
      if (frame === last) return;
      last = frame;
      paint(frame, now);
    });
    return () => { stop(); observer?.disconnect(); };
  }, [side, a, b, locks, shapes, hotShape, size, device, facing, animate]);
  return <canvas ref={canvas} className="rb-lab-canvas" style={{ width: BOX * css, height: BOX * css }} role="img" aria-label={label} />;
}

/**
 * The Gene Lab: Parent A, a rail of row locks, a preview of the baby, a rail, Parent B, on one 16 row grid. Press a row on
 * a parent (slide to adjust, release) to lock it to that parent; press it again to free it; the preview frees a row too.
 * Keyboard: Up and Down pick a row, Left locks it to Parent A, Right to Parent B, Space or Delete frees it. A toggle that
 * would leave no possible baby is disabled (lockOptions in src/genetics.ts). Edge shortcuts lock a parent's top or bottom
 * rows (edgeLocks), shape shortcuts all rows of a shape the pair can pass on. Rows are only 3 to 7 CSS px tall (4 or 5 on
 * phones), so on touch screens the 44 px shortcuts and the press-and-slide (the band and caption show the row under the
 * finger) are the main path; the rails suit mouse and keys. Where the lab scrolls (short landscape frames) a finger that
 * travels is a scroll, never a lock. A pair's first lockOptions runs after a paint (useLockOptions): nothing toggles until then.
 */
export function GeneLab({ a, b, locks, onChange, cost, costNote, short, reducedMotion, aside }: GeneLabProps) {
  const node = useRef<HTMLDivElement>(null), bench = useRef<HTMLElement>(null);
  const reduced = useReducedMotion(reducedMotion);
  const ratio = useDevicePixelRatio();
  const root = useRootSize(node);
  const [room, setRoom] = useState({ width: 0, gap: 6, border: 4 });
  const [cursor, setCursor] = useState<number | null>(null);
  // `startY` and `pan`: a touch on a surface that lets the panel scroll (touch-action pan-y) turns into a scroll once it travels.
  const [press, setPress] = useState<Readonly<{ side: Side; row: number; pointer: number; startY: number; pan: boolean }> | null>(null);
  const [message, setMessage] = useState("");
  // The shortcut under the pointer or focus, by key (the shortcut lists are rebuilt with every lock set).
  const [hotKey, setHotKey] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = bench.current;
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element), grid = element.firstElementChild;
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gap = grid ? parseFloat(getComputedStyle(grid).columnGap) || 0 : 6, border = 2 * (parseFloat(style.getPropertyValue("--rb-bw")) || 2);
      setRoom(current => current.width === width && current.gap === gap && current.border === border ? current : { width, gap, border });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const assessed = useLockOptions(a, b, locks);
  const ready = !!assessed, options = assessed ?? PENDING;
  const edges = useMemo(() => ready ? edgeLocks(a, b, locks) : null, [ready, a, b, locks]);
  const editable = !!onChange;
  const facing: Facing = isSideWalker(a) || isSideWalker(b) ? "right" : "down";
  // Wide frames put the shortcuts beside the bench, so the whole lab fits the 960 x 640 panel without scrolling.
  const heightCap = root.height >= 540 ? 7 : root.height >= 470 ? 6 : root.height >= 300 ? 4 : 3;
  let scale = heightCap;
  while (scale > 2 && room.width > 0 && labWidth(scale, room.gap, room.border) > room.width) scale--;
  const { device, css } = pixelMetrics(scale, ratio);
  const names = [a.name, b.name] as const;
  const count = lockCount(locks), fromA = locks.filter(lock => lock === 0).length, fromB = count - fromA;
  const shapes = options.shapes;
  const shapeKey = (shape: LabShape) => `${shape.side}:${shape.label}`;
  const edgeKey = (edge: LabEdge) => `edge:${edge.edge}:${edge.side}`;
  const hotShape = shapes.find(shape => shapeKey(shape) === hotKey) ?? null;
  const hotEdge = edges?.find(edge => edgeKey(edge) === hotKey) ?? null;
  const tag = (side: 0 | 1) => { const creature = side ? b : a; return creature.tokenId === undefined ? creature.name : `#${creature.tokenId}`; };

  const possibleText = ready ? `${options.possible} of ${MASK_COUNT} possible babies` : "Counting the possible babies";
  const status = (row: number) => locks[row] === null ? `Row ${row + 1} is free.` : `Row ${row + 1} is locked to ${names[locks[row]!]}.`;
  const describe = (row: number, side: Side) => {
    const lock = locks[row];
    if (!ready) return `Row ${row + 1}: one moment, the lab is reading this pair.`;
    if (side === "baby") return lock === null ? `Row ${row + 1} is free: the seed picks its parent.` : `Row ${row + 1}: release to free it.`;
    if (lock === side) return `Row ${row + 1} of ${names[side]}: release to free it.`;
    return options.allowed[row][side] ? `Row ${row + 1} of ${names[side]}: release to lock it.`
      : `Row ${row + 1} cannot come from ${names[side]} with these locks.`;
  };
  /** Press released (or a key): toggle the row on that side, when allowed. */
  const apply = (row: number, side: Side) => {
    setCursor(row);
    if (!onChange || !ready) { setMessage(status(row)); return; }
    const lock = locks[row];
    const target: RowLock = side === "baby" || lock === side ? null : side;
    if (target === lock) { setMessage(target === null ? `Row ${row + 1} is already free.` : `Row ${row + 1} is already locked to ${names[target]}.`); return; }
    if (target !== null && !options.allowed[row][target]) { setMessage(`Row ${row + 1} cannot come from ${names[target]} with these locks.`); return; }
    const next = locks.slice();
    next[row] = target;
    const after = lockOptions(a, b, next).possible;
    setMessage(target === null ? `Row ${row + 1} is free again. ${after} of ${MASK_COUNT} possible babies.`
      : `Row ${row + 1} locked to ${names[target]}. ${after} of ${MASK_COUNT} possible babies.`);
    onChange(next);
  };
  const setShape = (shape: LabShape) => {
    if (!onChange || !ready) return;
    const locked = shape.rows.every(row => locks[row] === shape.side);
    const next = locks.map((lock, row) => shape.rows.includes(row) ? (locked ? null : shape.side) : lock);
    setMessage(locked ? `${shape.label} rows are free again.` : `${rowsLabel(shape.rows)} locked to ${shape.name}: the baby will carry its ${shape.label}.`);
    onChange(next);
  };
  const setEdge = (edge: LabEdge) => {
    if (!onChange || !ready) return;
    const locked = edge.rows.every(row => locks[row] === edge.side);
    const next = locks.map((lock, row) => edge.rows.includes(row) ? (locked ? null : edge.side) : lock);
    const after = lockOptions(a, b, next).possible;
    setMessage(`${rowsLabel(edge.rows)} ${locked ? "free again" : `locked to ${names[edge.side]}`}. ${after} of ${MASK_COUNT} possible babies.`);
    onChange(next);
  };

  // Press, slide to adjust, release: the band shows which row a finger is on (rows are only a few pixels tall). Measured
  // from the surface's first row itself: a portrait has a border and a halo row above it, a rail its padding.
  const rowAt = (event: PointerEvent<HTMLElement>) => {
    const first = event.currentTarget.querySelector(".rb-lab-row, .rb-lab-cell") ?? event.currentTarget;
    const row = Math.floor((event.clientY - first.getBoundingClientRect().top) / css);
    return Math.max(0, Math.min(FRAME_SIZE - 1, row));
  };
  const surface = (side: Side) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Keep the slide on this surface; a synthetic pointer (assistive tech) cannot be captured and still taps.
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not an active pointer */ }
      const row = rowAt(event), pan = event.pointerType !== "mouse" && getComputedStyle(event.currentTarget).touchAction !== "none";
      setPress({ side, row, pointer: event.pointerId, startY: event.clientY, pan }); setCursor(row); setMessage(describe(row, side));
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!press || press.pointer !== event.pointerId) return;
      if (press.pan && Math.abs(event.clientY - press.startY) > 8) { setPress(null); setMessage(""); return; }
      const row = rowAt(event);
      if (row === press.row) return;
      setPress({ ...press, row }); setCursor(row); setMessage(describe(row, side));
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (!press || press.pointer !== event.pointerId) return;
      setPress(null);
      apply(press.row, press.side);
    },
    onPointerCancel: () => { setPress(null); setMessage(""); },
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const row = cursor ?? 0;
    let handled = true;
    const move = (next: number) => { setCursor(next); setMessage(status(next)); };
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
  };

  const rows = (side: Side) => <span className="rb-lab-rows" aria-hidden="true">
    {ROWS.map(row => <span key={row} className={cx("rb-lab-row", cursor === row && "rb-hot", press?.row === row && "rb-pressed",
      hotShape?.rows.includes(row) && (side === "baby" || side === hotShape.side) && "rb-shape-hot",
      hotEdge?.rows.includes(row) && (side === "baby" || side === hotEdge.side) && "rb-edge-hot")} />)}
  </span>;
  const rail = (side: 0 | 1) => <span className={`rb-lab-rail rb-lab-rail-${side ? "b" : "a"}`} aria-hidden="true" {...(editable ? surface(side) : {})}>
    {ROWS.map(row => <span key={row} className={cx("rb-lab-cell", locks[row] === side && "rb-on",
      editable && locks[row] !== side && !options.allowed[row][side] && "rb-no", cursor === row && "rb-hot")} />)}
  </span>;
  const slot = (side: Side) => <span className={cx("rb-lab-slot", `rb-lab-slot-${side === "baby" ? "baby" : side ? "b" : "a"}`)} {...(editable ? surface(side) : {})}>
    <LabCanvas side={side} a={a} b={b} locks={locks} shapes={shapes} hotShape={hotShape} device={device} css={css} facing={facing} animate={!reduced}
      label={side === "baby" ? `Preview: ${count} locked ${count === 1 ? "row" : "rows"}, the rest faint from both parents` : `${names[side]}, Parent ${side ? "B" : "A"}`} />
    {rows(side)}
  </span>;

  const style = { "--rb-px": `${css}px`, "--rb-box": `${BOX * css}px`, "--rb-rail": `${railWidth(scale)}px` } as CSSProperties;
  // Parent tints for the bench and the shortcuts' swatches.
  const tints = { "--rb-tint-a": PARENT_TINT[0], "--rb-tint-b": PARENT_TINT[1] } as CSSProperties;
  const summary = `Gene Lab. ${count ? `${count} ${count === 1 ? "row" : "rows"} locked: ${fromA} to ${names[0]}, ${fromB} to ${names[1]}` : "No rows locked"}. ${possibleText}.`
    + (editable ? ` Up and Down pick a row, Left locks it to ${names[0]}, Right to ${names[1]}, Space frees it.` : " These locks are set for the egg you laid.");

  const extra = aside?.({ device, css, facing, animate: !reduced });

  return <div ref={node} className={cx("rb-lab", !editable && "rb-lab-readonly")} style={tints}>
    <p className="rb-lab-lead"><strong>Pick which parent gives the eyes, ears or feet: lock their rows.</strong> <span>RF buys the roll, Hearts buy the genes.</span></p>
    <div className="rb-lab-main">
      <figure ref={bench} className={cx("rb-lab-bench", room.width === 0 && "rb-lab-measuring")} style={style} tabIndex={0} role="group" aria-label={summary}
        onKeyDown={onKeyDown} onBlur={() => { setCursor(null); setMessage(""); }}>
        <div className="rb-lab-grid">
          <span className="rb-lab-role rb-lab-role-a">Parent A</span>
          <span className="rb-lab-role rb-lab-role-baby">Baby</span>
          <span className="rb-lab-role rb-lab-role-b">Parent B</span>
          {slot(0)}
          {rail(0)}
          {slot("baby")}
          {rail(1)}
          {slot(1)}
          <span className="rb-lab-name rb-lab-name-a"><strong><Name creature={a} /></strong><span className="rb-lab-count"><i className="rb-lab-swatch rb-lab-swatch-a" />{fromA} locked</span></span>
          <span className="rb-lab-name rb-lab-name-baby"><strong className="rb-lab-possible">{ready ? options.possible : "..."}<span> of {MASK_COUNT}</span></strong><span className="rb-lab-count">possible babies</span></span>
          <span className="rb-lab-name rb-lab-name-b"><strong><Name creature={b} /></strong><span className="rb-lab-count"><i className="rb-lab-swatch rb-lab-swatch-b" />{fromB} locked</span></span>
        </div>
        <figcaption className="rb-lab-caption" aria-live="polite">{message
          || (!editable ? <span>Locked in for the egg you laid.</span>
            // A handful of near-twin pairs (14 of 5,256 pool pairs) give no baby distinct from both parents: nothing to lock.
            : ready && !options.possible ? <span>These two look too alike to design: every mix copies a parent. Try another mate.</span>
            : <span className="rb-lab-hint">Tap a row on a parent to lock it. Tap again to free it.</span>)}</figcaption>
      </figure>
      <div className={cx("rb-lab-side", !!extra && "rb-lab-side-aside")}>
        {extra}
        {editable && <div className="rb-lab-edges" aria-label="Row shortcuts">
          {(edges ?? EDGE_PLACEHOLDERS).map(edge => {
            const on = ready && edge.rows.every(row => locks[row] === edge.side), blocked = ready && !on && !edge.lockable;
            const hot = () => setHotKey(edgeKey(edge)), cold = () => setHotKey(null);
            const where = edge.edge === "top" ? "Top" : "Bottom";
            return <button key={edgeKey(edge)} type="button" className={cx("rb-button rb-button-ghost rb-lab-edge", `rb-lab-edge-${edge.side ? "b" : "a"}`, on && "rb-on")}
              aria-pressed={on} disabled={!ready || blocked} onClick={() => setEdge(edge)} onPointerEnter={hot} onPointerLeave={cold} onFocus={hot} onBlur={cold}
              aria-label={`${where} rows from ${names[edge.side]}${edge.rows.length ? `, ${rowsLabel(edge.rows).toLowerCase()}` : ""}${blocked ? ", not with these locks" : ""}`}>
              <i className={`rb-lab-swatch rb-lab-swatch-${edge.side ? "b" : "a"}`} aria-hidden="true" />
              <span><strong>{where} rows</strong><span>{blocked ? "blocked by locks" : `from ${tag(edge.side)}`}</span></span>
            </button>;
          })}
        </div>}
        {shapes.length > 0 && <div className="rb-lab-shapes" aria-label="Shape shortcuts">
          {shapes.map(shape => {
            const on = shape.rows.every(row => locks[row] === shape.side), blocked = !on && !shape.lockable;
            const hot = () => setHotKey(shapeKey(shape)), cold = () => setHotKey(null);
            return <button key={shapeKey(shape)} type="button" className={cx("rb-button rb-button-ghost rb-lab-shape", on && "rb-on")} aria-pressed={on}
              disabled={!editable || blocked} onClick={() => setShape(shape)} onPointerEnter={hot} onPointerLeave={cold} onFocus={hot} onBlur={cold}>
              <PixelIcon name={on ? "check" : "dna"} />
              <span>{on ? `${shape.label} from ${shape.name} locked` : `Lock ${shape.label} from ${shape.name}`}</span>
              <span className="rb-lab-shape-rows">{blocked ? "Not with these locks" : rowsLabel(shape.rows)}</span>
            </button>;
          })}
        </div>}
        <div className="rb-lab-foot">
          <p className={cx("rb-lab-cost", short && "rb-warn")}><strong>{cost}</strong>{costNote ? <span>{costNote}</span> : null}</p>
          {editable && <button type="button" className="rb-button rb-button-ghost rb-button-sm rb-lab-clear" disabled={!count} onClick={() => { onChange!(NO_LOCKS); setMessage("All rows are free again."); }}>
            <PixelIcon name="close" /><span>Free all<span className="rb-long"> rows</span></span></button>}
        </div>
      </div>
    </div>
  </div>;
}
