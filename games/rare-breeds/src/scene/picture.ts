// A still picture of the nursery for the intro tour and the "?" panel: the real room art (walls, props and the four
// stations at rest) with the Friend at its spawn point, composed once per Friend at the world's logical scale. Browser only.
import type { Creature, StationId } from "../types.ts";
import { INK, ellipse, makeCanvas } from "./art.ts";
import { paintCreature } from "./creatures.ts";
import { A, ART_H, ART_W, SPAWN, STATIONS, createRoom, type Rect, type RoomState } from "./room.ts";

/** The Friend's world scale (logical px per sprite pixel, as in the nursery). */
const HERO_SCALE = 4;
/** The part of the room shown (logical px): the whole width, from the ceiling to just past the rug. */
const CROP: Rect = [0, 0, ART_W * A, 164 * A];
export const PICTURE_WIDTH = CROP[2] - CROP[0], PICTURE_HEIGHT = CROP[3] - CROP[1];

/** Stations at rest: one egg under a lit heat lamp, lights on, band slack. */
const STILL: RoomState = {
  time: 0, eggs: 1, eggChangedAt: -1e9, near: null, hover: null,
  pressedAt: { matchmaker: -1e9, incubator: -1e9, sanctuary: -1e9, slingshot: -1e9 },
  doorOpen: 0, gateOpen: 0, windowOpen: 0, sling: { pull: 0, snapAt: -1e9, snapPull: 0, loaded: false }, reducedMotion: true,
};

/** Where each station's marker sits, as a point inside its hit rect (0 to 1 across, 0 to 1 down). */
// The slingshot pin sits on Window 2 above the fork, so the fork and its x10 crate stay visible.
const MARKER_AT: Record<StationId, readonly [number, number]> = {
  matchmaker: [0.5, 0.52], incubator: [0.5, 0.2], sanctuary: [0.5, 0.62], slingshot: [0.5, 0.2],
};

export type PictureMarker = Readonly<{ id: StationId | "you"; x: number; y: number }>;

/** Marker points as fractions of the picture (0 to 1), derived from the stations' hit rects and the spawn point. */
export const PICTURE_MARKERS: readonly PictureMarker[] = [
  ...STATIONS.map(({ id, hit: [x0, y0, x1, y1] }) => {
    const [u, v] = MARKER_AT[id];
    return { id, x: (x0 + (x1 - x0) * u - CROP[0]) / PICTURE_WIDTH, y: (y0 + (y1 - y0) * v - CROP[1]) / PICTURE_HEIGHT };
  }),
  { id: "you", x: (SPAWN.x - CROP[0]) / PICTURE_WIDTH, y: (SPAWN.y - 16 * HERO_SCALE - 22 - CROP[1]) / PICTURE_HEIGHT },
];

const pictures = new WeakMap<Creature, HTMLCanvasElement>();

/** The composed picture (PICTURE_WIDTH x PICTURE_HEIGHT logical px), cached per Friend. */
export function roomPicture(player: Creature) {
  let canvas = pictures.get(player);
  if (canvas) return canvas;
  const room = createRoom(player);
  const made = makeCanvas(PICTURE_WIDTH, PICTURE_HEIGHT);
  const ctx = made.ctx;
  ctx.translate(-CROP[0], -CROP[1]);
  ctx.drawImage(room.base, 0, 0, ART_W * A, ART_H * A);
  ctx.save(); ctx.scale(A, A);
  room.drawDoor(ctx, 0); room.drawGate(ctx, 0); room.drawWindow(ctx, 0);
  ctx.restore();
  // Depth sorted by feet line, like the nursery.
  const art = (draw: () => void) => () => { ctx.save(); ctx.scale(A, A); draw(); ctx.restore(); };
  const layers: { y: number; draw: () => void }[] = [
    ...room.props.map(prop => ({ y: prop.baseY, draw: () => ctx.drawImage(prop.sprite, prop.x * A, prop.y * A, prop.sprite.width * A, prop.sprite.height * A) })),
    { y: room.kioskBaseY, draw: art(() => room.drawKiosk(ctx, STILL)) },
    { y: room.incubatorBaseY, draw: art(() => room.drawIncubator(ctx, STILL)) },
    { y: room.slingshotBaseY, draw: art(() => room.drawSlingshot(ctx, STILL)) },
    { y: SPAWN.y, draw: () => {
      ctx.save(); ctx.scale(A, A); ctx.globalAlpha = 0.13;
      ellipse(ctx, Math.round(SPAWN.x / A), Math.round(SPAWN.y / A) - 1, 8, 2, INK);
      ctx.restore();
      paintCreature(ctx, player, { clip: "idle", facing: "down", frame: 0, x: SPAWN.x, y: SPAWN.y, scale: HERO_SCALE });
    } },
  ];
  layers.sort((a, b) => a.y - b.y);
  for (const layer of layers) layer.draw();
  canvas = made.canvas;
  pictures.set(player, canvas);
  return canvas;
}

/**
 * Paints the picture into `canvas` at its displayed size in device pixels (backing store = CSS width x ratio), so the
 * browser never resamples it. Art pixels of two or more device pixels stay hard edged; smaller ones are filtered down.
 */
export function paintRoomPicture(canvas: HTMLCanvasElement, player: Creature, ratio: number) {
  const width = Math.round(canvas.clientWidth * ratio);
  if (width < 1) return;
  const height = Math.max(1, Math.round((width * PICTURE_HEIGHT) / PICTURE_WIDTH));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = (width / PICTURE_WIDTH) * A < 2;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(roomPicture(player), 0, 0, width, height);
}
