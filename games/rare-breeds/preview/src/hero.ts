// Hero: the real nursery art with your Friend strolling around the rug and its brood tailing it, the way kept
// babies follow the player in the game. Hearts pop now and then. Reduced motion: one still frame.
import { createParticles } from "../../src/scene/fx.ts";
import type { Creature, Facing } from "../../src/types.ts";
import { pixelView, reducedMotion, whileVisible } from "./core.ts";
import { restingRoom, roomPainter, type Actor } from "./room.ts";

/** The visible slice of the room (logical px): the rug and the back wall, cropped so the Friend reads larger. */
const W = 780, H = 470, CAMERA = { x: 90, y: 40 };
/** The stroll: an ellipse around the rug (logical px, feet line). */
const PATH = { cx: 480, cy: 410, rx: 236, ry: 74 };
const SPEED = 0.00028; // radians per ms
const STEP_MS = 110;

const facingFor = (dx: number, dy: number, previous: Facing): Facing => {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return previous;
  return Math.abs(dx) * 0.55 > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
};

export function mountHero(canvas: HTMLCanvasElement, friend: Creature, brood: readonly Creature[]) {
  const view = pixelView(canvas, W, H);
  const painter = roomPainter(friend);
  const fx = createParticles();
  const actors: Actor[] = [friend, ...brood].map((creature, index) => ({
    creature, x: 0, y: 0, scale: index === 0 ? 4 : 3, facing: "down", clip: "walk", frame: 0,
  }));
  let nextHearts = 1800;

  const place = (time: number) => {
    const still = reducedMotion();
    actors.forEach((actor, index) => {
      // Each baby walks the same loop a little behind the one in front.
      const angle = (still ? 1.1 : time * SPEED) - index * 0.42;
      const x = PATH.cx + Math.cos(angle) * PATH.rx, y = PATH.cy + Math.sin(angle) * PATH.ry;
      const dx = -Math.sin(angle) * PATH.rx, dy = Math.cos(angle) * PATH.ry;
      actor.facing = still ? "down" : facingFor(dx, dy, actor.facing);
      actor.clip = still ? "idle" : "walk";
      actor.frame = still ? 0 : Math.floor(time / STEP_MS + index * 3) & 7;
      actor.x = x; actor.y = y;
      actor.lift = still ? 0 : index > 0 ? Math.abs(Math.sin(time / 190 + index)) * 4 : 0;
    });
  };

  whileVisible(canvas, (now, dt) => {
    view.sync();
    const time = reducedMotion() ? 0 : now;
    place(time);
    if (!reducedMotion() && dt > 0) {
      nextHearts -= dt;
      if (nextHearts <= 0) {
        const baby = actors[1 + Math.floor(Math.random() * (actors.length - 1))] ?? actors[0];
        fx.hearts(baby.x, baby.y - 16 * baby.scale - 6, 2, 18, 140);
        nextHearts = 2400 + Math.random() * 1600;
      }
      fx.update(dt);
    }
    view.begin(true, CAMERA);
    painter.paint(view.ctx, restingRoom(time, reducedMotion()), actors, () => fx.draw(view.ctx, "top"));
  });
}
