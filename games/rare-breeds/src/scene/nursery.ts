// The walkable nursery: player Friend, following brood, stations, courtship and release scenes.
// The Friend is the star: drawn one step bigger than the brood, and on compact displays a follow
// camera zooms in on it and keeps it centred in the band the UI leaves uncovered.
import { WORLD_HEIGHT, WORLD_WIDTH, type NurseryScene, type NurserySceneOptions } from "../api.ts";
import { TIER_STYLE, type Clip, type Creature, type Facing, type StationId } from "../types.ts";
import { GREEN, HEART, INK, MUTED, PAPER, WHITE, clamp, easeInCubic, easeOutCubic, ellipse, lerp, rect } from "./art.ts";
import { feetRow, headroom, inkSpan, paintCreature } from "./creatures.ts";
import { drawText, textWidth } from "./font.ts";
import { createParticles } from "./fx.ts";
import { createNavigator, pathLength, type Point } from "./nav.ts";
import {
  A, ART_H, ART_W, DOOR_CLIP, DOOR_INSIDE, DOOR_OUTSIDE, GATE_CLIP, GATE_FRONT, GATE_INSIDE, HERO_WALK, MOON_AT, OBSTACLES, SLING_BASE_Y,
  SLING_FRONT, SLING_PULL, SLING_SEAT, SPAWN, STATIONS, WALK, WINDOW_CLIP, createRoom, pouchOffset, type Rect,
} from "./room.ts";
import { createPixelView } from "./view.ts";

const SPEED = 250;
const DASH = 390;
const PLAYER_SCALE = 4, BABY_SCALE = 3;
/** Walk distance per animation frame (bigger bodies take longer strides). */
const PLAYER_STRIDE = 25, BABY_STRIDE = 18;
/** Trail distance from the Friend to the first baby, and between babies. */
const FIRST_GAP = 54, GAP = 42;
/** Feet boxes for pathing and collision (logical px). */
const HERO_FOOT = { half: 15, up: 12, down: 1 }, BABY_FOOT = { half: 11, up: 9, down: 1 };
/** Spawn intro: the Friend drops onto the rug, then the brood pops in. */
const DROP = 460, INTRO = 620;
/** Hearts income: badges alive at once (older ones make way), lifetime and heart flight time (ms). */
const MAX_INCOMES = 6, INCOME_LIFE = 1500, HEART_FLIGHT = 1150;

// Camera. Displays narrower than 600 or lower than 400 CSS px zoom in so the Friend's 16-row frame is
// about HERO_CSS CSS px tall; larger ones show the whole room with no camera motion.
const COMPACT_WIDTH = 600, COMPACT_HEIGHT = 400;
const HERO_CSS = 52, MAX_ZOOM = 2.5;
/**
 * UI chrome drawn over the world, CSS px: the camera centres the Friend between them. The UI can set
 * --rb-world-inset-top / --rb-world-inset-bottom (any CSS length) on an ancestor to override these.
 */
const COMPACT_INSETS = { top: 44, bottom: 88 }, WIDE_INSETS = { top: 62, bottom: 108 };
/** Follow easing (ms time constants) and look-ahead (seconds of the Friend's velocity). */
const CAMERA_EASE = 170, SCENE_EASE = 260, LOOK_EASE = 420, LOOK_AHEAD = 0.32;

const compactZoom = (width: number, height: number, fit: number) =>
  width < COMPACT_WIDTH || height < COMPACT_HEIGHT ? clamp(HERO_CSS / (16 * PLAYER_SCALE * fit), 1, MAX_ZOOM) : 1;

/** A CSS length custom property resolved to px on `host` (null when unset or unresolvable). */
function cssLength(host: HTMLElement, name: string): number | null {
  const raw = getComputedStyle(host).getPropertyValue(name).trim();
  if (!raw) return null;
  if (/^-?\d*\.?\d+px$/.test(raw)) return parseFloat(raw);
  // calc() and other units: let the browser resolve it on a throwaway probe.
  const parent = host.parentElement;
  if (!parent) return null;
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(${name})`;
  parent.append(probe);
  const value = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(value) && value >= 0 ? value : null;
}
const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
};

type Fade = { from: number; to: number; start: number; duration: number };
type Entity = {
  creature: Creature;
  x: number; y: number; vx: number; vy: number;
  facing: Facing; clip: Clip; frame: number;
  scale: number;
  walkDistance: number; idleTime: number; lastStepFrame: number;
  alpha: number; fade: Fade | null;
  hopStart: number; hopHeight: number; hopDuration: number;
  bornAt: number;
  clipRect: Rect | null;
  /** Scripted: drawn this far above its feet line (logical px), and squash / stretch multipliers (1 = none). */
  lift: number; sx: number; sy: number;
  path: Point[]; pathSpeed: number; onArrive: (() => void) | null; bouncy: boolean;
  lookUntil: number; nextIdleAt: number;
  shadowSpan: number; feetOffset: number;
  /** Pop-in effects already played (babies). */
  popped: boolean;
  /** A newborn waits beside the Friend until this time before it joins the line. */
  holdUntil: number;
};

/**
 * Which keys a focused element owns: text fields own every key, arrow-driven widgets own the arrows,
 * buttons and links own Enter and Space. Everything else (including a focused HUD button for WASD) walks.
 */
function keyOwner(target: EventTarget | null): "text" | "arrows" | "press" | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox'], [role='searchbox']")) return "text";
  if (target.closest("input[type=range], [role='slider'], [role='listbox'], [role='radiogroup'], [role='menu'], [role='menubar'], [role='tablist'], [role='grid'], [role='tree']")) return "arrows";
  if (target.closest("button, a[href], summary, input, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='option'], [role='switch'], [role='checkbox']")) return "press";
  return null;
}

function facingFrom(dx: number, dy: number, current: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return current;
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.2 * Math.max(Math.abs(dx), Math.abs(dy))) {
    // Near-diagonal: keep the current facing if it is one of the two components (no flicker).
    if ((current === "left" && dx < 0) || (current === "right" && dx > 0) || (current === "up" && dy < 0) || (current === "down" && dy > 0)) return current;
  }
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
}

function rectDistance(x: number, y: number, [x0, y0, x1, y1]: Rect) {
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

const inside = (x: number, y: number, [x0, y0, x1, y1]: Rect) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

export function createNurseryScene(options: NurserySceneOptions): NurseryScene {
  const { canvas, player: firstPlayer, onStationNear, onStationActivate, onCreatureActivate } = options;
  let reducedMotion = options.reducedMotion;
  let paused = false, destroyed = false, dirty = true;
  const view = createPixelView(canvas, WORLD_WIDTH, WORLD_HEIGHT, { onResize: () => { dirty = true; }, zoomFor: compactZoom });
  const ctx = view.ctx;
  const room = createRoom(firstPlayer);
  /** The Friend and visiting mates path with bigger feet; babies with smaller ones. */
  const heroNav = createNavigator(HERO_WALK, OBSTACLES, HERO_FOOT);
  const nav = createNavigator(WALK, OBSTACLES, BABY_FOOT);
  const navFor = (entity: Entity) => entity.scale >= PLAYER_SCALE ? heroNav : nav;
  const fx = createParticles();

  let time = 0, last = 0, raf = 0;
  let eggs = 0, eggChangedAt = -1e9;
  let near: StationId | null = null, hover: StationId | null = null;
  // The station last used stays "near" while the Friend stands at it, even where a neighbour is closer
  // (tapped Incubator and Sanctuary standing spots can be nearer to the slingshot).
  let chosen: StationId | null = null;
  const pressedAt: Record<StationId, number> = { matchmaker: -1e9, incubator: -1e9, sanctuary: -1e9, slingshot: -1e9 };
  let doorOpen = 0, doorWant = 0, gateOpen = 0, gateWant = 0, windowOpen = 0, windowWant = 0;
  /** The Moon Slingshot's band (see SlingPose). */
  const sling = { pull: 0, snapAt: -1e9, snapPull: 0, loaded: false };
  let inputLock = 0, scripts = 0;
  let pointerKind: "mouse" | "touch" | "pen" | "keyboard" = matchMedia?.("(pointer: coarse)").matches ? "touch" : "keyboard";
  const held = new Map<string, readonly [number, number]>();
  let route: Point[] = [], routeGoal: Point | null = null, routeStarted = -1e9, pendingStation: StationId | null = null, pendingSince = 0;
  let dragId: number | null = null, lastDragPlan = 0;
  let playerIdleFor = 0;
  /** Until the first station is used, a small beacon bobs over the Matchmaker. */
  let guided = false;
  /** The player's nameplate shows during the intro and after tapping the Friend. */
  let tagUntil = 3200, nextLookAt = 5000;
  const debug = { x: "", y: "", near: "", brood: "", babies: "", view: "", incomes: "" };
  /** Camera: top-left of the visible region (logical px), eased look-ahead, and the UI insets (CSS px). */
  const cam = { x: 0, y: 0, lookX: 0, lookY: 0, layout: -1, top: 0, bottom: 0, family: 1 };
  /** The Friend's measured velocity (logical px / s), smoothed, for the look-ahead. */
  const heroVelocity = { x: 0, y: 0 };
  /** Scenes push a framing function; the newest one steers the camera while it runs. */
  const framers: (() => Point)[] = [];
  /** Hearts income in flight: a "+N" badge over the creature and a few pixel hearts heading for the HUD counter. */
  type Income = { key: string; x: number; y: number; start: number; amount: number; hearts: { dx: number; delay: number }[] };
  const incomes: Income[] = [];

  const timers: { at: number; resolve: () => void }[] = [];
  const wait = (ms: number) => new Promise<void>(resolve => { if (destroyed) resolve(); else timers.push({ at: time + ms, resolve }); });
  /** Calls step(t) every running frame, t from 0 to 1 over `ms`, then resolves. */
  const tweens: { start: number; duration: number; step: (t: number) => void; resolve: () => void }[] = [];
  const tween = (ms: number, step: (t: number) => void) => new Promise<void>(resolve => {
    if (destroyed) resolve(); else tweens.push({ start: time, duration: Math.max(1, ms), step, resolve });
  });

  const makeEntity = (creature: Creature, x: number, y: number, scale: number): Entity => {
    const span = inkSpan(creature);
    return {
      creature, x, y, vx: 0, vy: 0, facing: "down", clip: "idle", frame: 0, scale,
      walkDistance: 0, idleTime: Math.random() * 1000, lastStepFrame: -1, alpha: 1, fade: null,
      hopStart: -1e9, hopHeight: 0, hopDuration: 1, bornAt: -1e9, clipRect: null, lift: 0, sx: 1, sy: 1,
      path: [], pathSpeed: 0, onArrive: null, bouncy: false, lookUntil: 0, nextIdleAt: 1500 + Math.random() * 3000,
      shadowSpan: Math.max(4, (span.max - span.min + 1) / 2), feetOffset: (15 - feetRow(creature)) * scale,
      popped: true, holdUntil: 0,
    };
  };

  /** Height from the feet to the top of the sprite, hat included (logical px). */
  const topOf = (entity: Entity) => (16 + headroom(entity.creature)) * entity.scale;
  const player = makeEntity(firstPlayer, SPAWN.x, SPAWN.y, PLAYER_SCALE);
  let brood: Entity[] = [];
  const departing = new Map<string, { entity: Entity; since: number }>();
  /** A baby about to be launched: a "!" pops over its head. */
  let alarmed: Entity | null = null;
  const released = new Set<string>();
  const actors: Entity[] = [];
  const pendingCelebrations = new Map<string, number>();
  // The player's footprints (newest first); babies follow this trail like ducklings. The first trail
  // runs to the right of the spawn and snakes back one row lower, so a big brood starts on the floor.
  const trail: Point[] = [];
  {
    const [x0, , x1, y1] = HERO_WALK;
    let x = SPAWN.x, y = SPAWN.y, direction = 1;
    for (let i = 0; i < 160; i++) {
      x += direction * 6; y += 0.9;
      if (x > x1 - 40 || x < x0 + 40) { direction = -direction; y += 48; x = clamp(x, x0 + 40, x1 - 40); }
      trail.push({ x, y: Math.min(y, y1 - 8) });
    }
  }

  const ball = { x: 646, y: 510, vx: 0, vy: 0, roll: 0, r: 12 };
  const motes = Array.from({ length: 14 }, (_, i) => ({ seed: i * 97.13 }));

  // ------------------------------------------------------------------------------------------
  // Helpers

  const hop = (entity: Entity, height = 12, duration = 320, delay = 0) => {
    if (reducedMotion) return;
    if (time < entity.hopStart + entity.hopDuration) return;
    entity.hopStart = time + delay; entity.hopHeight = height; entity.hopDuration = duration;
  };
  const hopOffset = (entity: Entity) => {
    const t = (time - entity.hopStart) / entity.hopDuration;
    return t >= 0 && t < 1 ? Math.sin(t * Math.PI) * entity.hopHeight : 0;
  };
  const fadeTo = (entity: Entity, to: number, duration: number) => { entity.fade = { from: entity.alpha, to, start: time, duration: Math.max(1, duration) }; };

  const walkPath = (entity: Entity, path: Point[], speed: number, bouncy = false) => new Promise<void>(resolve => {
    if (destroyed || !path.length) { resolve(); return; }
    entity.onArrive?.();
    entity.path = path.map(p => ({ ...p })); entity.pathSpeed = speed; entity.bouncy = bouncy; entity.onArrive = resolve;
  });

  const setNear = (next: StationId | null) => {
    if (next === near) return;
    near = next; dirty = true;
    onStationNear?.(next);
  };

  const activate = (station: StationId) => {
    pressedAt[station] = time; chosen = station;
    guided = true;
    held.clear(); route = []; routeGoal = null; pendingStation = null;
    player.vx = 0; player.vy = 0;
    dirty = true;
    onStationActivate?.(station);
  };

  const stationById = (id: StationId) => STATIONS.find(station => station.id === id)!;

  /** A free spot right beside the Friend, on the side with more of the view, clear of the other babies. */
  const besideSpot = (others: readonly Entity[]): Point | null => {
    const roomRight = view.camera.x + view.viewWidth - player.x, roomLeft = player.x - view.camera.x;
    const first = roomRight >= roomLeft ? 1 : -1;
    for (let rank = 0; rank < 4; rank++) for (const side of [first, -first]) {
      const spot = { x: player.x + side * (16 * PLAYER_SCALE + rank * 16 * BABY_SCALE), y: player.y + 4 };
      if (nav.blocked(spot.x, spot.y) || others.some(baby => Math.hypot(baby.x - spot.x, baby.y - spot.y) < 12 * BABY_SCALE)) continue;
      return spot;
    }
    return null;
  };

  const walkTo = (target: Point, dash = false) => {
    const path = heroNav.route(player, target);
    if (!path) return false;
    route = path; routeGoal = path[path.length - 1]; routeStarted = time;
    player.pathSpeed = dash ? DASH : SPEED;
    return true;
  };

  const goToStation = (id: StationId) => {
    const station = stationById(id);
    const [x0, y0, x1, y1] = station.footprint;
    const approach = { x: clamp(player.x, x0, x1), y: clamp(player.y, y0, y1) };
    // Stand just outside the footprint, on the side facing the player.
    const dx = player.x - approach.x, dy = player.y - approach.y, distance = Math.hypot(dx, dy) || 1;
    const standOff = station.reach - 16;
    let target = { x: approach.x + (dx / distance) * standOff, y: approach.y + (dy / distance) * standOff };
    if (distance < 1) target = { x: (x0 + x1) / 2, y: y1 + standOff };
    if (rectDistance(player.x, player.y, station.footprint) <= station.reach + 70) { activate(id); return; }
    if (walkTo(target, true)) { pendingStation = id; pendingSince = time; }
    else activate(id);
  };

  const entityBox = (entity: Entity): Rect => {
    const size = 16 * entity.scale;
    return [entity.x - size / 2 - 6, entity.y - topOf(entity) - 6 - hopOffset(entity), entity.x + size / 2 + 6, entity.y + 8];
  };

  // ------------------------------------------------------------------------------------------
  // Camera

  /** The point the camera centres for a creature: a little below the middle of its sprite. */
  const focusOf = (entity: Entity): Point => ({ x: entity.x, y: entity.y - 7 * entity.scale });

  const dropFramer = (framer: () => Point) => {
    const index = framers.lastIndexOf(framer);
    if (index >= 0) framers.splice(index, 1);
  };

  /** The visible region and the band between the UI chrome (all logical px). */
  function band() {
    const width = view.viewWidth, height = view.viewHeight, scale = view.cssScale || 1;
    let top = cam.top / scale, bottom = cam.bottom / scale;
    // The chrome never gets more than 55 % of the view.
    const covered = top + bottom, limit = height * 0.55;
    if (covered > limit) { top *= limit / covered; bottom *= limit / covered; }
    return { width, height, top, bottom, inner: height - top - bottom };
  }

  /** Centre both points when they fit; otherwise keep `lead` (the action) framed and lean towards `other`. */
  function frameBoth(lead: Point, other: Point, spreadX = 0.32, spreadY = 0.28): Point {
    const { width, inner } = band();
    const reachX = width * spreadX, reachY = inner * spreadY;
    return {
      x: clamp((lead.x + other.x) / 2, lead.x - reachX, lead.x + reachX),
      y: clamp((lead.y + other.y) / 2, lead.y - reachY, lead.y + reachY),
    };
  }

  /**
   * Following the Friend: centre the family (the Friend and the babies near it), weighted towards the Friend
   * while it walks, but always keep the Friend and its prompt or nameplate inside the band.
   */
  function familyFocus(look: Point): Point {
    const { width, inner } = band();
    const s = labelScale();
    const prompt = !!near && !paused && !inputLock, bubble = prompt && view.zoom > 1;
    const hy0 = player.y - topOf(player) - (prompt ? (bubble ? 10 * s : 17 * s + 14) : 6);
    const side = bubble ? textWidth("TAP", s) + 12 * s + 26 : 0;
    const hx0 = player.x - 8 * PLAYER_SCALE - side, hx1 = player.x + 8 * PLAYER_SCALE + side;
    const hy1 = player.y + (time < tagUntil ? 3 * PLAYER_SCALE + 11 * s + 4 : 8);
    let x0 = hx0, y0 = hy0, x1 = hx1, y1 = hy1;
    for (const baby of brood) {
      if (time < baby.bornAt || Math.hypot(baby.x - player.x, baby.y - player.y) > 300) continue;
      x0 = Math.min(x0, baby.x - 8 * BABY_SCALE); x1 = Math.max(x1, baby.x + 8 * BABY_SCALE);
      y0 = Math.min(y0, baby.y - topOf(baby)); y1 = Math.max(y1, baby.y + 6);
    }
    const w = cam.family;
    const hero = { x: (hx0 + hx1) / 2, y: (hy0 + hy1) / 2 };
    const want = { x: hero.x + ((x0 + x1) / 2 - hero.x) * w + look.x, y: hero.y + ((y0 + y1) / 2 - hero.y) * w + look.y };
    // Always leave some floor showing on every side of the Friend, so a phone player can tap onwards.
    const marginX = Math.min(64, Math.max(0, (width - (hx1 - hx0)) / 2 - 2));
    const marginY = Math.min(36, Math.max(0, (inner - (hy1 - hy0)) / 2 - 2));
    return {
      x: clamp(want.x, hx1 + marginX - width / 2, hx0 - marginX + width / 2),
      y: clamp(want.y, hy1 + marginY - inner / 2, hy0 - marginY + inner / 2),
    };
  }

  /** Camera top-left that centres `point` in the band, clamped so the band stays inside the room. */
  function cameraFor(point: Point): Point {
    const { width, height, top, bottom, inner } = band();
    const x = width >= WORLD_WIDTH - 0.5 ? (WORLD_WIDTH - width) / 2 : clamp(point.x - width / 2, 0, WORLD_WIDTH - width);
    const y = height >= WORLD_HEIGHT - 0.5 ? (WORLD_HEIGHT - height) / 2 : clamp(point.y - top - inner / 2, -top, WORLD_HEIGHT - height + bottom);
    return { x, y };
  }

  function readInsets() {
    const compact = view.zoom > 1;
    const defaults = compact ? COMPACT_INSETS : WIDE_INSETS;
    cam.top = cssLength(canvas, "--rb-world-inset-top") ?? defaults.top;
    cam.bottom = cssLength(canvas, "--rb-world-inset-bottom") ?? defaults.bottom;
    cam.layout = view.layout;
  }

  /** Follow the Friend (or the running scene). snap: jump there (first frame, resize, reduced motion). */
  function updateCamera(dt: number, snap = false) {
    if (cam.layout !== view.layout) { readInsets(); snap = true; }
    const framer = framers[framers.length - 1];
    const scripted = !!framer;
    const { width, inner, top } = band();
    // Frame the whole family when the Friend rests, lean towards the Friend while it walks.
    // (Reduced motion frames the Friend alone, so babies settling never move the camera.)
    const walking = playerIdleFor < 450, weight = reducedMotion ? 0 : walking ? 0.3 : 1;
    cam.family = snap || reducedMotion ? weight : cam.family + (weight - cam.family) * (1 - Math.exp(-dt / 600));
    if (reducedMotion) {
      // Snap, and only once the target leaves a calm middle zone, so the room does not scroll constantly.
      cam.lookX = 0; cam.lookY = 0;
      const target = framer ? framer() : familyFocus({ x: 0, y: 0 });
      const current = { x: cam.x + width / 2, y: cam.y + top + inner / 2 };
      const zoneX = snap ? 0 : width * 0.16, zoneY = snap ? 0 : inner * 0.18;
      const next = cameraFor({ x: clamp(current.x, target.x - zoneX, target.x + zoneX), y: clamp(current.y, target.y - zoneY, target.y + zoneY) });
      cam.x = next.x; cam.y = next.y;
      return;
    }
    // A small look-ahead in the direction the Friend walks (none while a scene frames the action).
    const wantX = scripted ? 0 : clamp(heroVelocity.x * LOOK_AHEAD, -width * 0.14, width * 0.14);
    const wantY = scripted ? 0 : clamp(heroVelocity.y * LOOK_AHEAD, -inner * 0.12, inner * 0.12);
    const look = snap ? 1 : 1 - Math.exp(-dt / LOOK_EASE);
    cam.lookX += (wantX - cam.lookX) * look;
    cam.lookY += (wantY - cam.lookY) * look;
    const goal = cameraFor(framer ? framer() : familyFocus({ x: cam.lookX, y: cam.lookY }));
    const follow = snap ? 1 : 1 - Math.exp(-dt / (scripted ? SCENE_EASE : CAMERA_EASE));
    cam.x += (goal.x - cam.x) * follow;
    cam.y += (goal.y - cam.y) * follow;
    if (Math.abs(goal.x - cam.x) < 0.05) cam.x = goal.x;
    if (Math.abs(goal.y - cam.y) < 0.05) cam.y = goal.y;
  }

  // ------------------------------------------------------------------------------------------
  // Input

  const onKeyDown = (event: KeyboardEvent) => {
    if (destroyed || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const owner = keyOwner(event.target);
    if (owner === "text") return;
    const direction = DIRECTIONS[event.code] ?? DIRECTIONS[event.key];
    if (direction && owner === "arrows" && event.key.startsWith("Arrow")) return;
    if (!direction && owner && (event.key === "Enter" || event.key === " " || event.code === "Space")) return;
    if (direction) {
      event.preventDefault();
      if (paused || inputLock) return;
      held.set(event.code || event.key, direction);
      route = []; routeGoal = null; pendingStation = null; pointerKind = "keyboard";
      return;
    }
    const activateKey = event.code === "KeyE" || event.key === "e" || event.key === "E" || event.key === "Enter" || event.code === "Space" || event.key === " ";
    if (!activateKey) return;
    if (paused || inputLock) { if (event.code === "Space") event.preventDefault(); return; }
    pointerKind = "keyboard";
    if (event.repeat) { if (near) event.preventDefault(); return; }
    if (near) { event.preventDefault(); activate(near); return; }
    if (event.key !== "Enter") { event.preventDefault(); hopChain(); }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (held.delete(event.code || event.key)) event.preventDefault();
  };
  const stopHeld = () => { held.clear(); dragId = null; };
  const onVisibility = () => { if (document.hidden) stopHeld(); };

  const hitBaby = (x: number, y: number, slop: number) => {
    let best: Entity | null = null, bestDistance = Infinity;
    for (const baby of brood) {
      const [x0, y0, x1, y1] = entityBox(baby);
      if (x < x0 - slop || x > x1 + slop || y < y0 - slop || y > y1 + slop) continue;
      const distance = Math.hypot(x - baby.x, y - (baby.y - 7 * baby.scale));
      if (distance < bestDistance) { bestDistance = distance; best = baby; }
    }
    return best;
  };
  const hitStation = (x: number, y: number) => STATIONS.find(station => inside(x, y, station.hit))?.id ?? null;

  const onPointerDown = (event: PointerEvent) => {
    if (destroyed || paused || inputLock || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointerKind = event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse";
    const { x, y } = view.toLogical(event.clientX, event.clientY);
    // Touch slop is about 15 CSS px whatever the zoom.
    const slop = event.pointerType === "mouse" ? 2 : Math.min(40, 15 / view.cssScale);
    if (near && promptBox && inside(x, y, [promptBox[0] - slop, promptBox[1] - slop, promptBox[2] + slop, promptBox[3] + slop])) { activate(near); return; }
    if (beaconBox && inside(x, y, beaconBox)) { goToStation("matchmaker"); return; }
    const baby = hitBaby(x, y, slop);
    if (baby) { hop(baby, 12, 300); onCreatureActivate?.(baby.creature.key); dirty = true; return; }
    if (inside(x, y, entityBox(player))) { hopChain(); fx.hearts(player.x, player.y - topOf(player) - 4, 1, 6); tagUntil = time + 2200; return; }
    const station = hitStation(x, y);
    if (station) { goToStation(station); return; }
    if (walkTo({ x, y })) {
      dragId = event.pointerId; lastDragPlan = time;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (destroyed) return;
    const { x, y } = view.toLogical(event.clientX, event.clientY);
    if (event.pointerType === "mouse" && !paused) {
      const station = hitStation(x, y);
      const onBaby = !!hitBaby(x, y, 2) || inside(x, y, entityBox(player));
      const onPrompt = !!(near && promptBox && inside(x, y, promptBox)) || !!(beaconBox && inside(x, y, beaconBox));
      if (station !== hover) { hover = station; dirty = true; }
      canvas.style.cursor = station || onBaby || onPrompt ? "pointer" : "";
    }
    if (dragId === event.pointerId && !paused && !inputLock && time - lastDragPlan > 90) {
      lastDragPlan = time;
      walkTo({ x, y });
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (dragId === event.pointerId) dragId = null;
  };
  const onPointerLeave = () => { if (hover) { hover = null; dirty = true; } canvas.style.cursor = ""; };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", stopHeld);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("lostpointercapture", onPointerUp);
  if (!canvas.hasAttribute("aria-label")) canvas.setAttribute("aria-label", "Nursery. Walk with arrow keys or WASD, or tap the floor. Press E near a station.");

  function hopChain() {
    if (reducedMotion) return;
    hop(player, 18, 340);
    brood.forEach((baby, index) => hop(baby, 12, 300, 90 + index * 80));
  }

  // ------------------------------------------------------------------------------------------
  // Simulation

  const moveWithCollision = (entity: Entity, dx: number, dy: number) => {
    const { blocked } = navFor(entity);
    let moved = false;
    if (dx && !blocked(entity.x + dx, entity.y + dy)) { entity.x += dx; entity.y += dy; return true; }
    if (dx && !blocked(entity.x + dx, entity.y)) { entity.x += dx; moved = true; }
    if (dy && !blocked(entity.x, entity.y + dy)) { entity.y += dy; moved = true; }
    return moved;
  };

  const animate = (entity: Entity, dt: number, speed: number, stride: number) => {
    if (speed > 18) {
      if (entity.clip !== "walk") { entity.clip = "walk"; entity.walkDistance = stride * 0.99; }
      entity.walkDistance += speed * (dt / 1000);
      entity.frame = Math.floor(entity.walkDistance / stride) % 8;
      entity.idleTime = 0;
      if ((entity.frame === 1 || entity.frame === 5) && entity.lastStepFrame !== entity.frame && !reducedMotion && entity.alpha > 0.5 && !entity.clipRect) {
        const direction = entity.facing === "left" ? -1 : entity.facing === "right" ? 1 : 0;
        fx.dust(entity.x - direction * 2 * entity.scale, entity.y, direction, entity.scale >= PLAYER_SCALE ? 1.2 : 0.9);
      }
      entity.lastStepFrame = entity.frame;
    } else {
      if (entity.clip !== "idle") { entity.clip = "idle"; entity.idleTime = 0; }
      entity.idleTime += dt;
      entity.frame = reducedMotion ? 0 : Math.floor(entity.idleTime / 150) % 8;
      entity.lastStepFrame = -1;
    }
  };

  const followPath = (entity: Entity, dt: number) => {
    if (!entity.path.length) return 0;
    let budget = entity.pathSpeed * (dt / 1000), travelled = 0;
    while (budget > 0 && entity.path.length) {
      const target = entity.path[0];
      const dx = target.x - entity.x, dy = target.y - entity.y, distance = Math.hypot(dx, dy);
      if (distance > 0.5) entity.facing = facingFrom(dx, dy, entity.facing);
      if (distance <= budget) { entity.x = target.x; entity.y = target.y; budget -= distance; travelled += distance; entity.path.shift(); }
      else { entity.x += (dx / distance) * budget; entity.y += (dy / distance) * budget; travelled += budget; budget = 0; }
    }
    if (!entity.path.length) { const done = entity.onArrive; entity.onArrive = null; done?.(); }
    return travelled / (dt / 1000);
  };

  function updatePlayer(dt: number) {
    const seconds = dt / 1000;
    let ix = 0, iy = 0;
    if (!paused && !inputLock) for (const [dx, dy] of held.values()) { ix += dx; iy += dy; }
    let tx = 0, ty = 0;
    if (ix || iy) {
      const length = Math.hypot(ix, iy);
      tx = (ix / length) * SPEED; ty = (iy / length) * SPEED;
      player.facing = facingFrom(ix, iy, player.facing);
    } else if (route.length && !paused && !inputLock) {
      const target = route[0];
      const dx = target.x - player.x, dy = target.y - player.y, distance = Math.hypot(dx, dy);
      const final = route.length === 1;
      if (distance < (final ? 2 : 6)) {
        route.shift();
        if (!route.length) { routeGoal = null; player.vx *= 0.3; player.vy *= 0.3; }
      } else {
        const speed = final ? Math.min(player.pathSpeed, distance * 9 + 40) : player.pathSpeed;
        tx = (dx / distance) * speed; ty = (dy / distance) * speed;
        player.facing = facingFrom(dx, dy, player.facing);
      }
      if (time - routeStarted > 6000) { route = []; routeGoal = null; }
    }
    const response = 1 - Math.exp(-dt / (tx || ty ? 45 : 30));
    player.vx += (tx - player.vx) * response;
    player.vy += (ty - player.vy) * response;
    if (Math.hypot(player.vx, player.vy) < 4 && !tx && !ty) { player.vx = 0; player.vy = 0; }
    const before = { x: player.x, y: player.y };
    if (player.vx || player.vy) {
      const moved = moveWithCollision(player, player.vx * seconds, player.vy * seconds);
      if (!moved && route.length) {
        // Something (usually the ball) is in the way: re-plan once, then give up.
        const goal = routeGoal;
        route = [];
        if (goal && time - routeStarted < 5000) { const path = heroNav.route(player, goal); if (path) route = path; }
      }
    }
    const speed = Math.hypot(player.x - before.x, player.y - before.y) / Math.max(seconds, 1e-6);
    const follow = 1 - Math.exp(-dt / 90);
    heroVelocity.x += ((player.x - before.x) / Math.max(seconds, 1e-6) - heroVelocity.x) * follow;
    heroVelocity.y += ((player.y - before.y) / Math.max(seconds, 1e-6) - heroVelocity.y) * follow;
    animate(player, dt, speed, PLAYER_STRIDE);
    playerIdleFor = speed > 18 ? 0 : playerIdleFor + dt;
    if (playerIdleFor > 4500 && time > nextLookAt && !inputLock && !reducedMotion) {
      nextLookAt = time + 1600 + Math.random() * 2600;
      const looks: Facing[] = player.facing === "down" ? ["left", "right"] : ["down"];
      player.facing = looks[Math.floor(Math.random() * looks.length)];
    } else if (playerIdleFor < 100) nextLookAt = Math.max(nextLookAt, time + 3000);
    // Trail.
    const head = trail[0];
    if (!head || Math.hypot(player.x - head.x, player.y - head.y) >= 4) {
      trail.unshift({ x: player.x, y: player.y });
      const needed = FIRST_GAP + GAP * (brood.length + 2) + 60;
      let total = 0;
      for (let i = 1; i < trail.length; i++) {
        total += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
        if (total > needed) { trail.length = i + 1; break; }
      }
    }
    // Arrived at a tapped station?
    if (pendingStation) {
      const station = stationById(pendingStation);
      if (rectDistance(player.x, player.y, station.footprint) <= station.reach || (!route.length && time - pendingSince > 200) || time - pendingSince > 2600) {
        const id = pendingStation;
        pendingStation = null;
        const [x0, y0, x1, y1] = station.footprint;
        player.facing = facingFrom((x0 + x1) / 2 - player.x, (y0 + y1) / 2 - player.y, player.facing);
        if (rectDistance(player.x, player.y, station.footprint) <= station.reach + 24) activate(id);
      }
    }
  }

  const trailPoint = (distance: number): Point => {
    let previous: Point = { x: player.x, y: player.y }, total = 0;
    for (const point of trail) {
      const segment = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (total + segment >= distance && segment > 0) {
        const t = (distance - total) / segment;
        return { x: previous.x + (point.x - previous.x) * t, y: previous.y + (point.y - previous.y) * t };
      }
      total += segment; previous = point;
    }
    return previous;
  };

  /**
   * When the Friend rests, the brood gathers beside it in a row (alternating sides, starting on the side the
   * line already trails on), so the whole family fits the camera. null: that spot is blocked, keep trailing.
   */
  const gatherSpot = (index: number, lead: number): Point | null => {
    const side = index % 2 === 0 ? lead : -lead, rank = index >> 1;
    const spot = { x: player.x + side * (16 * PLAYER_SCALE + rank * 16 * BABY_SCALE), y: player.y + 4 + rank * 6 };
    return nav.blocked(spot.x, spot.y) ? null : spot;
  };

  function updateBrood(dt: number) {
    const seconds = dt / 1000;
    const gathered = playerIdleFor > 900 && !inputLock && !paused;
    const lead = trailPoint(FIRST_GAP).x >= player.x ? 1 : -1;
    brood.forEach((baby, index) => {
      if (time < baby.bornAt) return;
      if (!baby.popped) {
        baby.popped = true;
        if (!reducedMotion) { fx.puff(baby.x, baby.y, 10, 28); fx.sparkles(baby.x, baby.y - 24, 4, 30, GREEN, 3, 50); }
        if (pendingCelebrations.delete(baby.creature.key)) celebrateEntity(baby);
      }
      if (time < baby.holdUntil) {
        // A newborn has its moment beside the Friend (and in the camera), then joins the line.
        animate(baby, dt, 0, BABY_STRIDE);
        baby.facing = facingFrom(player.x - baby.x, player.y - baby.y, baby.facing);
        return;
      }
      const target = (gathered && gatherSpot(index, lead)) || trailPoint(FIRST_GAP + GAP * index);
      const dx = target.x - baby.x, dy = target.y - baby.y, distance = Math.hypot(dx, dy);
      let speed = 0;
      if (distance > 1.2) {
        // Gathering is an unhurried waddle; catching up with the line can be a scamper.
        const step = Math.min(distance, Math.min(distance * (gathered ? 5 : 9), gathered ? 200 : 420) * seconds);
        baby.x += (dx / distance) * step; baby.y += (dy / distance) * step;
        speed = step / seconds;
        if (distance > 2.5) baby.facing = facingFrom(dx, dy, baby.facing);
      }
      animate(baby, dt, speed, BABY_STRIDE);
      // Keep a little personal space from the parent.
      const px = baby.x - player.x, py = (baby.y - player.y) * 1.5, pd = Math.hypot(px, py);
      if (pd < 40 && pd > 0.01 && time >= baby.bornAt) {
        const push = (40 - pd) * 0.3;
        const nx = baby.x + (px / pd) * push, ny = baby.y + (py / pd) * push / 1.5;
        if (!nav.blocked(nx, ny)) { baby.x = nx; baby.y = ny; }
      }
      if (speed <= 18 && !reducedMotion) {
        // Idle life: look at the player, sometimes look around or hop.
        if (time > baby.lookUntil && playerIdleFor > 350) {
          const toPlayer = facingFrom(player.x - baby.x, player.y - baby.y, baby.facing);
          baby.facing = toPlayer;
        }
        baby.nextIdleAt -= dt;
        if (baby.nextIdleAt <= 0 && playerIdleFor > 1200) {
          baby.nextIdleAt = 2200 + Math.random() * 4200;
          if (Math.random() < 0.45) hop(baby, 10 + Math.random() * 6, 280);
          else {
            const look: Facing[] = ["left", "right", "down", "up"];
            baby.facing = look[Math.floor(Math.random() * look.length)];
            baby.lookUntil = time + 700 + Math.random() * 600;
          }
        }
      }
    });
    // Siblings never stack on the same spot (the trail can double back on itself).
    for (let i = 0; i < brood.length; i++) for (let j = i + 1; j < brood.length; j++) {
      const a = brood[i], b = brood[j];
      if (time < a.bornAt || time < b.bornAt) continue;
      const dx = b.x - a.x, dy = (b.y - a.y) * 1.5, distance = Math.hypot(dx, dy);
      if (distance >= 30) continue;
      const nx = distance > 0.01 ? dx / distance : 1, ny = distance > 0.01 ? dy / distance : 0;
      const push = (30 - distance) * 0.18;
      if (!nav.blocked(a.x - nx * push, a.y - (ny * push) / 1.5)) { a.x -= nx * push; a.y -= (ny * push) / 1.5; }
      if (!nav.blocked(b.x + nx * push, b.y + (ny * push) / 1.5)) { b.x += nx * push; b.y += (ny * push) / 1.5; }
    }
    // Babies removed without a release scene wait briefly (playRelease may follow), then poof away.
    for (const [key, entry] of departing) {
      animate(entry.entity, dt, 0, BABY_STRIDE);
      if (time - entry.since > 1200 && !released.has(key)) {
        departing.delete(key);
        if (!reducedMotion) { fx.puff(entry.entity.x, entry.entity.y, 8, 26); fx.sparkles(entry.entity.x, entry.entity.y - 22, 4, 20, GREEN, 3); }
      }
    }
  }

  function updateActors(dt: number) {
    for (const actor of actors) {
      const speed = followPath(actor, dt);
      animate(actor, dt, speed, actor.scale >= PLAYER_SCALE ? PLAYER_STRIDE - 3 : BABY_STRIDE - 2);
    }
  }

  function updateFades() {
    for (const entity of [player, ...brood, ...actors]) {
      if (!entity.fade) continue;
      const t = clamp((time - entity.fade.start) / entity.fade.duration);
      entity.alpha = entity.fade.from + (entity.fade.to - entity.fade.from) * t;
      if (t >= 1) entity.fade = null;
    }
  }

  function updateBall(dt: number) {
    const seconds = dt / 1000;
    for (const entity of [player, ...brood, ...actors]) {
      if (entity.alpha < 0.5 || entity.clipRect || entity.lift > 0) continue;
      const dx = ball.x - entity.x, dy = ball.y - (entity.y - 4), distance = Math.hypot(dx, dy);
      const reach = ball.r + (entity.scale >= PLAYER_SCALE ? 17 : 12);
      if (distance < reach && distance > 0.01) {
        const nx = dx / distance, ny = dy / distance;
        ball.x = entity.x + nx * reach; ball.y = entity.y - 4 + ny * reach;
        const push = Math.max(160, Math.hypot(entity.vx, entity.vy) * 1.5 + 80);
        const along = ball.vx * nx + ball.vy * ny;
        if (along < push) { ball.vx += nx * (push - along); ball.vy += ny * (push - along); }
      }
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed < 3) { ball.vx = 0; ball.vy = 0; return; }
    const blockedAt = (x: number, y: number) => nav.blocked(x, y + 4);
    const nx = ball.x + ball.vx * seconds, ny = ball.y + ball.vy * seconds;
    if (blockedAt(nx, ball.y)) ball.vx *= -0.65; else ball.x = nx;
    if (blockedAt(ball.x, ny)) ball.vy *= -0.65; else ball.y = ny;
    const damping = Math.exp(-1.6 * seconds);
    ball.vx *= damping; ball.vy *= damping;
    ball.roll += (ball.vx / ball.r) * seconds;
  }

  function updateNear() {
    // The current station keeps a 14 px lead in reach and in distance, so neighbours (incubator, slingshot) never flicker.
    if (chosen) {
      const station = stationById(chosen);
      if (rectDistance(player.x, player.y, station.footprint) <= station.reach + 24) { setNear(chosen); return; }
      chosen = null;
    }
    let best: StationId | null = null, bestDistance = Infinity;
    for (const station of STATIONS) {
      const sticky = station.id === near ? 14 : 0;
      const distance = rectDistance(player.x, player.y, station.footprint);
      if (distance <= station.reach + sticky && distance - sticky < bestDistance) { best = station.id; bestDistance = distance - sticky; }
    }
    setNear(best);
  }

  function update(dt: number) {
    if (!reducedMotion && time - dt < DROP && time >= DROP) {
      fx.puff(player.x, player.y, 14, 56);
      fx.ring(player.x, player.y - 4, 74, INK, 3, 320);
    }
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= time) { const { resolve } = timers[i]; timers.splice(i, 1); resolve(); }
    for (let i = tweens.length - 1; i >= 0; i--) {
      const item = tweens[i], t = clamp((time - item.start) / item.duration);
      item.step(t);
      if (t >= 1) { tweens.splice(i, 1); item.resolve(); }
    }
    const doorStep = dt / (reducedMotion ? 1 : 160);
    doorOpen = doorWant > doorOpen ? Math.min(doorWant, doorOpen + doorStep) : Math.max(doorWant, doorOpen - doorStep);
    const gateStep = dt / (reducedMotion ? 1 : 260);
    gateOpen = gateWant > gateOpen ? Math.min(gateWant, gateOpen + gateStep) : Math.max(gateWant, gateOpen - gateStep);
    const windowStep = dt / (reducedMotion ? 1 : 130);
    windowOpen = windowWant > windowOpen ? Math.min(windowWant, windowOpen + windowStep) : Math.max(windowWant, windowOpen - windowStep);
    updatePlayer(dt);
    updateBrood(dt);
    updateActors(dt);
    updateFades();
    updateBall(dt);
    if (!paused) updateNear();
    fx.update(dt);
    for (let i = incomes.length - 1; i >= 0; i--) if (time - incomes[i].start > INCOME_LIFE) incomes.splice(i, 1);
    updateCamera(dt);
  }

  // ------------------------------------------------------------------------------------------
  // Rendering

  let promptBox: Rect | null = null;

  const popScale = (entity: Entity) => {
    if (reducedMotion) return { sx: 1, sy: 1, visible: time >= entity.bornAt };
    const t = (time - entity.bornAt) / 460;
    if (t <= 0) return { sx: 1, sy: 1, visible: false };
    if (t >= 1) return { sx: 1, sy: 1, visible: true };
    let sy: number;
    if (t < 0.35) sy = 0.2 + (t / 0.35) * 1.15;
    else if (t < 0.6) sy = 1.35 - ((t - 0.35) / 0.25) * 0.5;
    else sy = 0.85 + ((t - 0.6) / 0.4) * 0.15;
    return { sx: 1 / Math.sqrt(sy), sy, visible: true };
  };

  const landingSquash = (entity: Entity) => {
    if (reducedMotion) return { sx: 1, sy: 1 };
    const t = (time - entity.hopStart) / entity.hopDuration;
    if (t < 0 || t > 1.35) return { sx: 1, sy: 1 };
    if (t < 0.12) return { sx: 1.12, sy: 0.88 };
    if (t < 0.5) return { sx: 0.92, sy: 1.1 };
    if (t > 1) return { sx: 1.14, sy: 0.86 };
    return { sx: 1, sy: 1 };
  };

  function drawShadow(entity: Entity, visible: boolean) {
    if (!visible || entity.alpha < 0.05 || entity.clipRect || entity.lift > 60) return;
    const lift = Math.min(40, hopOffset(entity) + dropOffset(entity) * 0.15 + entity.lift);
    const span = (entity.shadowSpan * entity.scale) / A;
    const rx = Math.max(3, Math.round(span * (1 - lift / 50) + 1));
    ctx.save();
    ctx.scale(A, A);
    ctx.globalAlpha = 0.13 * entity.alpha;
    ellipse(ctx, Math.round(entity.x / A), Math.round((entity.y - entity.feetOffset) / A) - 1, rx, 2, INK);
    ctx.globalAlpha = 0.12 * entity.alpha;
    ellipse(ctx, Math.round(entity.x / A), Math.round((entity.y - entity.feetOffset) / A) - 1, Math.max(2, rx - 2), 1, INK);
    ctx.restore();
  }

  const dropOffset = (entity: Entity) => entity === player && !reducedMotion && time < DROP ? Math.pow(1 - time / DROP, 2) * 300 : 0;

  function drawEntity(entity: Entity) {
    const pop = entity === player ? { sx: 1, sy: 1, visible: true } : popScale(entity);
    if (!pop.visible || entity.alpha <= 0.01) return;
    let land = landingSquash(entity);
    if (entity === player && !reducedMotion) {
      if (time < DROP) land = { sx: 0.9, sy: 1.14 };
      else if (time < DROP + 90) land = { sx: 1.22, sy: 0.8 };
      else if (time < DROP + 200) land = { sx: 0.94, sy: 1.07 };
    }
    let bob = 0;
    if (!reducedMotion && entity.clip === "walk" && entity !== player) bob = Math.abs(Math.sin((entity.walkDistance / BABY_STRIDE) * Math.PI)) * (entity.bouncy ? 9 : 3);
    if (!reducedMotion && entity.clip === "walk" && entity.bouncy && entity.scale >= PLAYER_SCALE) bob = Math.abs(Math.sin((entity.walkDistance / 30) * Math.PI)) * 11;
    const y = Math.round(entity.y - hopOffset(entity) - bob - dropOffset(entity) - entity.lift);
    if (entity.clipRect) {
      const [x0, y0, x1, y1] = entity.clipRect;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    }
    paintCreature(ctx, entity.creature, {
      clip: entity.clip, facing: entity.facing, frame: entity.frame, x: Math.round(entity.x), y, scale: entity.scale,
      alpha: entity.alpha, sx: pop.sx * land.sx * entity.sx, sy: pop.sy * land.sy * entity.sy, time,
    });
    if (entity.clipRect) ctx.restore();
  }

  function drawBall() {
    const bx = Math.round(ball.x / A), by = Math.round(ball.y / A);
    ctx.save();
    ctx.scale(A, A);
    ctx.globalAlpha = 0.14;
    ellipse(ctx, bx, by + 4, 4, 1, INK);
    ctx.globalAlpha = 1;
    ellipse(ctx, bx, by, 4, 4, INK);
    ellipse(ctx, bx, by, 3, 3, WHITE);
    // Stripe rolls with the ball.
    const offset = Math.round(((ball.roll % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 8) - 4;
    for (let dy = -3; dy <= 3; dy++) {
      const sx = bx + offset + Math.round(dy * 0.3);
      for (const w of [0, 1]) {
        const px = sx + w;
        if (Math.hypot(px - bx, dy) <= 3.2) rect(ctx, px, by + dy, 1, 1, GREEN);
      }
    }
    rect(ctx, bx - 2, by - 2, 1, 1, WHITE);
    ctx.restore();
  }

  function drawMarker() {
    if (!routeGoal || reducedMotion) {
      if (routeGoal && reducedMotion) { ctx.save(); ctx.scale(A, A); rect(ctx, Math.round(routeGoal.x / A) - 1, Math.round(routeGoal.y / A) - 1, 2, 2, INK); ctx.restore(); }
      return;
    }
    const age = time - routeStarted;
    const t = clamp(age / 260);
    const spread = Math.round(6 - easeOutCubic(t) * 3);
    const gx = Math.round(routeGoal.x / A), gy = Math.round(routeGoal.y / A) - 1;
    ctx.save(); ctx.scale(A, A);
    ctx.globalAlpha = 0.85;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const cx = gx + sx * spread, cy = gy + Math.round(sy * spread * 0.55);
      rect(ctx, cx - (sx > 0 ? 1 : 0), cy, 2, 1, INK);
      rect(ctx, cx, cy - (sy > 0 ? 1 : 0), 1, 2, INK);
    }
    rect(ctx, gx, gy, 1, 1, GREEN);
    ctx.restore();
  }

  function drawMotes() {
    if (reducedMotion) return;
    ctx.save(); ctx.scale(A, A);
    for (const mote of motes) {
      const window = mote.seed % 2 < 1 ? 108 : 190;
      const t = time / 1000;
      const x = window + 3 + ((mote.seed * 13 + t * 2.2) % 26) + Math.sin(t * 0.7 + mote.seed) * 3;
      const y = 60 + ((mote.seed * 7 + t * 1.3) % 24) + Math.sin(t * 1.1 + mote.seed * 2) * 2;
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + mote.seed);
      ctx.globalAlpha = 0.25 + twinkle * 0.45;
      rect(ctx, Math.round(x + Math.floor((y - 56) * 0.6)), Math.round(y), 1, 1, MUTED);
    }
    ctx.restore();
  }

  const BEACON = ["..###..", ".#GGG#.", "#GGGGG#", ".#GGG#.", "..#G#..", "...#..."];
  /** Art position of the beacon over the Matchmaker. */
  const BEACON_AT = { x: 31, y: 45 };
  const ARROWS: Readonly<Record<"left" | "right" | "up" | "down", readonly string[]>> = {
    left: ["..#", ".##", "###", ".##", "..#"], right: ["#..", "##.", "###", "##.", "#.."],
    up: ["..#..", ".###.", "#####"], down: ["#####", ".###.", "..#.."],
  };
  const paintArt = (rows: readonly string[], x: number, y: number) => rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== ".") rect(ctx, x + i * A, y + j * A, A, A, row[i] === "#" ? INK : GREEN);
  });
  let beaconBox: Rect | null = null;

  function drawBeacon() {
    beaconBox = null;
    if (guided || near || paused) return;
    const bob = reducedMotion ? 0 : Math.round((Math.sin(time / 240) + 1) * 1.5);
    const bx = BEACON_AT.x * A, by = BEACON_AT.y * A, w = 7 * A, h = 6 * A;
    const { width, top, bottom, height } = band();
    const left = view.camera.x + 10, right = view.camera.x + width - 10, upper = view.camera.y + top + 10, lower = view.camera.y + height - bottom - 10;
    if (bx >= left && bx + w <= right && by >= upper && by + h <= lower) {
      paintArt(BEACON, bx, by + bob * A);
      return;
    }
    // Off screen (zoomed in): pin the beacon to the edge of the band, with an arrow towards the Matchmaker.
    const x = clamp(bx, left + 5 * A, right - w - 5 * A), y = clamp(by, upper + 4 * A, lower - h - 4 * A);
    const dx = bx - x, dy = by - y;
    const direction = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    const nudge = reducedMotion ? 0 : Math.round(Math.sin(time / 240) * 1.5 + 1.5) * 2;
    const [ox, oy] = direction === "left" ? [-nudge, 0] : direction === "right" ? [nudge, 0] : direction === "up" ? [0, -nudge] : [0, nudge];
    const arrow = ARROWS[direction];
    const ax = direction === "left" ? x - 4 * A : direction === "right" ? x + w + A : x + A;
    const ay = direction === "up" ? y - 4 * A : direction === "down" ? y + h + A : y + A / 2;
    paintArt(BEACON, x + ox, y + oy);
    paintArt(arrow, ax + ox, ay + oy);
    beaconBox = [Math.min(x, ax) - 8, Math.min(y, ay) - 8, Math.max(x + w, ax + arrow[0].length * A) + 8, Math.max(y + h, ay + arrow.length * A) + 8];
  }

  const BUTTERFLY = [
    ["#.#.#", "GG#GG", "#G#G#", ".#.#."],
    [".....", "#G#G#", ".G#G.", "..#.."],
  ];
  function drawButterfly() {
    if (reducedMotion) return;
    const t = time / 1000;
    const x = 762 + Math.sin(t * 0.55) * 70 + Math.sin(t * 1.7) * 14;
    const y = 214 + Math.sin(t * 0.9) * 22 + Math.sin(t * 3.1) * 6;
    const sprite = BUTTERFLY[Math.floor(time / 110) % 2];
    ctx.save(); ctx.scale(A, A);
    const bx = Math.round(x / A) - 2, by = Math.round(y / A);
    sprite.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== ".") rect(ctx, bx + i, by + j, 1, 1, row[i] === "#" ? INK : GREEN); });
    ctx.globalAlpha = 0.12;
    rect(ctx, bx + 1, Math.round(250 / A) + Math.round(Math.sin(t * 0.9) * 2), 3, 1, INK);
    ctx.restore();
  }

  /** Pixel font scale: at least about 1.6 CSS px per font pixel, whatever the zoom. */
  const labelScale = () => clamp(Math.ceil(1.6 / (view.cssScale || 1)), 2, 4);

  /** Badge size for an amount at pixel font scale s: "♥+N" in an ink pill. */
  const badgeSize = (amount: number, s: number) => ({
    glyph: textWidth("♥", s) + s * 2,
    width: s * 3 + textWidth("♥", s) + s * 2 + textWidth(`+${amount}`, s) + s * 3,
    height: 7 * s + s * 4,
  });

  /**
   * Hearts income. A small ink badge "♥+N" pops over the creature and rises a little; one to three pixel
   * hearts burst out of its heart glyph, then speed off towards the HUD heart counter (top-left of the
   * screen) and fade before they reach it. Reduced motion: the badge only, fading in and out in place.
   */
  function drawIncome() {
    if (!incomes.length) return;
    const s = labelScale(), cssScale = view.cssScale || 1;
    const { width: viewWidth } = band();
    // The HUD heart icon centre in CSS px (measured: compact pill 23/24, wide pill 33/36).
    const [iconX, iconY] = view.zoom > 1 ? [23, 24] : [33, 36];
    const target = { x: view.camera.x + iconX / cssScale, y: view.camera.y + iconY / cssScale };
    for (const item of incomes) {
      const age = time - item.start;
      const { glyph, width, height } = badgeSize(item.amount, s);
      const lift = reducedMotion ? 0 : Math.round(easeOutCubic(clamp(age / 700)) * 14);
      const x = Math.round(clamp(item.x - width / 2, view.camera.x + 6, view.camera.x + viewWidth - width - 6));
      const y = Math.round(item.y - height - 6 - lift);
      // Hearts first, so they come out from behind the badge.
      for (const [index, heart] of item.hearts.entries()) {
        const t = (age - heart.delay) / HEART_FLIGHT;
        if (t <= 0 || t >= 1) continue;
        const burst = easeOutCubic(Math.min(1, t / 0.25));
        const origin = { x: x + s * 5.5, y: y + height / 2 + s * 3 };
        const from = { x: origin.x + (heart.dx - 12) * burst, y: origin.y - (16 + index * 8) * burst };
        let hx = from.x, hy = from.y;
        if (t > 0.25) {
          // Off to the counter: accelerate along a gentle arc and stop short of the HUD.
          const u = easeInCubic((t - 0.25) / 0.75);
          const end = { x: from.x + (target.x - from.x) * 0.82, y: from.y + (target.y - from.y) * 0.82 };
          const control = { x: from.x + (end.x - from.x) * 0.2, y: Math.min(from.y, end.y) - 30 };
          hx = (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * control.x + u * u * end.x;
          hy = (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * control.y + u * u * end.y;
        }
        const px = t < 0.08 ? 1 : 2;
        ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        ctx.drawImage(HEART, Math.round(hx - (HEART.width * px) / 2), Math.round(hy - HEART.height * px), HEART.width * px, HEART.height * px);
      }
      // The badge.
      const fadeIn = clamp(age / 110), fadeOut = clamp(((reducedMotion ? 1000 : 1150) - age) / 300);
      const alpha = Math.min(fadeIn, fadeOut);
      if (alpha <= 0) continue;
      const amount = `+${item.amount}`;
      ctx.globalAlpha = alpha;
      rect(ctx, x, y + s, width, height - s * 2, INK);
      rect(ctx, x + s, y, width - s * 2, height, INK);
      drawText(ctx, "♥", x + s * 3, y + s * 2, { scale: s, color: GREEN });
      drawText(ctx, amount, x + s * 3 + glyph, y + s * 2, { scale: s, color: PAPER });
    }
    ctx.globalAlpha = 1;
  }

  function drawNameplate() {
    const fadeIn = reducedMotion ? 1 : clamp((time - DROP - 150) / 200), fadeOut = clamp((tagUntil - time) / 350);
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha <= 0 || near || inputLock) return;
    const s = labelScale();
    const label = player.creature.name.toUpperCase();
    const width = textWidth(label, s) + s * 12, height = 7 * s + s * 4;
    const { width: viewWidth, height: viewHeight, top, bottom } = band();
    const { x: left, y: upper } = view.camera;
    const x = Math.round(clamp(player.x - width / 2, left + 8, left + viewWidth - width - 8));
    // Under the feet, or over the head when the UI chrome would cover it.
    let y = Math.round(player.y + 3 * PLAYER_SCALE);
    if (y + height > upper + viewHeight - bottom - 4) y = Math.round(Math.max(upper + top + 4, player.y - topOf(player) - hopOffset(player) - height - 8));
    ctx.globalAlpha = alpha;
    rect(ctx, x, y + s, width, height - s * 2, INK);
    rect(ctx, x + s, y, width - s * 2, height, INK);
    rect(ctx, x + s * 3, y + height / 2 - s, s * 2, s * 2, GREEN);
    drawText(ctx, label, x + s * 8, y + s * 2, { scale: s, color: PAPER });
    ctx.globalAlpha = 1;
  }

  function drawPrompt() {
    promptBox = null;
    if (!near || paused || inputLock) return;
    const station = stationById(near);
    const touch = pointerKind === "touch" || pointerKind === "pen";
    const s = labelScale();
    const key = touch ? "TAP" : "E";
    const label = station.label.toUpperCase();
    const keyW = textWidth(key, s) + s * 6, keyH = 7 * s + s * 6;
    const labelW = textWidth(label, s);
    const padding = s * 3;
    const width = keyW + labelW + padding * 3, height = keyH + padding * 2 - s * 2;
    const bob = reducedMotion ? 0 : Math.round(Math.sin(time / 260) * 1.5) * s / 2;
    const headTop = player.y - topOf(player) - hopOffset(player);
    if (view.zoom > 1) {
      // Zoomed in (phones): the action bar already names the station, so a keycap bubble beside the head
      // says "tap to use" without eating the short band above the Friend.
      const { width: viewWidth, top } = band();
      const width = keyW + padding * 2, height = keyH + padding * 2 - s * 2;
      const right = player.x + 26 + width <= view.camera.x + viewWidth - 8;
      const x = Math.round(right ? player.x + 26 : player.x - 26 - width);
      const y = Math.round(Math.max(view.camera.y + top + 6, headTop - height / 2 + bob));
      rect(ctx, x, y + s, width, height - s * 2, INK);
      rect(ctx, x + s, y, width - s * 2, height, INK);
      // Tail towards the head.
      for (let i = 0; i < 3; i++) rect(ctx, right ? x - i * s : x + width - s * 2 + i * s, y + height - s * (2 + i), s * 2, s, INK);
      const kx = x + padding, ky = y + padding - s;
      rect(ctx, kx, ky + s, keyW, keyH - s, INK);
      rect(ctx, kx, ky, keyW, keyH - s * 2, GREEN);
      rect(ctx, kx, ky + keyH - s * 2, keyW, s, "#9BCB00");
      drawText(ctx, key, kx + keyW / 2, ky + s * 2, { scale: s, color: INK, align: "center" });
      promptBox = [x - 10, y - 10, x + width + 10, y + height + 10];
      return;
    }
    let x = Math.round(player.x - width / 2);
    let y = Math.round(headTop - height - 12 + bob);
    const { width: viewWidth, top } = band();
    x = Math.round(clamp(x, view.camera.x + 8, view.camera.x + viewWidth - width - 8));
    y = Math.max(Math.round(view.camera.y + top + 6), y);
    // Pill.
    rect(ctx, x, y + s, width, height - s * 2, INK);
    rect(ctx, x + s, y, width - s * 2, height, INK);
    // Pointer.
    const px = Math.round(Math.max(x + 12, Math.min(x + width - 12, player.x)));
    for (let i = 0; i < 3; i++) rect(ctx, px - (3 - i) * s, y + height + i * s - s, (3 - i) * 2 * s, s, INK);
    // Keycap.
    const kx = x + padding, ky = y + padding - s;
    rect(ctx, kx, ky + s, keyW, keyH - s, INK);
    rect(ctx, kx, ky, keyW, keyH - s * 2, GREEN);
    rect(ctx, kx, ky + keyH - s * 2, keyW, s, "#9BCB00");
    drawText(ctx, key, kx + keyW / 2, ky + s * 2, { scale: s, color: INK, align: "center" });
    drawText(ctx, label, kx + keyW + padding, y + (height - 7 * s) / 2, { scale: s, color: PAPER });
    promptBox = [x - 8, y - 8, x + width + 8, y + height + 12];
  }

  function render() {
    view.sync();
    // A new layout (first frame, resize, zoom change) re-reads the UI insets and snaps the camera.
    if (cam.layout !== view.layout) updateCamera(0, true);
    const camera = { x: Math.round(cam.x), y: Math.round(cam.y) };
    view.begin(false, camera);
    // Beyond the room (the band may reach past it under the UI chrome) continues the ink walls.
    if (camera.x < 0 || camera.y < 0 || camera.x + view.viewWidth > WORLD_WIDTH || camera.y + view.viewHeight > WORLD_HEIGHT) {
      rect(ctx, camera.x - 1, camera.y - 1, view.viewWidth + 2, view.viewHeight + 2, INK);
    }
    ctx.drawImage(room.base, 0, 0, ART_W * A, ART_H * A);
    ctx.save(); ctx.scale(A, A);
    room.drawDoor(ctx, doorOpen);
    room.drawGate(ctx, gateOpen);
    room.drawWindow(ctx, windowOpen);
    ctx.restore();
    drawMotes();
    drawMarker();
    fx.draw(ctx, "floor");

    const entities = [player, ...brood, ...[...departing.values()].map(entry => entry.entity), ...actors];
    const pops = new Map(entities.map(entity => [entity, entity === player ? true : popScale(entity).visible]));
    for (const entity of entities) drawShadow(entity, pops.get(entity)!);

    const roomState = { time, eggs, eggChangedAt, near, hover, pressedAt, doorOpen, gateOpen, windowOpen, sling, reducedMotion };
    const layers: { y: number; draw: () => void }[] = [];
    for (const prop of room.props) layers.push({ y: prop.baseY, draw: () => ctx.drawImage(prop.sprite, prop.x * A, prop.y * A, prop.sprite.width * A, prop.sprite.height * A) });
    layers.push({ y: room.kioskBaseY, draw: () => { ctx.save(); ctx.scale(A, A); room.drawKiosk(ctx, roomState); ctx.restore(); } });
    layers.push({ y: room.incubatorBaseY, draw: () => { ctx.save(); ctx.scale(A, A); room.drawIncubator(ctx, roomState); ctx.restore(); } });
    // A baby in the pouch stands on SLING_BASE_Y + 1: between the slingshot and the pouch lip.
    layers.push({ y: room.slingshotBaseY, draw: () => { ctx.save(); ctx.scale(A, A); room.drawSlingshot(ctx, roomState); ctx.restore(); } });
    layers.push({ y: room.slingshotBaseY + 2, draw: () => { ctx.save(); ctx.scale(A, A); room.drawSlingshotFront(ctx, roomState); ctx.restore(); } });
    layers.push({ y: ball.y + 6, draw: drawBall });
    for (const entity of entities) layers.push({ y: entity.y + (entity.clipRect ? -200 : 0), draw: () => drawEntity(entity) });
    layers.sort((a, b) => a.y - b.y);
    for (const layer of layers) layer.draw();

    if (alarmed && alarmed.alpha > 0.5) {
      // A bold "!" (2 x 6 art px, white edged) just over the head, jittering with the band.
      const head = alarmed.y - alarmed.lift - 16 * alarmed.scale * alarmed.sy;
      const x = Math.round(alarmed.x / A) * A + 4 * A, y = Math.round(head / A) * A - 9 * A;
      rect(ctx, x - A, y - A, 4 * A, 8 * A, WHITE);
      rect(ctx, x, y, 2 * A, 4 * A, INK);
      rect(ctx, x, y + 5 * A, 2 * A, A, INK);
    }
    drawButterfly();
    fx.draw(ctx, "top");
    drawIncome();
    drawBeacon();
    drawNameplate();
    drawPrompt();
    // Lightweight state for automated browser checks (written only when it changes).
    const next = { x: player.x.toFixed(1), y: player.y.toFixed(1), near: near ?? "", brood: String(brood.length), babies: brood.map(baby => `${Math.round(baby.x)},${Math.round(baby.y)}`).join(" ") };
    if (next.x !== debug.x) canvas.dataset.playerX = debug.x = next.x;
    if (next.y !== debug.y) canvas.dataset.playerY = debug.y = next.y;
    if (next.near !== debug.near) canvas.dataset.near = debug.near = next.near;
    if (next.brood !== debug.brood) canvas.dataset.brood = debug.brood = next.brood;
    if (next.babies !== debug.babies) canvas.dataset.babies = debug.babies = next.babies;
    // Camera: left, top, visible width, height (logical px) and zoom, for mapping world points in tests.
    const shown = `${camera.x},${camera.y},${+view.viewWidth.toFixed(2)},${+view.viewHeight.toFixed(2)},${+view.zoom.toFixed(3)}`;
    if (shown !== debug.view) canvas.dataset.view = debug.view = shown;
    // Hearts income in flight: badges / hearts.
    const flying = `${incomes.length}/${incomes.reduce((sum, item) => sum + item.hearts.filter(heart => time - item.start - heart.delay < HEART_FLIGHT).length, 0)}`;
    if (flying !== debug.incomes) canvas.dataset.incomes = debug.incomes = flying;
  }

  function loop(now: number) {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    const running = !paused || scripts > 0;
    if (running) { time += dt; update(dt); }
    if (running || dirty || view.sync()) { dirty = false; render(); }
  }
  raf = requestAnimationFrame(loop);

  // ------------------------------------------------------------------------------------------
  // Scripts

  async function runScript<T>(work: () => Promise<T>) {
    scripts++;
    try { return await work(); } finally { scripts--; dirty = true; }
  }

  let courtshipQueue: Promise<void> = Promise.resolve();

  async function courtship(mate: Creature) {
    if (destroyed) return;
    inputLock++;
    held.clear(); route = []; routeGoal = null; pendingStation = null; player.vx = 0; player.vy = 0;
    const actor = makeEntity(mate, DOOR_INSIDE.x, DOOR_INSIDE.y, PLAYER_SCALE);
    // The camera frames the Friend and its mate together; when they are far apart the Friend stays in
    // frame and the camera leans towards the door the mate walks in from.
    const framer = () => actor.alpha > 0.05 ? frameBoth(focusOf(player), focusOf(actor)) : focusOf(player);
    framers.push(framer);
    try {
      const side = DOOR_OUTSIDE.x < player.x ? -1 : 1;
      const apart = 20 * PLAYER_SCALE, above = 18 * PLAYER_SCALE;
      let meet: Point | null = null;
      for (const candidate of [{ x: player.x + side * apart, y: player.y }, { x: player.x - side * apart, y: player.y }, { x: player.x, y: player.y + above }, { x: player.x, y: player.y - above }]) {
        if (!heroNav.blocked(candidate.x, candidate.y)) { meet = candidate; break; }
      }
      meet ??= heroNav.nearestFree({ x: player.x + side * apart, y: player.y }) ?? { x: player.x + side * apart, y: player.y };
      if (reducedMotion) {
        actor.x = meet.x; actor.y = meet.y; actor.alpha = 0;
        actor.facing = meet.x < player.x ? "right" : meet.x > player.x ? "left" : meet.y > player.y ? "up" : "down";
        player.facing = facingFrom(meet.x - player.x, meet.y - player.y, player.facing);
        actors.push(actor);
        fadeTo(actor, 1, 150);
        fx.bigHeart((player.x + meet.x) / 2, Math.min(player.y - topOf(player), meet.y - topOf(actor)) - 8);
        await wait(700);
        fadeTo(actor, 0, 150);
        await wait(160);
        return;
      }
      actor.alpha = 0; actor.clipRect = DOOR_CLIP;
      actors.push(actor);
      doorWant = 1;
      await wait(90);
      fadeTo(actor, 1, 200);
      await walkPath(actor, [{ ...DOOR_OUTSIDE }], 260, true);
      actor.clipRect = null;
      const path = heroNav.route(actor, meet) ?? [meet];
      const length = pathLength(actor, path);
      const duration = clamp(length / 380, 0.3, 0.8);
      await walkPath(actor, path, length / duration, true);
      // Face each other.
      actor.facing = facingFrom(player.x - actor.x, player.y - actor.y, actor.facing);
      player.facing = facingFrom(actor.x - player.x, actor.y - player.y, player.facing);
      for (const baby of brood) baby.facing = facingFrom(actor.x - baby.x, actor.y - baby.y, baby.facing), baby.lookUntil = time + 1400;
      doorWant = 0;
      const midX = (player.x + actor.x) / 2, topY = Math.min(player.y - topOf(player), actor.y - topOf(actor)) - 2;
      hop(actor, 20, 300); hop(player, 20, 300, 120);
      fx.bigHeart(midX, topY - 6, 40);
      fx.hearts(midX, topY + 18, 6, 110, 120);
      fx.sparkles(midX, topY - 30, 3, 70, GREEN, 3, 140);
      brood.forEach((baby, index) => hop(baby, 11, 280, 260 + index * 70));
      await wait(380);
      hop(actor, 12, 260); hop(player, 12, 260, 60);
      await wait(360);
      // Back out of the door.
      doorWant = 1;
      const back = heroNav.route(actor, DOOR_OUTSIDE) ?? [];
      const backLength = pathLength(actor, back) + (DOOR_OUTSIDE.y - DOOR_INSIDE.y);
      const backDuration = clamp(backLength / 440, 0.3, 0.55);
      const speed = backLength / backDuration;
      if (back.length) await walkPath(actor, back, speed, true);
      actor.clipRect = DOOR_CLIP;
      fadeTo(actor, 0, 170);
      await walkPath(actor, [{ ...DOOR_INSIDE }], Math.max(220, speed * 0.7), true);
      doorWant = 0;
    } finally {
      const index = actors.indexOf(actor);
      if (index >= 0) actors.splice(index, 1);
      dropFramer(framer);
      inputLock--;
      doorWant = 0;
    }
  }

  /**
   * Hands a baby over to a leaving scene: out of the brood, or out of the babies waiting to leave (setBrood may
   * run before or after the scene starts), into the actors. Marked released either way, so it never returns.
   */
  function takeBaby(key: string) {
    let entity: Entity | undefined;
    const index = brood.findIndex(baby => baby.creature.key === key);
    if (index >= 0) { entity = brood[index]; brood.splice(index, 1); }
    else if (departing.has(key)) { entity = departing.get(key)!.entity; departing.delete(key); }
    released.add(key);
    if (!entity || destroyed) return null;
    actors.push(entity);
    entity.bornAt = -1e9;
    return entity;
  }

  async function release(key: string) {
    const entity = takeBaby(key);
    if (!entity) return;
    const leaving = entity;
    // Follow the baby to the gate, leaning towards the Friend sideways only (the band is short).
    const framer = () => frameBoth(focusOf(leaving), focusOf(player), 0.3, 0.06);
    framers.push(framer);
    try {
      if (reducedMotion) { fadeTo(entity, 0, 250); await wait(260); return; }
      hop(entity, 12, 260);
      await wait(200);
      const path = nav.route(entity, GATE_FRONT) ?? [{ ...GATE_FRONT }];
      const length = pathLength(entity, path);
      const duration = clamp(length / 170, 0.6, 2.0);
      await walkPath(entity, path, length / duration);
      gateWant = 1;
      entity.facing = "down";
      await wait(160);
      hop(entity, 14, 280);
      fx.hearts(entity.x, entity.y - topOf(entity) - 4, 2, 20, 180);
      await wait(360);
      hop(entity, 14, 280);
      await wait(340);
      entity.facing = "up";
      entity.clipRect = GATE_CLIP;
      fadeTo(entity, 0, 520);
      await walkPath(entity, [{ ...GATE_INSIDE }], 64);
      fx.sparkles(GATE_INSIDE.x, GATE_INSIDE.y - 20, 6, 36, GREEN, 3, 50);
      await wait(120);
    } finally {
      const at = actors.indexOf(entity);
      if (at >= 0) actors.splice(at, 1);
      dropFramer(framer);
      if (!actors.some(actor => actor.clipRect === GATE_CLIP)) gateWant = 0;
    }
  }

  let launchQueue: Promise<void> = Promise.resolve();

  /** Keeps a baby sitting in the pouch as the band moves (feet on the seat row). */
  function seat(entity: Entity) {
    const { dx, dy } = pouchOffset(sling, time, false, reducedMotion);
    entity.x = SLING_SEAT.x + dx * A;
    entity.lift = entity.y - (SLING_SEAT.y + dy * A + entity.feetOffset);
  }

  /**
   * Moon Slingshot: the baby scampers over and hops into the pouch, the band pulls back (at least a little) and
   * trembles, then snaps: the baby shoots up through Window 2, tumbling smaller towards the moon, and twinkles out.
   */
  async function launch(entity: Entity | null, pull: number) {
    if (!entity || destroyed) return;
    const flyer = entity;
    if (reducedMotion) {
      // A quick fade where it stands: no camera move, no input lock.
      fadeTo(flyer, 0, 250);
      await wait(260);
      const at = actors.indexOf(flyer);
      if (at >= 0) actors.splice(at, 1);
      return;
    }
    const stretch = clamp(Number.isFinite(pull) ? pull : 0.6, 0.2, 1);
    inputLock++;
    held.clear(); route = []; routeGoal = null; pendingStation = null; player.vx = 0; player.vy = 0;
    // Phones: follow the baby over, then frame the window (the target) down to the fully pulled pouch.
    const aim = { x: SLING_SEAT.x, y: (WINDOW_CLIP[1] + SLING_SEAT.y + SLING_PULL) / 2 };
    const framer = () => flyer.lift > 0 || flyer.clipRect ? aim : frameBoth(focusOf(flyer), aim, 0.3, 0.2);
    framers.push(framer);
    try {
      const watch = () => {
        player.facing = facingFrom(SLING_SEAT.x - player.x, SLING_BASE_Y - player.y, player.facing);
        for (const baby of brood) { baby.facing = facingFrom(SLING_SEAT.x - baby.x, SLING_BASE_Y - baby.y, baby.facing); baby.lookUntil = time + 2600; }
      };
      watch();
      hop(flyer, 12, 220);
      await wait(100);
      const path = nav.route(flyer, SLING_FRONT) ?? [{ ...SLING_FRONT }];
      const length = pathLength(flyer, path);
      if (length > 2) await walkPath(flyer, path, length / clamp(length / 560, 0.18, 0.4), true);
      // Up into the pouch, stretched on the way up.
      watch();
      flyer.facing = "down";
      const from = { x: flyer.x, y: flyer.y }, ground = SLING_BASE_Y + 1;
      const seatLift = ground - (SLING_SEAT.y + flyer.feetOffset);
      await tween(230, t => {
        flyer.x = lerp(from.x, SLING_SEAT.x, t); flyer.y = lerp(from.y, ground, t);
        flyer.lift = seatLift * t + Math.sin(t * Math.PI) * 40;
        flyer.sx = t < 0.75 ? 0.88 : 1; flyer.sy = t < 0.75 ? 1.14 : 1;
      });
      // Plop: the pouch sags under the weight.
      sling.loaded = true;
      await tween(90, t => { sling.pull = Math.sin(t * Math.PI) * 0.12; seat(flyer); flyer.sx = t < 0.6 ? 1.2 : 1; flyer.sy = t < 0.6 ? 0.82 : 1; });
      // Pull back, then hold it, trembling (the baby has second thoughts).
      windowWant = 1;
      await tween(480, t => {
        sling.pull = stretch * easeOutCubic(t / 0.6);
        seat(flyer);
        flyer.sx = 1 + sling.pull * 0.1; flyer.sy = 1 - sling.pull * 0.12;
        alarmed = t >= 0.6 ? flyer : null;
      });
      alarmed = null;
      // Snap.
      sling.snapAt = time; sling.snapPull = sling.pull; sling.pull = 0; sling.loaded = false;
      pressedAt.slingshot = time;
      const start = { x: flyer.x, y: flyer.y - flyer.lift - 8 * flyer.scale };
      fx.ring(start.x, start.y + 12, 44, INK, 3, 260);
      fx.sparkles(start.x, start.y, 3, 26, GREEN, 3, 30);
      fx.puff(SLING_SEAT.x, SLING_BASE_Y + 4, 8, 30);
      hop(player, 18, 320, 80);
      brood.forEach((baby, index) => hop(baby, 12, 280, 140 + index * 60));
      /** Centre of the 16-row box at c, sized k, stretched sx / sy. */
      const place = (c: Point, k: number, sx: number, sy: number) => {
        flyer.x = c.x; flyer.sx = k * sx; flyer.sy = k * sy;
        flyer.lift = flyer.y - (c.y + 8 * flyer.scale * k * sy);
      };
      const mouth = { x: (start.x + MOON_AT.x) / 2 - 6, y: WINDOW_CLIP[3] - 20 };
      await tween(80, t => place({ x: lerp(start.x, mouth.x, t), y: lerp(start.y, mouth.y, t) }, lerp(1, 0.8, t), 0.7, 1.5));
      // Out through the window, tumbling away.
      flyer.clipRect = WINDOW_CLIP;
      const spin: Facing[] = ["down", "left", "up", "right"];
      await tween(300, t => {
        const u = easeOutCubic(t);
        place({ x: lerp(mouth.x, MOON_AT.x, u), y: lerp(mouth.y, MOON_AT.y, u) - Math.sin(t * Math.PI) * 8 }, lerp(0.8, 0.08, u), 1, 1);
        flyer.facing = spin[Math.floor(t * 7) % 4];
      });
      flyer.alpha = 0;
      // Ding!
      fx.sparkles(MOON_AT.x, MOON_AT.y, 1, 0, GREEN, 3, 0);
      fx.ring(MOON_AT.x, MOON_AT.y, 16, INK, 3, 220);
      windowWant = 0;
      await wait(120);
    } finally {
      const at = actors.indexOf(flyer);
      if (at >= 0) actors.splice(at, 1);
      dropFramer(framer);
      inputLock--;
      if (alarmed === flyer) alarmed = null;
      sling.pull = 0; sling.loaded = false;
      windowWant = 0;
    }
  }

  function findEntity(key: string) {
    if (player.creature.key === key) return player;
    return brood.find(baby => baby.creature.key === key) ?? actors.find(actor => actor.creature.key === key) ?? null;
  }

  /** A new look (accessory put on or taken off): a little hop and a twinkle around the head. */
  function dressed(entity: Entity) {
    dirty = true;
    if (reducedMotion) return;
    hop(entity, 14, 300);
    fx.sparkles(entity.x, entity.y - topOf(entity) + 4 * entity.scale, 5, 9 * entity.scale, GREEN, 3, 60);
  }

  /** Swap in a new object for the same creature (a new accessory, say), keeping position and state. */
  function restyle(entity: Entity, next: Creature) {
    const before = entity.creature;
    if (before === next) return;
    entity.creature = next;
    if (next.sheet !== before.sheet) {
      const span = inkSpan(next);
      entity.shadowSpan = Math.max(4, (span.max - span.min + 1) / 2);
      entity.feetOffset = (15 - feetRow(next)) * entity.scale;
    }
    if ((next.accessory ?? null) !== (before.accessory ?? null)) dressed(entity);
    dirty = true;
  }

  /** Celebrations play even over a paused world, so the burst the UI asked for is always seen. */
  function celebrateEntity(entity: Entity) {
    if (reducedMotion) return;
    burst(entity);
    void runScript(() => wait(1500));
  }

  function burst(entity: Entity) {
    const tier = entity.creature.tier;
    const accent = tier && tier !== "common" ? TIER_STYLE[tier].accent : GREEN;
    const cx = entity.x, cy = entity.y - 8 * entity.scale;
    if (reducedMotion) return;
    hop(entity, 16, 320);
    fx.confetti(cx, cy, [INK, GREEN, accent, INK, GREEN, MUTED], 48, 1, 6);
    fx.hearts(cx, cy - 12, 3, 36, 120);
    fx.ring(cx, cy, 16 * entity.scale, INK, 3, 360);
    fx.sparkles(cx, cy, 6, 14 * entity.scale, accent === INK ? GREEN : accent, 3, 70);
  }

  // ------------------------------------------------------------------------------------------
  // Public API

  return {
    setPlayer(next) {
      if (destroyed) return;
      restyle(player, next);
    },
    emitHearts(key, amount) {
      if (destroyed || !(amount > 0)) return;
      // A frozen world (panel or hatch overlay on top) has nothing to show; the HUD counter still counts.
      if (paused && scripts === 0) return;
      const entity = findEntity(key);
      if (!entity || entity.alpha < 0.5 || time < entity.bornAt) return;
      const recent = incomes.find(item => item.key === key && time - item.start < 350);
      if (recent) { recent.amount += amount; dirty = true; return; }
      const count = reducedMotion ? 0 : amount >= 10 ? 3 : amount >= 4 ? 2 : 1;
      // Neighbours earning at once: stack the new badge above a fresh one it would cover.
      const { width, height } = badgeSize(amount, labelScale());
      let y = entity.y - topOf(entity) - hopOffset(entity);
      for (let tries = 0; tries < 3; tries++) {
        const cover = incomes.find(item => time - item.start < 700 && Math.abs(item.x - entity.x) < width && Math.abs(item.y - y) < height + 2);
        if (!cover) break;
        y = cover.y - height - 2;
      }
      incomes.push({
        key, x: entity.x, y, start: time, amount,
        hearts: Array.from({ length: count }, (_, i) => ({ dx: (i - (count - 1) / 2) * 16 + (Math.random() - 0.5) * 6, delay: i * 90 })),
      });
      while (incomes.length > MAX_INCOMES) incomes.shift();
      // A happy little hop from a baby standing still.
      if (entity !== player && !reducedMotion && entity.clip === "idle") hop(entity, 9, 260);
      dirty = true;
    },
    setBrood(babies) {
      if (destroyed) return;
      for (const [key, at] of pendingCelebrations) if (time - at > 8000) pendingCelebrations.delete(key);
      const keys = new Set(babies.map(baby => baby.key));
      const current = new Map(brood.map(baby => [baby.creature.key, baby]));
      for (const [key, entity] of current) if (!keys.has(key)) departing.set(key, { entity, since: time });
      let stagger = 0;
      const next: Entity[] = [];
      for (const creature of babies) {
        if (released.has(creature.key)) continue;
        let entity = current.get(creature.key) ?? departing.get(creature.key)?.entity;
        departing.delete(creature.key);
        if (!entity) {
          // New babies pop in on the next running frames (so a paused world defers the moment). Babies of the
          // first load line up on the trail; later newborns appear beside the Friend, where the camera looks.
          const beside = time > INTRO ? besideSpot([...brood, ...next]) : null;
          const spot = beside ?? trailPoint(FIRST_GAP + GAP * next.length);
          entity = makeEntity(creature, spot.x, spot.y, BABY_SCALE);
          entity.bornAt = Math.max(time + 1, reducedMotion ? 0 : INTRO) + stagger * 140;
          if (beside) entity.holdUntil = entity.bornAt + 1100;
          entity.popped = false;
          stagger++;
        } else if (entity.creature !== creature) {
          // Same baby, new object (e.g. a new accessory): update in place, no pop-in, same place in line.
          restyle(entity, creature);
        }
        next.push(entity);
      }
      brood = next;
      dirty = true;
    },
    setPaused(next) {
      if (next === paused) return;
      paused = next;
      held.clear(); route = []; routeGoal = null; pendingStation = null; dragId = null;
      player.vx = 0; player.vy = 0;
      if (paused && hover) hover = null;
      canvas.style.cursor = "";
      dirty = true;
    },
    setReducedMotion(next) {
      reducedMotion = next;
      if (next) fx.clear();
      dirty = true;
    },
    setEggCount(count) {
      const value = Math.max(0, Math.floor(count));
      if (value > eggs) eggChangedAt = time;
      if (value < eggs && !reducedMotion) fx.sparkles(480, 110, 5, 30, GREEN, 2, 40);
      eggs = value;
      dirty = true;
    },
    playCourtship(mate) {
      const run = courtshipQueue.then(() => runScript(() => courtship(mate)));
      courtshipQueue = run.catch(() => {});
      return run;
    },
    playRelease(babyKey) {
      return runScript(() => release(babyKey));
    },
    playLaunch(babyKey, pull) {
      // Taken at once (same hand-off as playRelease); launches queue for the one pouch.
      const entity = takeBaby(babyKey);
      const run = launchQueue.then(() => runScript(() => launch(entity, pull)));
      launchQueue = run.catch(() => {});
      return run;
    },
    celebrate(key) {
      if (destroyed) return;
      const entity = findEntity(key);
      // Not in the world yet (setBrood usually follows) or still waiting to pop in: celebrate on arrival.
      if (!entity || !entity.popped) { pendingCelebrations.set(key, time); return; }
      celebrateEntity(entity);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stopHeld);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("lostpointercapture", onPointerUp);
      view.destroy();
      for (const timer of timers.splice(0)) timer.resolve();
      for (const item of tweens.splice(0)) item.resolve();
      for (const entity of [player, ...brood, ...actors]) { const done = entity.onArrive; entity.onArrive = null; done?.(); }
      fx.clear();
      incomes.length = 0;
      canvas.style.cursor = "";
    },
  };
}
