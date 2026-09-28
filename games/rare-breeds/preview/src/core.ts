// Page plumbing shared by every section: reduced motion, animation loops that run only while their section is on
// screen, scroll progress through a list of steps, and small DOM helpers.
import { createPixelView, type PixelView } from "../../src/scene/view.ts";

const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => motionQuery.matches;
export const onMotionChange = (listener: () => void) => motionQuery.addEventListener("change", listener);

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [...root.querySelectorAll<T>(selector)];

/**
 * Calls `frame(now, dt)` every animation frame while `element` is within the viewport (plus a margin) and the tab is
 * visible. Scroll is read inside these frames, so there is no scroll listener anywhere on the page.
 */
export function whileVisible(element: Element, frame: (now: number, dt: number) => void, margin = "120px") {
  let visible = false, raf = 0, last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    frame(now, dt);
    raf = requestAnimationFrame(tick);
  };
  const update = () => {
    const run = visible && !document.hidden;
    if (run && !raf) { last = 0; raf = requestAnimationFrame(tick); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); update(); }, { rootMargin: margin }).observe(element);
  document.addEventListener("visibilitychange", update);
  return { redraw: () => frame(performance.now(), 0) };
}

export type StepProgress = Readonly<{ index: number; t: number }>;

/**
 * Where the reading line (a fraction down the viewport) is inside a list of step elements: the step it crosses and
 * how far through it (0 to 1). Before the first step it reads step 0 at t 0, after the last the last step at t 1.
 */
export function stepProgress(steps: readonly HTMLElement[], line = readingLine(steps[0])): StepProgress {
  const y = innerHeight * line;
  for (let index = 0; index < steps.length; index++) {
    const box = steps[index].getBoundingClientRect();
    if (y < box.top) return { index, t: 0 };
    if (y < box.bottom) return { index, t: Math.min(1, Math.max(0, (y - box.top) / Math.max(1, box.height))) };
  }
  return { index: steps.length - 1, t: 1 };
}

const phone = matchMedia("(max-width: 760px)");
/** Phones read at the sticky text's top edge (just under the stage), larger screens a little below the middle. */
function readingLine(step: HTMLElement | undefined) {
  if (!phone.matches || !step) return 0.55;
  const body = step.querySelector<HTMLElement>(".step-body");
  const top = body ? parseFloat(getComputedStyle(body).top) : NaN;
  return Number.isFinite(top) ? Math.min(0.9, (top + 40) / innerHeight) : 0.55;
}

/** A logical-resolution canvas (the game's own pixel view: crisp at any device pixel ratio). */
export function pixelView(canvas: HTMLCanvasElement, width: number, height: number): PixelView {
  return createPixelView(canvas, width, height);
}

export function setPressed(buttons: readonly HTMLElement[], active: (button: HTMLElement) => boolean) {
  for (const button of buttons) button.setAttribute("aria-pressed", String(active(button)));
}

export const shortId = (name: string) => name.replace(/^Friend /, "");

/** Fades sections in once as they enter the viewport. */
export function revealOnScroll(elements: readonly Element[]) {
  if (reducedMotion()) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-in"); observer.unobserve(entry.target); }
  }, { rootMargin: "0px 0px -10% 0px" });
  for (const element of elements) { element.classList.add("reveal"); observer.observe(element); }
}
