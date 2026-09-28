import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { drawCreature } from "../draw.ts";
import { isSideWalker, shapeRows } from "../genetics.ts";
import { rowPath, type CreatureLookup } from "../legacy.ts";
import { FRAME_SIZE, PARENT_TINT, TIER_STYLE, type Creature, type Facing } from "../types.ts";
/** Parent A's tint is paper white, invisible on the paper portraits: its row highlight there is a darker paper band. */
const A_ROW_ON_PAPER = "#D6CFBF";
/** Inherited shape cells on the baby's portrait: a violet wash over the ink, full violet while one of its rows is traced. */
const INHERIT_WASH = "rgba(138, 77, 255, .5)", INHERIT_HOT = TIER_STYLE.mutant.accent;
import { PixelIcon } from "./PixelIcon.tsx";
import { originLabel, RowPathNote, TRACE_HINT } from "./Provenance.tsx";
import { cx, pixelMetrics, subscribeTick, useDevicePixelRatio, useReducedMotion, useRootSize } from "./shared.ts";

export type DnaTrioProps = Readonly<{
  baby: Creature;
  parentA?: Creature | null;
  parentB?: Creature | null;
  /** Upper bound for the CSS pixels per sprite pixel. The trio picks the largest scale that fits its width. */
  maxScale?: number;
  /** Steps below that scale (never below 3), e.g. so a busy result card fits without scrolling. */
  shrink?: number;
  /** Rendered inside the baby's slot, e.g. confetti. */
  babyExtra?: ReactNode;
  /** Reveal: the baby lands with a squash. */
  reveal?: boolean;
  reducedMotion?: boolean;
  className?: string;
  /**
   * Resolves ancestor keys (e.g. the controller's `creature`). A traced baby row then shows its whole path down to the
   * real Friend it came from (src/legacy.ts rowPath), with that Friend's portrait when it is not a parent in view.
   */
  lookup?: CreatureLookup;
  /** Replaces the tap hint, lit up, e.g. a first-run tip. With `lookup` the plain hint is TRACE_HINT too, so both read the same. */
  hint?: string;
}>;

/** Sprite box in sprite pixels: the 16 x 16 frame plus a one pixel halo on every side. */
const BOX = FRAME_SIZE + 2;
const GAP = 6, BORDER = 4;
const ROWS = Array.from({ length: FRAME_SIZE }, (_, row) => row);
const FRAME_MS = 110;
const PAPER = "#F4F1EA", RULE = "#E6E1D6";

type Side = "a" | "baby" | "b";
type Active = Readonly<{ row: number; side: Side }>;

/**
 * Full name, plus "#77949" for a Friend on narrow trios. A column too narrow for "Friend #262837" (about 7 px a
 * character at 12 px) shows the whole token ID instead of a cut one.
 */
function Name({ creature, fallback, column }: { creature?: Creature | null; fallback: string; column: number }) {
  if (!creature) return <>{fallback}</>;
  if (creature.tokenId === undefined) return <>{creature.name}</>;
  if (creature.name.length * 7 > column) return <>#{String(creature.tokenId)}</>;
  return <><span className="rb-long">{creature.name}</span><span className="rb-short">#{String(creature.tokenId)}</span></>;
}

const linkWidth = (scale: number) => Math.max(14, scale * 3);
const trioWidth = (scale: number) => 3 * (BOX * scale + BORDER) + 2 * linkWidth(scale) + 4 * GAP;

export function mutatedRows(mutations: readonly number[]) {
  return [...new Set(mutations.map(index => Math.floor(index / FRAME_SIZE)))].filter(row => row >= 0 && row < FRAME_SIZE).sort((x, y) => x - y);
}

/** "Row 3", "Rows 12-14", "Rows 2-3, 5" (1-based, runs joined with a hyphen). */
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

/** A shape the baby inherited: its rows (any frame, any facing), the cells per walk frame of the facing shown, its caption. */
type InheritedShape = Readonly<{ rows: readonly number[]; cells: readonly (readonly number[])[]; label: string }>;

/**
 * One portrait on the shared 16 row grid, drawn without accessories so every row reads clearly.
 * `faded` rows (the ones the baby did not take) are washed out. All portraits step through the same
 * walk frame at the same time, so the baby's rows line up with its parents' on every frame.
 */
function RowSprite({ creature, device, css, facing, faded, highlight, marks, hotMark, animate, label }: {
  creature: Creature; device: number; css: number; facing: Facing; faded: readonly boolean[] | null;
  /** Row painted behind the sprite in a tint while it is being traced. */
  highlight: Readonly<{ row: number; color: string }> | null;
  /** Inherited shapes to tint on this portrait (the baby's), and the one whose row is traced. */
  marks?: readonly InheritedShape[]; hotMark?: InheritedShape | null; animate: boolean; label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = BOX * device;
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    element.width = size;
    element.height = size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const line = Math.max(1, Math.round(device / 6));
    const shimmer = creature.tier === "prismatic" && !!creature.dna?.pattern.some(Boolean);
    const paint = (frame: number, time: number) => {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, size, size);
      // Row ruling: the grid the three portraits share.
      ctx.fillStyle = RULE;
      for (let row = 0; row <= FRAME_SIZE; row++) ctx.fillRect(0, (1 + row) * device - (row === FRAME_SIZE ? line : 0), size, line);
      if (highlight) {
        ctx.fillStyle = highlight.color;
        ctx.fillRect(0, (1 + highlight.row) * device, size, device);
      }
      drawCreature(ctx, creature, { clip: "walk", facing, frame, x: (FRAME_SIZE / 2 + 1) * device, y: (FRAME_SIZE + 1) * device, scale: device, time, accessory: null });
      // The shape follows the walk: this frame's own cells (walk frames are lists 8-15).
      for (const mark of marks ?? []) {
        ctx.fillStyle = mark === hotMark ? INHERIT_HOT : INHERIT_WASH;
        for (const cell of mark.cells[8 + frame] ?? []) ctx.fillRect((1 + cell % FRAME_SIZE) * device, (1 + Math.floor(cell / FRAME_SIZE)) * device, device, device);
      }
      if (faded) {
        ctx.fillStyle = "rgba(244, 241, 234, .74)";
        faded.forEach((off, row) => { if (off) ctx.fillRect(0, (1 + row) * device, size, device); });
      }
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
      if (frame === last && !shimmer) return;
      last = frame;
      paint(frame, now);
    });
    return () => { stop(); observer?.disconnect(); };
  }, [creature, size, device, facing, faded, highlight?.row, highlight?.color, marks, hotMark, animate]);
  return <canvas ref={canvas} className="rb-trio-canvas" style={{ width: BOX * css, height: BOX * css }}
    role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} />;
}

/**
 * Parent A, the baby and Parent B side by side at the same scale, rows aligned on one 16 row grid.
 * The links between them light up the rows each parent gave (PARENT_TINT: A paper white, B signal green);
 * rows a parent did not give are washed out in its portrait. Hover, tap or use the arrow keys on a row
 * to trace it across all three; with `lookup`, a baby row is traced all the way down to its real Friend.
 */
export function DnaTrio({ baby, parentA, parentB, maxScale = 7, shrink = 0, babyExtra, reveal, reducedMotion, className, lookup, hint }: DnaTrioProps) {
  const node = useRef<HTMLElement>(null);
  const reduced = useReducedMotion(reducedMotion);
  const ratio = useDevicePixelRatio();
  const root = useRootSize(node);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<Active | null>(null);
  const [pinned, setPinned] = useState(false);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element);
      setWidth(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dna = baby.dna;
  const source = dna?.rowSource ?? ROWS.map(() => 0 as const);
  const heightCap = root.height >= 620 ? 8 : root.height >= 560 ? 7 : root.height >= 470 ? 5 : root.height >= 300 ? 4 : 3;
  let scale = Math.max(2, Math.min(maxScale, heightCap));
  while (scale > 2 && width > 0 && trioWidth(scale) > width) scale--;
  scale = Math.max(Math.min(scale, 3), scale - shrink);
  const { device, css } = pixelMetrics(scale, ratio);
  const facing: Facing = [parentA, parentB].some(parent => parent && isSideWalker(parent)) ? "right" : "down";
  const fadedA = useMemo(() => ROWS.map(row => source[row] !== 0), [source]);
  const fadedB = useMemo(() => ROWS.map(row => source[row] !== 1), [source]);
  const mutated = useMemo(() => new Set(mutatedRows(dna?.mutations ?? [])), [dna]);
  // Shapes the baby inherited (Dna.shapes with a source): their rows in any frame, and their cells in the facing shown.
  const shapes = useMemo(() => (dna?.shapes ?? []).flatMap((shape): InheritedShape[] => shape.from
    ? [{ rows: shapeRows(shape), cells: shape.cells[facing] ?? [], label: `${shape.from.name}'s ${shape.label}` }] : []), [dna, facing]);
  const inherited = useMemo(() => new Map(shapes.flatMap(shape => shape.rows.map(row => [row, shape] as const))), [shapes]);
  const hotShape = active ? inherited.get(active.row) ?? null : null;
  // Gene Lab: rows the player locked to a parent get a lock mark on that parent's link.
  const locks = dna?.locks, lockedRows = useMemo(() => ROWS.filter(row => locks?.[row] === 0 || locks?.[row] === 1), [locks]);
  // The dream (src/dream.ts): a peg on the baby's right edge per row, filled where the row matches the dream child's.
  const dream = baby.dream;
  const fromA = source.filter(side => side === 0).length, fromB = FRAME_SIZE - fromA;
  const nameA = parentA?.name ?? "Parent A", nameB = parentB?.name ?? "Parent B";
  const animate = !reduced;
  // Pixel provenance: a traced baby row's path down to the real Friend it came from. When that Friend is further up
  // than a parent, its portrait shows with the row lit (in the tint of the side it came in by): beside the parent the
  // row came through, in the trio's side margin with its row level with theirs, when the margin fits it; else in the caption.
  const traced = active?.side === "baby" ? active.row : null;
  const path = useMemo(() => lookup && traced !== null ? rowPath(baby, traced, lookup) : null, [baby, lookup, traced]);
  const originSide = path && path.steps.length > 1 && path.origin.creature ? path.steps[0].side : null;
  const marginScale = width > 0 ? Math.min(scale, Math.floor(((width - trioWidth(scale)) / 2 - 16) / BOX)) : 0;
  const inMargin = marginScale >= 2;
  const origin = pixelMetrics(inMargin ? marginScale : 2, ratio);
  const originSprite = path && originSide !== null && <RowSprite creature={path.origin.creature!} device={origin.device} css={origin.css} facing={facing}
    faded={null} animate={animate} highlight={{ row: path.row, color: originSide === 1 ? PARENT_TINT[1] : A_ROW_ON_PAPER }} />;
  const originTag = inMargin && path && originSprite && <span className={`rb-trio-origin rb-trio-origin-${originSide ? "b" : "a"}`}
    style={{ "--rb-row": path.row } as CSSProperties} aria-hidden="true">{originSprite}<span className="rb-trio-origin-name">{originLabel(path.origin)}</span></span>;

  const rowAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const row = Math.floor((event.clientY - box.top - event.currentTarget.clientTop) / css) - 1;
    return row >= 0 && row < FRAME_SIZE ? row : null;
  };
  const hover = (side: Side) => (event: PointerEvent<HTMLElement>) => {
    if (pinned || event.pointerType !== "mouse") return;
    const row = rowAt(event);
    setActive(row === null ? null : { row, side });
  };
  const leave = (event: PointerEvent<HTMLElement>) => { if (!pinned && event.pointerType === "mouse") setActive(null); };
  const tap = (side: Side) => (event: PointerEvent<HTMLElement>) => {
    const row = rowAt(event);
    if (row === null) return;
    if (pinned && active?.row === row && active.side === side) { setPinned(false); setActive(null); return; }
    setPinned(true);
    setActive({ row, side });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const sides: Side[] = ["a", "baby", "b"];
    const current = active ?? { row: -1, side: "baby" as Side };
    let next: Active | null = null;
    if (event.key === "ArrowDown") next = { ...current, row: Math.min(FRAME_SIZE - 1, current.row + 1) };
    else if (event.key === "ArrowUp") next = { ...current, row: Math.max(0, current.row < 0 ? FRAME_SIZE - 1 : current.row - 1) };
    else if (event.key === "Home") next = { ...current, row: 0 };
    else if (event.key === "End") next = { ...current, row: FRAME_SIZE - 1 };
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const index = sides.indexOf(current.side) + (event.key === "ArrowLeft" ? -1 : 1);
      next = { row: Math.max(0, current.row), side: sides[Math.max(0, Math.min(2, index))] };
    }
    // Enter or Space traces the row on the baby (again: stops); Escape stops first, so the card's Escape waits.
    else if (event.key === "Enter" || event.key === " ") {
      if (pinned && current.side === "baby") { event.preventDefault(); setPinned(false); setActive(null); return; }
      next = { row: Math.max(0, current.row), side: "baby" };
    } else if (event.key === "Escape" && active) { event.preventDefault(); setPinned(false); setActive(null); return; }
    if (!next) return;
    event.preventDefault();
    setPinned(true);
    setActive(next);
  };

  const caption = (() => {
    if (!active) return null;
    const { row, side } = active;
    const from = source[row], parentName = from === 0 ? nameA : nameB, role = from === 0 ? "Parent A" : "Parent B";
    const note = `${inherited.has(row) ? `, part of ${inherited.get(row)!.label}` : ""}${mutated.has(row) ? ", then mutated" : ""}`
      + (dream && side === "baby" ? (dream.rows[row] ? ", like the dream" : ", not like the dream") : "");
    if (side === "baby" && path) return <RowPathNote path={path} baby={baby.name} note={note} portrait={inMargin ? null : originSprite} />;
    if (side === "baby") return <span><strong>Row {row + 1}</strong> of {baby.name}: from {parentName} ({role}){note}.</span>;
    const mine = side === "a" ? 0 : 1, name = side === "a" ? nameA : nameB;
    return from === mine ? <span><strong>Row {row + 1}</strong> of {name}: passed on to {baby.name}.</span>
      : <span><strong>Row {row + 1}</strong> of {name}: not passed on. {baby.name} got {from === 0 ? nameA : nameB}'s.</span>;
  })();

  const rowsLayer = (side: Side) => <span className="rb-trio-rows" aria-hidden="true">
    {ROWS.map(row => {
      const hot = active?.row === row;
      const src = hot && (side === "baby" || (side === "a" ? source[row] === 0 : source[row] === 1));
      return <span key={row} className={cx("rb-trio-row", hot && "rb-hot", src && `rb-src rb-src-${source[row] === 0 ? "a" : "b"}`,
        side === "baby" && mutated.has(row) && "rb-mut", side === "baby" && inherited.has(row) && "rb-inh")}>
        {side === "baby" && dream && <i className={cx("rb-trio-dream-peg", dream.rows[row] && "rb-hit")} />}</span>;
    })}
  </span>;
  const link = (side: "a" | "b") => <span className={`rb-trio-link rb-trio-link-${side}`} aria-hidden="true">
    {ROWS.map(row => <span key={row} className={cx("rb-trio-cell", source[row] === (side === "a" ? 0 : 1) && "rb-on", active?.row === row && "rb-hot",
      locks?.[row] === (side === "a" ? 0 : 1) && "rb-lock")}
      style={{ "--rb-i": row } as CSSProperties} />)}
  </span>;
  const slot = (side: Side, creature: Creature | null | undefined, faded: readonly boolean[] | null, label?: string) =>
    <span className={cx("rb-trio-slot", `rb-trio-slot-${side}`)} onPointerMove={hover(side)} onPointerLeave={leave} onPointerDown={tap(side)}>
      {creature ? <RowSprite creature={creature} device={device} css={css} facing={facing} faded={faded} animate={animate} label={label}
        highlight={active && source[active.row] === 0 && side !== "b" ? { row: active.row, color: A_ROW_ON_PAPER } : null}
        marks={side === "baby" ? shapes : undefined} hotMark={side === "baby" ? hotShape : null} />
        : <span className="rb-trio-missing" style={{ width: BOX * css, height: BOX * css }}><PixelIcon name="help" /></span>}
      {rowsLayer(side)}
      {side === "baby" && babyExtra}
      {side === (originSide ? "b" : "a") && originTag}
    </span>;

  const style = {
    "--rb-px": `${css}px`, "--rb-box": `${BOX * css}px`, "--rb-link": `${linkWidth(scale)}px`,
    "--rb-tint-a": PARENT_TINT[0], "--rb-tint-b": PARENT_TINT[1], "--rb-o-px": `${origin.css}px`, "--rb-o-box": `${BOX * origin.css}px`,
  } as CSSProperties;
  const idle = <>
    <span className={cx("rb-trio-hint", hint && "rb-trio-hint-new")}>{hint && <PixelIcon name="sparkle" />}{hint ?? (lookup ? TRACE_HINT : "Hover or tap a row to trace it.")}</span>
    {shapes.map(shape => <span key={shape.label} className="rb-trio-inh-note"><i className="rb-trio-inh-pip" aria-hidden="true" />{rowsLabel(shape.rows)}: {shape.label}</span>)}
    {mutated.size > 0 && <span className="rb-trio-mut-note"><i className="rb-trio-mut-pip" aria-hidden="true" />
      {rowsLabel([...mutated])} mutated</span>}
    {lockedRows.length > 0 && <span className="rb-trio-lock-note"><PixelIcon name="lock" />Locked {rowsLabel(lockedRows).toLowerCase()}</span>}
    {dream && <span className="rb-trio-dream-note"><i className="rb-trio-dream-peg rb-hit" aria-hidden="true" />{dream.matched} of {FRAME_SIZE} like the dream</span>}</>;
  const summary = `DNA: ${fromA} of 16 rows from ${nameA} (Parent A), ${fromB} from ${nameB} (Parent B)` +
    shapes.map(shape => `, ${rowsLabel(shape.rows).toLowerCase()} carry ${shape.label}`).join("") +
    (lockedRows.length ? `, ${rowsLabel(lockedRows).toLowerCase()} locked in the Gene Lab` : "") +
    (mutated.size ? `, ${mutated.size === 1 ? "1 row" : `${mutated.size} rows`} mutated` : "") +
    (dream ? `, ${dream.matched} of ${FRAME_SIZE} rows match your Friend's dream${dream.matched ? ` (${rowsLabel(ROWS.filter(row => dream.rows[row])).toLowerCase()})` : ""}.` : ".") +
    (lookup ? " Up and Down move over the rows; Enter traces one to the real Friend it came from." : " Use the arrow keys to trace a row.");

  return <figure ref={node} className={cx("rb-trio", reveal && !reduced && "rb-trio-reveal", width === 0 && "rb-trio-measuring", className)} style={style}
    tabIndex={0} role="group" aria-label={summary} onKeyDown={onKeyDown} onBlur={() => { if (pinned) { setPinned(false); setActive(null); } }}>
    <div className="rb-trio-grid">
      <span className="rb-trio-role rb-trio-role-a">Parent A</span>
      <span className="rb-trio-role rb-trio-role-baby">Baby</span>
      <span className="rb-trio-role rb-trio-role-b">Parent B</span>
      {slot("a", parentA, fadedA)}
      {link("a")}
      {slot("baby", baby, null, `${baby.name}, walking`)}
      {link("b")}
      {slot("b", parentB, fadedB)}
      <span className="rb-trio-name rb-trio-name-a"><strong><Name creature={parentA} fallback="Parent A" column={BOX * css + BORDER} /></strong><span className="rb-trio-count"><i className="rb-trio-swatch rb-trio-swatch-a" />{fromA} {fromA === 1 ? "row" : "rows"}</span></span>
      <span className="rb-trio-name rb-trio-name-baby"><strong>{baby.name}</strong><span className="rb-trio-count">16 rows</span></span>
      <span className="rb-trio-name rb-trio-name-b"><strong><Name creature={parentB} fallback="Parent B" column={BOX * css + BORDER} /></strong><span className="rb-trio-count"><i className="rb-trio-swatch rb-trio-swatch-b" />{fromB} {fromB === 1 ? "row" : "rows"}</span></span>
    </div>
    <figcaption className={cx("rb-trio-caption", lookup && "rb-trio-traceable", lookup && width > 0 && !inMargin && baby.lineage > 1 && "rb-trio-deep", caption && "rb-tracing")}
      aria-live="polite">
      {lookup ? <>
        {/* The idle line keeps its place while a row is traced, so the card does not jump. */}
        <span className="rb-trio-idle" aria-hidden={caption ? true : undefined}>{idle}</span>
        {caption && <span className="rb-trio-now">{caption}</span>}
      </> : caption ?? idle}
    </figcaption>
  </figure>;
}
