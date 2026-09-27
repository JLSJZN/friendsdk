import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { drawCreature } from "../draw.ts";
import { isSideWalker } from "../genetics.ts";
import { FRAME_SIZE, PARENT_TINT, type Creature, type Facing } from "../types.ts";
/** Parent A's tint is paper white, invisible on the paper portraits: its row highlight there is a darker paper band. */
const A_ROW_ON_PAPER = "#D6CFBF";
import { PixelIcon } from "./PixelIcon.tsx";
import { cx, pixelMetrics, subscribeTick, useDevicePixelRatio, useReducedMotion, useRootSize } from "./shared.ts";

export type DnaTrioProps = Readonly<{
  baby: Creature;
  parentA?: Creature | null;
  parentB?: Creature | null;
  /** Upper bound for the CSS pixels per sprite pixel. The trio picks the largest scale that fits its width. */
  maxScale?: number;
  /** Rendered inside the baby's slot, e.g. confetti. */
  babyExtra?: ReactNode;
  /** Reveal: the baby lands with a squash. */
  reveal?: boolean;
  reducedMotion?: boolean;
  className?: string;
}>;

/** Sprite box in sprite pixels: the 16 x 16 frame plus a one pixel halo on every side. */
const BOX = FRAME_SIZE + 2;
const GAP = 6, BORDER = 4;
const ROWS = Array.from({ length: FRAME_SIZE }, (_, row) => row);
const FRAME_MS = 110;
const PAPER = "#F4F1EA", RULE = "#E6E1D6";

type Side = "a" | "baby" | "b";
type Active = Readonly<{ row: number; side: Side }>;

/** Full name, plus "#77949" for a Friend on narrow trios. */
function Name({ creature, fallback }: { creature?: Creature | null; fallback: string }) {
  if (!creature) return <>{fallback}</>;
  if (creature.tokenId === undefined) return <>{creature.name}</>;
  return <><span className="rb-long">{creature.name}</span><span className="rb-short">#{String(creature.tokenId)}</span></>;
}

const linkWidth = (scale: number) => Math.max(14, scale * 3);
const trioWidth = (scale: number) => 3 * (BOX * scale + BORDER) + 2 * linkWidth(scale) + 4 * GAP;

export function mutatedRows(mutations: readonly number[]) {
  return [...new Set(mutations.map(index => Math.floor(index / FRAME_SIZE)))].filter(row => row >= 0 && row < FRAME_SIZE).sort((x, y) => x - y);
}

/**
 * One portrait on the shared 16 row grid, drawn without accessories so every row reads clearly.
 * `faded` rows (the ones the baby did not take) are washed out. All portraits step through the same
 * walk frame at the same time, so the baby's rows line up with its parents' on every frame.
 */
function RowSprite({ creature, device, css, facing, faded, highlight, animate, label }: {
  creature: Creature; device: number; css: number; facing: Facing; faded: readonly boolean[] | null;
  /** Row painted behind the sprite in a tint while it is being traced. */
  highlight: Readonly<{ row: number; color: string }> | null; animate: boolean; label?: string;
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
  }, [creature, size, device, facing, faded, highlight?.row, highlight?.color, animate]);
  return <canvas ref={canvas} className="rb-trio-canvas" style={{ width: BOX * css, height: BOX * css }}
    role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} />;
}

/**
 * Parent A, the baby and Parent B side by side at the same scale, rows aligned on one 16 row grid.
 * The links between them light up the rows each parent gave (PARENT_TINT: A paper white, B signal green);
 * rows a parent did not give are washed out in its portrait. Hover, tap or use the arrow keys on a row
 * to trace it across all three.
 */
export function DnaTrio({ baby, parentA, parentB, maxScale = 7, babyExtra, reveal, reducedMotion, className }: DnaTrioProps) {
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
  const { device, css } = pixelMetrics(scale, ratio);
  const facing: Facing = [parentA, parentB].some(parent => parent && isSideWalker(parent)) ? "right" : "down";
  const fadedA = useMemo(() => ROWS.map(row => source[row] !== 0), [source]);
  const fadedB = useMemo(() => ROWS.map(row => source[row] !== 1), [source]);
  const mutated = useMemo(() => new Set(mutatedRows(dna?.mutations ?? [])), [dna]);
  const fromA = source.filter(side => side === 0).length, fromB = FRAME_SIZE - fromA;
  const nameA = parentA?.name ?? "Parent A", nameB = parentB?.name ?? "Parent B";
  const animate = !reduced;

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
    if (!next) return;
    event.preventDefault();
    setPinned(true);
    setActive(next);
  };

  const caption = (() => {
    if (!active) return null;
    const { row, side } = active;
    const from = source[row], parentName = from === 0 ? nameA : nameB, role = from === 0 ? "Parent A" : "Parent B";
    if (side === "baby") return <span><strong>Row {row + 1}</strong> of {baby.name}: from {parentName} ({role}){mutated.has(row) ? ", then mutated" : ""}.</span>;
    const mine = side === "a" ? 0 : 1, name = side === "a" ? nameA : nameB;
    return from === mine ? <span><strong>Row {row + 1}</strong> of {name}: passed on to {baby.name}.</span>
      : <span><strong>Row {row + 1}</strong> of {name}: not passed on. {baby.name} got {from === 0 ? nameA : nameB}'s.</span>;
  })();

  const rowsLayer = (side: Side) => <span className="rb-trio-rows" aria-hidden="true">
    {ROWS.map(row => {
      const hot = active?.row === row;
      const src = hot && (side === "baby" || (side === "a" ? source[row] === 0 : source[row] === 1));
      return <span key={row} className={cx("rb-trio-row", hot && "rb-hot", src && `rb-src rb-src-${source[row] === 0 ? "a" : "b"}`,
        side === "baby" && mutated.has(row) && "rb-mut")} />;
    })}
  </span>;
  const link = (side: "a" | "b") => <span className={`rb-trio-link rb-trio-link-${side}`} aria-hidden="true">
    {ROWS.map(row => <span key={row} className={cx("rb-trio-cell", source[row] === (side === "a" ? 0 : 1) && "rb-on", active?.row === row && "rb-hot")}
      style={{ "--rb-i": row } as CSSProperties} />)}
  </span>;
  const slot = (side: Side, creature: Creature | null | undefined, faded: readonly boolean[] | null, label?: string) =>
    <span className={cx("rb-trio-slot", `rb-trio-slot-${side}`)} onPointerMove={hover(side)} onPointerLeave={leave} onPointerDown={tap(side)}>
      {creature ? <RowSprite creature={creature} device={device} css={css} facing={facing} faded={faded} animate={animate} label={label}
        highlight={active && source[active.row] === 0 && side !== "b" ? { row: active.row, color: A_ROW_ON_PAPER } : null} />
        : <span className="rb-trio-missing" style={{ width: BOX * css, height: BOX * css }}><PixelIcon name="help" /></span>}
      {rowsLayer(side)}
      {side === "baby" && babyExtra}
    </span>;

  const style = {
    "--rb-px": `${css}px`, "--rb-box": `${BOX * css}px`, "--rb-link": `${linkWidth(scale)}px`,
    "--rb-tint-a": PARENT_TINT[0], "--rb-tint-b": PARENT_TINT[1],
  } as CSSProperties;
  const summary = `DNA: ${fromA} of 16 rows from ${nameA} (Parent A), ${fromB} from ${nameB} (Parent B)` +
    (mutated.size ? `, ${mutated.size === 1 ? "1 row" : `${mutated.size} rows`} mutated.` : ".") + " Use the arrow keys to trace a row.";

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
      <span className="rb-trio-name rb-trio-name-a"><strong><Name creature={parentA} fallback="Parent A" /></strong><span className="rb-trio-count"><i className="rb-trio-swatch rb-trio-swatch-a" />{fromA} {fromA === 1 ? "row" : "rows"}</span></span>
      <span className="rb-trio-name rb-trio-name-baby"><strong>{baby.name}</strong><span className="rb-trio-count">16 rows</span></span>
      <span className="rb-trio-name rb-trio-name-b"><strong><Name creature={parentB} fallback="Parent B" /></strong><span className="rb-trio-count"><i className="rb-trio-swatch rb-trio-swatch-b" />{fromB} {fromB === 1 ? "row" : "rows"}</span></span>
    </div>
    <figcaption className="rb-trio-caption" aria-live="polite">
      {caption ?? <><span className="rb-trio-hint">Hover or tap a row to trace it.</span>
        {mutated.size > 0 && <span className="rb-trio-mut-note"><i className="rb-trio-mut-pip" aria-hidden="true" />
          {mutated.size === 1 ? `Row ${[...mutated][0] + 1} mutated` : `Rows ${[...mutated].map(row => row + 1).join(", ")} mutated`}</span>}</>}
    </figcaption>
  </figure>;
}
