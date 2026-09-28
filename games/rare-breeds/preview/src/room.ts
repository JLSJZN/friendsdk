// The game's nursery art (src/scene/room.ts) drawn by the page: walls, props and the four stations, with any number
// of creatures depth sorted among them, the way the nursery scene sorts by feet line. No input, no walking rules:
// the page moves its actors itself.
import { INK, ellipse } from "../../src/scene/art.ts";
import { feetRow, inkSpan, paintCreature } from "../../src/scene/creatures.ts";
import { A, ART_H, ART_W, createRoom, type RoomState } from "../../src/scene/room.ts";
import type { Clip, Creature, Facing, StationId } from "../../src/types.ts";

export type Actor = {
  creature: Creature;
  /** Feet anchor on the floor (logical px). */
  x: number; y: number;
  scale: number;
  facing: Facing; clip: Clip; frame: number;
  /** Height above the floor (logical px): hops, the pouch seat. */
  lift?: number;
  sx?: number; sy?: number;
  alpha?: number;
  /** Only this rectangle (logical px) of the actor is drawn, e.g. the window it flies through. */
  clipRect?: readonly [number, number, number, number] | null;
  shadow?: boolean;
};

const NEVER = -1e9;
export const restingRoom = (time = 0, reducedMotion = false): RoomState => ({
  time, eggs: 1, eggChangedAt: NEVER, near: null, hover: null,
  pressedAt: { matchmaker: NEVER, incubator: NEVER, sanctuary: NEVER, slingshot: NEVER },
  doorOpen: 0, gateOpen: 0, windowOpen: 0, sling: { pull: 0, snapAt: NEVER, snapPull: 0, loaded: false }, reducedMotion,
});

export type RoomPainter = ReturnType<typeof roomPainter>;

/** A painter for one Friend's nursery (its portrait hangs on the wall). */
export function roomPainter(player: Creature) {
  const room = createRoom(player);
  const art = (ctx: CanvasRenderingContext2D, draw: () => void) => { ctx.save(); ctx.scale(A, A); draw(); ctx.restore(); };

  function drawActor(ctx: CanvasRenderingContext2D, actor: Actor, time: number) {
    const alpha = actor.alpha ?? 1;
    if (alpha <= 0.01) return;
    const lift = actor.lift ?? 0;
    if (actor.shadow !== false && lift < 60 && !actor.clipRect) {
      const span = inkSpan(actor.creature), rx = Math.max(4, Math.round(((span.max - span.min + 1) / 2) * actor.scale / A));
      const feet = (15 - feetRow(actor.creature)) * actor.scale;
      art(ctx, () => {
        ctx.globalAlpha = 0.13 * alpha * Math.max(0.3, 1 - lift / 80);
        ellipse(ctx, Math.round(actor.x / A), Math.round((actor.y - feet) / A) - 1, rx, 2, INK);
      });
    }
    if (actor.clipRect) {
      const [x0, y0, x1, y1] = actor.clipRect;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    }
    paintCreature(ctx, actor.creature, {
      clip: actor.clip, facing: actor.facing, frame: actor.frame, x: Math.round(actor.x), y: Math.round(actor.y - lift),
      scale: actor.scale, alpha, sx: actor.sx ?? 1, sy: actor.sy ?? 1, time,
    });
    if (actor.clipRect) ctx.restore();
  }

  /** Paints the whole room (960 x 642 logical px) with `actors`; `over` draws on top (particles, tags). */
  function paint(ctx: CanvasRenderingContext2D, state: RoomState, actors: readonly Actor[], over?: () => void) {
    ctx.drawImage(room.base, 0, 0, ART_W * A, ART_H * A);
    art(ctx, () => { room.drawDoor(ctx, state.doorOpen); room.drawGate(ctx, state.gateOpen); room.drawWindow(ctx, state.windowOpen); });
    const layers: { y: number; draw: () => void }[] = [
      ...room.props.map(prop => ({ y: prop.baseY, draw: () => ctx.drawImage(prop.sprite, prop.x * A, prop.y * A, prop.sprite.width * A, prop.sprite.height * A) })),
      { y: room.kioskBaseY, draw: () => art(ctx, () => room.drawKiosk(ctx, state)) },
      { y: room.incubatorBaseY, draw: () => art(ctx, () => room.drawIncubator(ctx, state)) },
      { y: room.slingshotBaseY, draw: () => art(ctx, () => room.drawSlingshot(ctx, state)) },
      ...actors.map(actor => ({ y: actor.clipRect ? -200 : actor.y, draw: () => drawActor(ctx, actor, state.time) })),
    ];
    // A rider in the pouch (feet line SLING_BASE_Y + 1) sits behind the pouch lip, as in the nursery.
    if (state.sling.loaded) layers.push({ y: room.slingshotBaseY + 2, draw: () => art(ctx, () => room.drawSlingshotFront(ctx, state)) });
    layers.sort((a, b) => a.y - b.y);
    for (const layer of layers) layer.draw();
    over?.();
  }

  return { paint, drawActor };
}

/** Station copy for the nursery map (numbers match the game's intro tour). */
export const STATION_INFO: Readonly<Record<StationId, Readonly<{ n: number; title: string; body: string; fine: string }>>> = {
  matchmaker: {
    n: 1, title: "Matchmaker",
    body: "Your Friend is parent A, or any baby you kept. Parent B is one of three real wild Friends, or another baby from your brood. New faces are free, and a Wish (15 Hearts) offers three from a family you pick.",
    fine: "A strip shows what can hatch, and a hint names any shape a parent can pass on.",
  },
  incubator: {
    n: 2, title: "Egg incubator",
    body: "Eggs cost 1 RF each, in packs of 1, 3 or 5 with one confirmation. Breed with no egg waiting and the button buys one first.",
    fine: "Simulated RF, confirmed by the SDK runtime. Every egg reserves the 6 RF top prize.",
  },
  slingshot: {
    n: 3, title: "Moon Slingshot",
    body: "A kept baby rides a firework rocket out of the window. Hold to climb from x1 towards x10, let go to jump. The crash point is drawn once, at ignition.",
    fine: "Any exit pays back at most 0.9x on average. The baby is gone afterwards, even in the pond.",
  },
  sanctuary: {
    n: 4, title: "Sanctuary",
    body: "Your brood lives here. Inspect a baby, breed with it, or trade it in for its fixed value: 0.5, 1, 1.5 or 6 RF by tier.",
    fine: "Collect all 9 families, all 4 tiers and the 45 breeds of the breed book.",
  },
};
