// "Send one to the Moon": scrolling walks a baby to the Moon Slingshot in the real room art, loads the pouch, pulls
// back and shoots it out of the window; then the game's own flight scene (src/scene/launch.ts) takes over and the
// visitor flies it: hold to climb, let go to jump. Same maths as the game (src/slingshot.ts), no stake and no RF.
import type { LaunchSequence } from "../../src/api.ts";
import { clamp, easeOutCubic, lerp } from "../../src/scene/art.ts";
import { feetRow } from "../../src/scene/creatures.ts";
import { createParticles } from "../../src/scene/fx.ts";
import { createLaunchSequence } from "../../src/scene/launch.ts";
import { A, MOON_AT, SLING_BASE_Y, SLING_FRONT, SLING_SEAT, WINDOW_CLIP, pouchOffset } from "../../src/scene/room.ts";
import { MOON_HUNDREDTHS, START_HUNDREDTHS, crashPoint, flightHundredths, multiplierLabel, type FlightEnd } from "../../src/slingshot.ts";
import { GREEN, INK } from "../../src/scene/art.ts";
import type { Creature, Facing, TierId } from "../../src/types.ts";
import { $, $$, pixelView, reducedMotion, setPressed, stepProgress, whileVisible } from "./core.ts";
import { randomBelow } from "./pool.ts";
import { restingRoom, roomPainter, type Actor } from "./room.ts";

/** The slice of the room around the slingshot and its window (logical px, 3:2). */
const CAM = { x: 348, y: 0, w: 492, h: 328 };
const SPIN: readonly Facing[] = ["down", "left", "up", "right"];

type Phase = "ready" | "flying" | "ending" | "done";

export function mountSling(friend: Creature, riders: Readonly<Record<TierId, Creature>>) {
  const section = $("#slingshot");
  const stage = $("#sling-stage");
  const roomCanvas = $<HTMLCanvasElement>("#sling-room");
  const flightCanvas = $<HTMLCanvasElement>("#sling-flight");
  const hud = $("#flight-hud");
  const mult = $("#flight-mult");
  const note = $("#flight-note");
  const hold = $<HTMLButtonElement>("#flight-hold");
  const again = $<HTMLButtonElement>("#flight-again");
  const best = $("#flight-best");
  const status = $("#flight-status");
  const steps = $$(".step", section);
  const riderChips = $$<HTMLButtonElement>("[data-rider]", section);

  const view = pixelView(roomCanvas, CAM.w, CAM.h);
  const painter = roomPainter(friend);
  const fx = createParticles();
  let rider = riders.prismatic;
  let sequence: LaunchSequence | null = null;
  let phase: Phase = "ready", crash = 0, start = 0, raf = 0, record = 0, snapAt = -1e9, snapped = false;
  let inFlightView = false;

  riderChips.forEach(chip => chip.addEventListener("click", () => {
    rider = riders[chip.dataset.rider as TierId];
    setPressed(riderChips, other => other === chip);
    if (phase === "ready" && sequence) resetFlight();
  }));

  // ---------- The room part: walk, hop in, pull, snap, out of the window ----------
  const player: Actor = { creature: friend, x: 440, y: 300, scale: 4, facing: "right", clip: "idle", frame: 0 };
  const baby: Actor = { creature: rider, x: 400, y: 318, scale: 3, facing: "right", clip: "walk", frame: 0 };

  function roomScene(step: number, t: number, now: number, dt: number) {
    const still = reducedMotion();
    const time = still ? 0 : now;
    baby.creature = rider;
    const feet = (15 - feetRow(rider)) * baby.scale, ground = SLING_BASE_Y + 1;
    const sling = { pull: 0, snapAt, snapPull: 0.8, loaded: false };
    let windowOpen = 0;
    baby.alpha = 1; baby.clipRect = null; baby.sx = 1; baby.sy = 1; baby.lift = 0;
    player.frame = still ? 0 : Math.floor(now / 110) & 7;
    baby.frame = still ? 0 : Math.floor(now / 110) & 7;
    if (step === 0) {
      // Over to the slingshot.
      const u = easeOutCubic(t);
      baby.x = lerp(372, SLING_FRONT.x, u); baby.y = lerp(322, SLING_FRONT.y, u);
      baby.clip = t < 0.98 && !still ? "walk" : "idle";
      baby.facing = t < 0.7 ? "right" : "up";
      snapped = false;
    } else if (step === 1) {
      // Up into the pouch, then the band pulls back and trembles.
      const up = clamp(t / 0.3);
      baby.clip = "idle"; baby.facing = "down";
      const seatLift = ground - (SLING_SEAT.y + feet);
      baby.x = lerp(SLING_FRONT.x, SLING_SEAT.x, up); baby.y = lerp(SLING_FRONT.y, ground, up);
      if (up < 1) {
        baby.lift = seatLift * up + Math.sin(up * Math.PI) * 40;
        baby.sx = up < 0.75 ? 0.88 : 1; baby.sy = up < 0.75 ? 1.14 : 1;
      } else {
        sling.loaded = true;
        sling.pull = 0.85 * easeOutCubic(clamp((t - 0.3) / 0.5));
        windowOpen = clamp((t - 0.3) / 0.4);
        const { dx, dy } = pouchOffset(sling, time, false, still);
        baby.x = SLING_SEAT.x + dx * A;
        baby.lift = baby.y - (SLING_SEAT.y + dy * A + feet);
        baby.sx = 1 + sling.pull * 0.1; baby.sy = 1 - sling.pull * 0.12;
      }
      snapped = false;
    } else {
      // Snap: out through the window, tumbling smaller towards the sky.
      windowOpen = 1;
      if (!snapped) {
        snapped = true; snapAt = time;
        if (!still) { fx.ring(SLING_SEAT.x, SLING_SEAT.y + 10, 44, INK, 3, 260); fx.sparkles(SLING_SEAT.x, SLING_SEAT.y - 20, 3, 26, GREEN, 3, 30); }
      }
      sling.snapAt = snapAt;
      const fly = easeOutCubic(clamp(t / 0.6));
      const start = { x: SLING_SEAT.x, y: SLING_SEAT.y - 8 * baby.scale };
      const k = lerp(1, 0.08, fly);
      baby.clipRect = fly > 0.12 ? WINDOW_CLIP : null;
      baby.x = lerp(start.x, MOON_AT.x, fly);
      const cy = lerp(start.y, MOON_AT.y, fly) - Math.sin(fly * Math.PI) * 10;
      baby.sx = k; baby.sy = k;
      baby.y = ground; baby.lift = ground - (cy + 8 * baby.scale * k);
      baby.facing = SPIN[Math.floor(fly * 7) % 4];
      baby.alpha = fly >= 1 ? 0 : 1;
    }
    player.facing = step === 0 && t < 0.4 ? "right" : "up";
    if (dt > 0) fx.update(dt);
    view.sync();
    view.begin(true, { x: CAM.x, y: CAM.y });
    const state = { ...restingRoom(time, still), windowOpen, sling, near: "slingshot" as const };
    painter.paint(view.ctx, state, [player, baby], () => fx.draw(view.ctx, "top"));
  }

  // ---------- The flight ----------
  function makeSequence() {
    sequence?.destroy();
    sequence = createLaunchSequence({ canvas: flightCanvas, baby: rider, reducedMotion: reducedMotion() });
  }
  function resetFlight() {
    cancelAnimationFrame(raf);
    phase = "ready";
    makeSequence();
    mult.textContent = "x1.00";
    note.textContent = "Hold to fly";
    hold.hidden = false; hold.disabled = !inFlightView; hold.textContent = "Hold to fly";
    again.hidden = true;
  }

  function ignite() {
    if (phase !== "ready" || !inFlightView) return;
    if (!sequence) makeSequence();
    crash = crashPoint(randomBelow(10_000));
    start = performance.now();
    phase = "flying";
    sequence!.ignite();
    hold.classList.add("is-held");
    hold.textContent = "Let go to jump";
    note.textContent = "Let go to jump";
    status.textContent = `Lift-off! ${rider.name} is climbing.`;
    const tick = (now: number) => {
      if (phase !== "flying") return;
      const ms = now - start, h = flightHundredths(ms);
      if (h > crash || h >= MOON_HUNDREDTHS) { finish(null); return; }
      sequence!.fly(ms);
      mult.textContent = multiplierLabel(h, true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function jump() {
    if (phase !== "flying") return;
    finish(flightHundredths(performance.now() - start));
  }

  function finish(exit: number | null) {
    cancelAnimationFrame(raf);
    phase = "ending";
    hold.classList.remove("is-held");
    const jumped = exit !== null && exit <= crash;
    const end: FlightEnd = jumped ? (exit >= MOON_HUNDREDTHS ? "moon" : "jump") : crash >= MOON_HUNDREDTHS ? "moon" : crash < START_HUNDREDTHS ? "fizzle" : "crash";
    const at = end === "moon" ? MOON_HUNDREDTHS : jumped ? exit : null;
    const gaveOut = crash < MOON_HUNDREDTHS ? `The rocket would have given out at ${multiplierLabel(crash, true)}.` : "This rocket was good for the Moon.";
    const said = end === "moon" ? `The Moon! ${rider.name} landed at x10.`
      : end === "jump" ? `${rider.name} jumped at ${multiplierLabel(at!, true)}. ${gaveOut}`
      : end === "fizzle" ? `Pfff. The rocket fizzled on the pad and ${rider.name} plopped into the pond.`
      : `The rocket gave out at ${multiplierLabel(crash, true)}. ${rider.name} plopped into the pond.`;
    mult.textContent = end === "fizzle" ? "x0" : at === null ? multiplierLabel(crash, true) : multiplierLabel(at, true);
    note.textContent = end === "moon" ? "The Moon" : end === "jump" ? "Parachute" : "Splash";
    status.textContent = said;
    hold.hidden = true;
    if (at !== null && at > record) record = at;
    best.textContent = `${said}${record ? ` Best this visit: ${multiplierLabel(record, true)}.` : ""}`;
    void sequence!.end(end, at).then(() => {
      phase = "done";
      again.hidden = false;
      again.focus({ preventScroll: true });
    });
  }

  hold.addEventListener("pointerdown", event => { event.preventDefault(); hold.setPointerCapture(event.pointerId); ignite(); });
  hold.addEventListener("pointerup", () => jump());
  hold.addEventListener("pointercancel", () => jump());
  hold.addEventListener("lostpointercapture", () => jump());
  hold.addEventListener("contextmenu", event => event.preventDefault());
  hold.addEventListener("keydown", event => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); ignite(); }
  });
  hold.addEventListener("keyup", event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); jump(); } });
  hold.addEventListener("blur", () => jump());
  again.addEventListener("click", () => { resetFlight(); hold.focus({ preventScroll: true }); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) jump(); });

  // ---------- Scroll: which part is showing ----------
  let lastIndex = -1;
  whileVisible(section, (now, dt) => {
    const { index, t } = stepProgress(steps);
    if (index !== lastIndex) { steps.forEach((step, i) => step.classList.toggle("is-active", i === index)); lastIndex = index; }
    const flightView = index === 3 || phase !== "ready";
    if (flightView !== inFlightView) {
      inFlightView = flightView;
      stage.classList.toggle("is-flight", flightView);
      hud.hidden = !flightView;
      if (flightView && !sequence) makeSequence();
      if (phase === "ready") hold.disabled = !flightView;
    }
    if (!inFlightView || phase === "ready") roomScene(Math.min(index, 2), index === 3 ? 1 : reducedMotion() ? 1 : t, now, dt);
  });
  hold.disabled = true;
}
