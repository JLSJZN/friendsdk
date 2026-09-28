// "Your nursery": the real room with numbered stations. Picking one walks your Friend over to it (the station wakes
// up, as it does in the game when you come near) and explains what it does.
import { clamp, easeOutCubic, lerp } from "../../src/scene/art.ts";
import { PICTURE_HEIGHT, PICTURE_MARKERS, PICTURE_WIDTH } from "../../src/scene/picture.ts";
import { SPAWN, STATIONS } from "../../src/scene/room.ts";
import type { Creature, Facing, StationId } from "../../src/types.ts";
import { $, pixelView, reducedMotion, whileVisible } from "./core.ts";
import { STATION_INFO, restingRoom, roomPainter, type Actor } from "./room.ts";

/** Where the Friend stands to use each station: just in front of its hit box. */
const SPOTS = Object.fromEntries(STATIONS.map(({ id, hit: [x0, , x1, y1] }) => {
  const x = id === "matchmaker" ? x1 + 36 : (x0 + x1) / 2;
  const y = id === "matchmaker" ? y1 - 40 : clamp(y1 + 34, 200, 420);
  return [id, { x, y }];
})) as Record<StationId, { x: number; y: number }>;

export function mountBase(friend: Creature, babies: readonly Creature[]) {
  const map = $("#base-map");
  const canvas = $<HTMLCanvasElement>("#base-canvas");
  const panel = $("#base-panel");
  const view = pixelView(canvas, PICTURE_WIDTH, PICTURE_HEIGHT);
  const painter = roomPainter(friend);
  const player: Actor = { creature: friend, x: SPAWN.x, y: SPAWN.y, scale: 4, facing: "down", clip: "idle", frame: 0 };
  const brood: Actor[] = babies.map((creature, i) => ({ creature, x: SPAWN.x + (i ? 70 : -70), y: SPAWN.y + 6, scale: 3, facing: "down", clip: "idle", frame: 0 }));
  let selected: StationId = "matchmaker";
  let walk = { from: { x: SPAWN.x, y: SPAWN.y }, to: { x: SPAWN.x, y: SPAWN.y }, start: -1e9, ms: 1 };

  const markers = PICTURE_MARKERS.filter(marker => marker.id !== "you").map(marker => {
    const id = marker.id as StationId;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "marker";
    button.textContent = String(STATION_INFO[id].n);
    button.style.left = `${marker.x * 100}%`;
    button.style.top = `${marker.y * 100}%`;
    button.setAttribute("aria-label", `${STATION_INFO[id].n}: ${STATION_INFO[id].title}`);
    button.addEventListener("click", () => select(id));
    map.append(button);
    return { id, button };
  });

  function select(id: StationId, animate = true) {
    selected = id;
    for (const marker of markers) marker.button.setAttribute("aria-pressed", String(marker.id === id));
    const info = STATION_INFO[id];
    panel.innerHTML = `<p class="num">Station ${info.n} of 4</p><h3>${info.title}</h3><p>${info.body}</p><p class="fine">${info.fine}</p>`;
    const now = performance.now();
    const from = { x: player.x, y: player.y }, to = SPOTS[id];
    walk = { from, to, start: animate && !reducedMotion() ? now : -1e9, ms: Math.max(1, Math.hypot(to.x - from.x, to.y - from.y) / 0.32) };
    if (!animate || reducedMotion()) { player.x = to.x; player.y = to.y; }
  }
  select("matchmaker", false);

  whileVisible(map, now => {
    view.sync();
    const still = reducedMotion();
    const u = clamp((now - walk.start) / walk.ms);
    const moving = u < 1 && !still;
    if (!still) {
      const e = easeOutCubic(u);
      player.x = lerp(walk.from.x, walk.to.x, e); player.y = lerp(walk.from.y, walk.to.y, e);
    }
    const dx = walk.to.x - walk.from.x, dy = walk.to.y - walk.from.y;
    const facing: Facing = moving ? (Math.abs(dx) * 0.6 > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up") : "up";
    player.facing = still ? "down" : facing;
    player.clip = moving ? "walk" : "idle";
    player.frame = still ? 0 : Math.floor(now / 110) & 7;
    brood.forEach((baby, i) => {
      // The brood trails a step behind the Friend.
      const target = { x: player.x + (i ? 64 : -64), y: player.y + 8 };
      baby.x = lerp(baby.x, target.x, still ? 1 : 0.06); baby.y = lerp(baby.y, target.y, still ? 1 : 0.06);
      const far = Math.hypot(target.x - baby.x, target.y - baby.y) > 6;
      baby.clip = far && !still ? "walk" : "idle";
      baby.facing = far && !still ? (Math.abs(target.x - baby.x) > Math.abs(target.y - baby.y) ? (target.x > baby.x ? "right" : "left") : target.y > baby.y ? "down" : "up") : "down";
      baby.frame = still ? 0 : (Math.floor(now / 110) + i * 3) & 7;
    });
    const state = { ...restingRoom(still ? 0 : now, still), near: moving ? null : selected, hover: selected };
    view.begin(true);
    painter.paint(view.ctx, state, [player, ...brood]);
  });
}
