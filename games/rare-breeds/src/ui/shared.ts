// Small helpers shared by the Rare Breeds UI components. Browser only, no SDK imports.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { TIER_STYLE, type Creature, type TierId } from "../types.ts";

/** Chance and fixed Sanctuary value for one tier, preformatted by the caller (e.g. "12%", "3 RF"). */
export type TierInfo = Readonly<{ tier: TierId; chance: string; value: string }>;

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/** CSS custom properties carrying a tier's colours from TIER_STYLE. */
export function tierVars(tier: TierId | undefined): CSSProperties {
  const style = TIER_STYLE[tier ?? "common"];
  return { "--rb-tier-accent": style.accent, "--rb-tier-glow": style.glow ?? "#F4F1EA" } as CSSProperties;
}

export const tierLabel = (tier: TierId | undefined) => TIER_STYLE[tier ?? "common"].label;

/** "Your Friend", "Wild Friend" or the lineage label ("F1", "F2", ...) for babies. */
export function lineageLabel(creature: Creature) {
  if (creature.kind === "baby") return `F${Math.max(1, creature.lineage)}`;
  return creature.kind === "friend" ? "Your Friend" : "Wild Friend";
}

/** Stable 32-bit hash for playful, deterministic flavour (never used for outcomes). */
export function hashString(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

// Reduced motion: an explicit prop wins, then the nearest GameRoot, then the OS preference.
export const MotionContext = createContext<boolean | null>(null);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function useReducedMotion(explicit?: boolean) {
  const fromRoot = useContext(MotionContext);
  const fromSystem = usePrefersReducedMotion();
  return explicit ?? fromRoot ?? fromSystem;
}

// Compact layout detection: one shared ResizeObserver per game root (or the window), however many components ask.
type CompactStore = { compact: boolean; listeners: Set<(compact: boolean) => void>; stop: () => void };
const compactStores = new Map<Element | Window, CompactStore>();
const isCompact = (width: number, height: number) => width < 600 || height < 480;

function compactStore(target: Element | Window) {
  let store = compactStores.get(target);
  if (store) return store;
  const measure = () => target instanceof Element ? isCompact(target.clientWidth, target.clientHeight) : isCompact(innerWidth, innerHeight);
  const created: CompactStore = { compact: measure(), listeners: new Set(), stop: () => {} };
  const update = () => {
    const next = measure();
    if (next === created.compact) return;
    created.compact = next;
    for (const listener of created.listeners) listener(next);
  };
  if (target instanceof Element && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(update);
    observer.observe(target);
    created.stop = () => observer.disconnect();
  } else {
    window.addEventListener("resize", update);
    created.stop = () => window.removeEventListener("resize", update);
  }
  compactStores.set(target, created);
  return created;
}

/** True when the nearest .rb-root (or the window) is phone sized: under 600 wide or 480 tall. Matches style.css. */
export function useCompact(ref: RefObject<Element | null>) {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const target = ref.current?.closest(".rb-root") ?? window;
    const store = compactStore(target);
    setCompact(store.compact);
    store.listeners.add(setCompact);
    return () => {
      store.listeners.delete(setCompact);
      if (!store.listeners.size) { store.stop(); compactStores.delete(target); }
    };
  }, [ref]);
  return compact;
}

/** Current devicePixelRatio, updated when it changes (zoom, moving to another screen). */
export function useDevicePixelRatio() {
  const [ratio, setRatio] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    let query: MediaQueryList | null = null;
    const listen = () => {
      const current = window.devicePixelRatio || 1;
      setRatio(current);
      query?.removeEventListener("change", listen);
      query = window.matchMedia?.(`(resolution: ${current}dppx)`) ?? null;
      query?.addEventListener("change", listen);
    };
    listen();
    return () => query?.removeEventListener("change", listen);
  }, []);
  return ratio;
}

/**
 * Crisp pixel metrics for a sprite drawn at an integer CSS scale: each sprite pixel becomes a whole
 * number of device pixels (so fractional ratios such as 1.5 or 2.625 stay sharp).
 */
export function pixelMetrics(scale: number, ratio: number) {
  const device = Math.max(1, Math.round(scale * ratio));
  return { device, css: device / ratio };
}

// One shared animation loop for every sprite thumbnail.
type Tick = (now: number) => void;
const ticks = new Set<Tick>();
let raf = 0;
function loop(now: number) {
  raf = 0;
  for (const tick of ticks) tick(now);
  if (ticks.size) raf = requestAnimationFrame(loop);
}
export function subscribeTick(tick: Tick) {
  ticks.add(tick);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    ticks.delete(tick);
    if (!ticks.size && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible, focusable descendants in DOM order. Radio groups count once (the checked or first radio). */
export function focusableIn(root: HTMLElement) {
  const seen = new Set<string>();
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => {
    if (element.getClientRects().length === 0 || element.closest("[inert]")) return false;
    if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
      const group = [...root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(element.name)}"]`)];
      const active = group.find(radio => radio.checked && !radio.disabled) ?? group.find(radio => !radio.disabled);
      if (seen.has(element.name) || element !== active) return false;
      seen.add(element.name);
    }
    return true;
  });
}

// Open modals, topmost last. Only the topmost one traps focus and handles Escape.
const modals: HTMLElement[] = [];

/**
 * Modal focus handling: focus [data-autofocus] or the first focusable element on mount (and when
 * refocusKey changes), keep Tab and focus inside the node, call onEscape on Escape, restore focus on unmount.
 * Listens on the document, so it also works while focus sits on <body>.
 */
export function useModalFocus(node: RefObject<HTMLElement | null>, onEscape?: () => void, refocusKey?: unknown) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const root = node.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    modals.push(root);
    const top = () => modals[modals.length - 1] === root;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!top() || event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (escape.current) { event.preventDefault(); event.stopPropagation(); escape.current(); }
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableIn(root);
      if (!items.length) { event.preventDefault(); root.focus(); return; }
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      const inside = active instanceof HTMLElement && root.contains(active) && active !== root;
      if (event.shiftKey && (active === first || !inside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !inside)) { event.preventDefault(); first.focus(); }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (top() && event.target instanceof Node && !root.contains(event.target)) (focusableIn(root)[0] ?? root).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      modals.splice(modals.indexOf(root), 1);
      if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true });
    };
  }, [node]);
  useEffect(() => {
    const root = node.current;
    if (!root) return;
    // Prefer [data-autofocus], then the first control outside [data-focus-late] (e.g. the header close button).
    const items = focusableIn(root);
    const target = root.querySelector<HTMLElement>("[data-autofocus]:not([disabled])")
      ?? items.find(item => !item.closest("[data-focus-late]")) ?? items[0] ?? root;
    target.focus({ preventScroll: true });
  }, [node, refocusKey]);
}
