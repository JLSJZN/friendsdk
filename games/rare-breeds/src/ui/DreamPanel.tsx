import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { DREAM_HEARTS, type Dream, type DreamProgress } from "../dream.ts";
import { drawCreature } from "../draw.ts";
import { FRAME_SIZE, type Creature, type Facing } from "../types.ts";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { SpriteThumb } from "./SpriteThumb.tsx";
import { cx, pixelMetrics, subscribeTick, useReducedMotion } from "./shared.ts";

/** Dream colours: a lavender paper cloud and a deep violet ink (the nursery's thought bubble uses the same pair). */
export const DREAM_PAPER = "#EFE9FF", DREAM_INK = "#4B34B8";
const BOX = FRAME_SIZE + 2, FRAME_MS = 110;
const RULE = "#DCD2F7";

export type DreamPanelProps = Readonly<{
  dream: Dream;
  progress: DreamProgress;
  friend: Creature;
  /** The dream mate is among the Matchmaker's wild mates right now. */
  onOffer: boolean;
  hearts: number;
  wishPrice: number;
  /** The baby that made the dream come true (progress.solved), when it is known. */
  solvedBaby?: Creature | null;
  /** Opens the Matchmaker (on the dream pair's Gene Lab when the mate is on offer). */
  onFindMate: () => void;
  /** A Wish for the dream mate's family (it always brings the dream mate). */
  onWish: () => void;
  /** After it came true: the next dream. */
  onAgain: () => void;
  onClose: () => void;
  reducedMotion?: boolean;
}>;

/**
 * Your Friend's dream: the dream child big and walking, the clue (the mate's family), the best match so far and the eggs used,
 * and the way to the mate. Every attempt is an ordinary egg; the dream only adds Hearts and a cosmetic title.
 */
export function DreamPanel({ dream, progress, friend, onOffer, hearts, wishPrice, solvedBaby, onFindMate, onWish, onAgain, onClose, reducedMotion }: DreamPanelProps) {
  const reduced = useReducedMotion(reducedMotion);
  const family = dream.mate.family, solved = !!progress.solved;
  const footer = solved
    ? <div className="rb-dream-actions">
      <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onAgain} data-autofocus><PixelIcon name="dream" /><span>Dream again</span></button>
    </div>
    : <div className="rb-dream-actions">
      {!onOffer && <button type="button" className="rb-button rb-button-ghost rb-button-lg rb-dream-wish" onClick={onWish} disabled={hearts < wishPrice}
        aria-label={`Wish for a ${family}, ${wishPrice} Hearts`}>
        <PixelIcon name="sparkle" /><span>Wish: {family}</span><span className="rb-wish-price"><PixelIcon name="heart" />{wishPrice}</span></button>}
      <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onFindMate} data-autofocus><PixelIcon name="heart" /><span>Find the mate</span></button>
    </div>;
  return <Panel eyebrow={`${friend.name}'s dream`} title={solved ? "Dream come true!" : "Dream child"} onClose={onClose} size="sm" footer={footer} className="rb-dream-panel">
    <div className={cx("rb-dream-hero", !reduced && "rb-animate")}>
      <span className="rb-dream-cloud">
        <SpriteThumb creature={dream.child} scale={6} compactScale={4} clip="walk" ink={DREAM_INK} reducedMotion={reduced} label="The dream child, walking" />
      </span>
      <span className="rb-dream-puffs" aria-hidden="true"><i /><i /></span>
    </div>
    {solved
      ? <p className="rb-dream-clue"><strong>{solvedBaby?.name ?? "Your baby"}</strong> is the child of the dream: <strong>+{DREAM_HEARTS} Hearts</strong> and the <strong>Dreamchild</strong> title.</p>
      : <p className="rb-dream-clue"><strong>{friend.name}</strong> dreams of a child with a <strong>{family}</strong>.</p>}
    {!solved && <p className="rb-dream-how">Find that {family}, then copy the dream row by row in the Gene Lab. Every egg shows how many rows match.</p>}
    <dl className="rb-dream-stats">
      <div><dt>Best match</dt><dd>{progress.eggs ? <>{progress.best}<span> of {FRAME_SIZE} rows</span></> : <span>No try yet</span>}</dd></div>
      <div><dt>Eggs used</dt><dd>{progress.eggs}</dd></div>
      <div><dt>Reward</dt><dd><PixelIcon name="heart" />{DREAM_HEARTS}<span> once</span></dd></div>
    </dl>
    {!solved && <p className={cx("rb-dream-offer", onOffer && "rb-on")} role="status">{onOffer
      ? <><PixelIcon name="dream" /><span>The {family} of the dream is in the Matchmaker now, marked with a dream tag.</span></>
      : <><PixelIcon name="dice" /><span>Not on offer right now: <strong>New faces</strong> (free) brings it about 1 in 4 times, a <strong>Wish</strong> for {family} always.</span></>}</p>}
    <p className="rb-dream-fine">Cosmetic plus Hearts (game points, not RF). Eggs, tiers and odds stay the same.</p>
  </Panel>;
}

/**
 * The dream child on the Gene Lab's 16 row grid (ruled like the bench portraits, at their scale or two steps under), so its rows
 * can be compared with the preview: which rows came from your Friend, which from the mate.
 */
export function DreamRows({ dream, device: benchDevice, css: benchCss, facing, animate }: { dream: Dream; device: number; css: number; facing: Facing; animate: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Two steps smaller than a big bench (7 or 6 CSS px a row on wide frames), so it fits beside the cost line.
  const bench = Math.round(benchCss), { device, css } = pixelMetrics(bench >= 6 ? bench - 2 : bench, benchDevice / benchCss);
  const size = BOX * device;
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    element.width = size;
    element.height = size;
    ctx.imageSmoothingEnabled = false;
    const line = Math.max(1, Math.round(device / 6));
    const paint = (frame: number) => {
      ctx.fillStyle = DREAM_PAPER;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = RULE;
      for (let row = 0; row <= FRAME_SIZE; row++) ctx.fillRect(0, (1 + row) * device - (row === FRAME_SIZE ? line : 0), size, line);
      drawCreature(ctx, dream.child, { clip: "walk", facing, frame, x: (FRAME_SIZE / 2 + 1) * device, y: (FRAME_SIZE + 1) * device, scale: device, ink: DREAM_INK, accessory: null });
    };
    paint(0);
    if (!animate) return;
    let last = -1;
    return subscribeTick(now => {
      const frame = Math.floor(now / FRAME_MS) % 8;
      if (frame !== last) { last = frame; paint(frame); }
    });
  }, [dream, size, device, facing, animate]);
  return <figure className="rb-dream-rows">
    <figcaption><PixelIcon name="dream" /><span>The dream</span></figcaption>
    <canvas ref={canvas} className="rb-dream-rows-canvas" style={{ width: BOX * css, height: BOX * css }} role="img"
      aria-label={`Your Friend's dream child with ${dream.mate.name}, walking. Compare its rows with the preview.`} />
    <p className="rb-dream-rows-note">Lock the rows to match it. Each egg tells you how many match.</p>
  </figure>;
}

/** A short burst over the reveal card when the dream comes true (nothing with reduced motion: the news line says it). */
export function DreamBurst({ reducedMotion }: { reducedMotion?: boolean }) {
  const reduced = useReducedMotion(reducedMotion);
  const bits = useMemo(() => Array.from({ length: 14 }, (_, index) => ({ x: Math.round(Math.cos(index * 2.4) * (90 + (index * 37) % 90)), y: Math.round(-40 - (index * 53) % 120), delay: (index * 70) % 420 })), []);
  if (reduced) return null;
  return <div className="rb-dream-burst" aria-hidden="true">
    <p className="rb-dream-burst-title"><PixelIcon name="dream" pixel={3} /><span>Dream come true!</span></p>
    {bits.map((bit, index) => <i key={index} style={{ "--dx": `${bit.x}px`, "--dy": `${bit.y}px`, animationDelay: `${bit.delay}ms` } as CSSProperties} />)}
  </div>;
}
