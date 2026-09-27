// Logical-resolution canvas view: CSS-scaled to fit its box, crisp at the device pixel ratio.
// The backing store holds only the visible part of the logical plane, at the smallest integer
// number of backing pixels per logical pixel that covers the displayed device pixels (capped at 3),
// so phones do not pay for a 3x desktop-sized buffer and every art pixel stays a whole block.
//
// Zoom: an optional policy picks a zoom for the displayed box. At zoom 1 the whole plane is shown
// (letterboxed by object-fit: contain). Above 1 the visible region takes the box's aspect ratio and a
// camera (top-left of the visible region, logical px) selects which part of the plane is drawn.
// With `overscan`, a box taller than the zoomed plane shows more than the plane's height (the scene
// paints what lies above and below it) instead of letterboxing.

export type ViewCamera = Readonly<{ x: number; y: number }>;

export type PixelViewOptions = Readonly<{
  onResize?: () => void;
  /** Zoom for a displayed box: CSS size and the CSS px per logical px at zoom 1. Default: always 1. */
  zoomFor?: (cssWidth: number, cssHeight: number, fitScale: number) => number;
  /** Above zoom 1, the visible region may be taller than the plane (tall portrait boxes). Default false. */
  overscan?: boolean;
}>;

export type PixelView = {
  readonly ctx: CanvasRenderingContext2D;
  /** Backing pixels per logical pixel (integer 1-3). */
  readonly ratio: number;
  /** CSS pixels per logical pixel (content box, after zoom and object-fit: contain). */
  readonly cssScale: number;
  /** Current zoom (1 = whole plane). */
  readonly zoom: number;
  /** Visible logical size (the whole plane at zoom 1). */
  readonly viewWidth: number;
  readonly viewHeight: number;
  /** Displayed box size in CSS px. */
  readonly boxWidth: number;
  readonly boxHeight: number;
  /** Increments whenever the measured layout (box, device pixel ratio, zoom) changes. */
  readonly layout: number;
  /** Camera used by the last begin(). */
  readonly camera: ViewCamera;
  /** Re-measure if the element or the device pixel ratio changed. Returns true when the layout changed. */
  sync(): boolean;
  /** Reset the transform to logical units (offset by the camera) and optionally clear. */
  begin(clear?: boolean, camera?: ViewCamera): void;
  /** Client (CSS) coordinates to logical coordinates, through the camera of the last begin(). */
  toLogical(clientX: number, clientY: number): { x: number; y: number };
  destroy(): void;
};

export function createPixelView(canvas: HTMLCanvasElement, width: number, height: number, options: PixelViewOptions | (() => void) = {}): PixelView {
  const { onResize, zoomFor, overscan = false } = typeof options === "function" ? { onResize: options, zoomFor: undefined } : options;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  const style = canvas.style;
  // Defaults only: the embedding UI may size the canvas with its own CSS.
  if (!style.width) style.width = "100%";
  if (!style.height) style.height = "100%";
  if (!style.display) style.display = "block";
  style.objectFit = "contain";
  style.touchAction = "none";
  style.userSelect = "none";
  style.setProperty("-webkit-tap-highlight-color", "transparent");
  style.setProperty("-webkit-user-select", "none");

  let ratio = 0, cssScale = 1, zoom = 1, dpr = 0, cssWidth = 0, cssHeight = 0, pending = true, layout = 0;
  let viewWidth = width, viewHeight = height;
  let camera: ViewCamera = { x: 0, y: 0 };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => { pending = true; onResize?.(); }) : null;
  observer?.observe(canvas);
  const onWindowResize = () => { pending = true; onResize?.(); };
  window.addEventListener("resize", onWindowResize);

  const view: PixelView = {
    ctx,
    get ratio() { return ratio; },
    get cssScale() { return cssScale; },
    get zoom() { return zoom; },
    get viewWidth() { return viewWidth; },
    get viewHeight() { return viewHeight; },
    get boxWidth() { return cssWidth; },
    get boxHeight() { return cssHeight; },
    get layout() { return layout; },
    get camera() { return camera; },
    sync() {
      const nextDpr = window.devicePixelRatio || 1;
      if (!pending && nextDpr === dpr) return false;
      pending = false;
      const box = canvas.getBoundingClientRect();
      const nextWidth = box.width || width, nextHeight = box.height || height;
      const fit = Math.min(nextWidth / width, nextHeight / height) || 1;
      const nextZoom = Math.max(1, zoomFor?.(nextWidth, nextHeight, fit) ?? 1);
      if (nextDpr === dpr && nextWidth === cssWidth && nextHeight === cssHeight && nextZoom === zoom && ratio) return false;
      dpr = nextDpr; cssWidth = nextWidth; cssHeight = nextHeight; zoom = nextZoom;
      const scale = fit * zoom;
      const device = scale * dpr;
      const next = Math.max(1, Math.min(3, Math.ceil(device - 0.05)));
      // The visible region: the whole plane at zoom 1, otherwise the box's aspect (never beyond the plane,
      // except past its top and bottom with overscan).
      const backingWidth = Math.max(1, Math.round(Math.min(width, cssWidth / scale) * next));
      const backingHeight = Math.max(1, Math.round(Math.min(overscan && zoom > 1 ? Infinity : height, cssHeight / scale) * next));
      viewWidth = backingWidth / next; viewHeight = backingHeight / next;
      cssScale = Math.min(cssWidth / viewWidth, cssHeight / viewHeight) || 1;
      // Downscaling a sharp buffer looks best smoothed; upscaling must stay pixelated.
      style.imageRendering = next >= device - 0.01 ? "auto" : "pixelated";
      ratio = next;
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) { canvas.width = backingWidth; canvas.height = backingHeight; }
      ctx.imageSmoothingEnabled = false;
      layout++;
      return true;
    },
    begin(clear = true, next = camera) {
      camera = next;
      ctx.setTransform(ratio, 0, 0, ratio, -Math.round(camera.x * ratio), -Math.round(camera.y * ratio));
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
      if (clear) ctx.clearRect(camera.x - 1, camera.y - 1, viewWidth + 2, viewHeight + 2);
    },
    toLogical(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const scale = Math.min(box.width / viewWidth, box.height / viewHeight) || 1;
      const offsetX = (box.width - viewWidth * scale) / 2, offsetY = (box.height - viewHeight * scale) / 2;
      return { x: camera.x + (clientX - box.left - offsetX) / scale, y: camera.y + (clientY - box.top - offsetY) / scale };
    },
    destroy() {
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
    },
  };
  view.sync();
  return view;
}
