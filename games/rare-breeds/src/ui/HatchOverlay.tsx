import { useRef, type ReactNode, type Ref } from "react";
import { PixelIcon } from "./PixelIcon.tsx";
import { cx, useModalFocus, useReducedMotion } from "./shared.ts";

export type HatchOverlayProps = Readonly<{
  /** "hatching" shows the renderer canvas and Skip; "result" also shows `children` (the BabyCard). */
  stage: "hatching" | "result";
  /**
   * Receives the overlay canvas. Pass it to createHatchSequence({ canvas, ... }).
   * A callback ref (e.g. a useState setter) tells you exactly when the canvas exists.
   */
  canvasRef: Ref<HTMLCanvasElement>;
  /** Skip to the reveal (call sequence.skip()). Also bound to Escape while hatching. */
  onSkip?: () => void;
  /** Escape on the result stage. The baby is already kept, so this is usually the same as Keep. */
  onClose?: () => void;
  /** Usually <BabyCard mode="reveal" ... />. Rendered only on the result stage. */
  children?: ReactNode;
  /** Screen reader status while hatching. Default "Your egg is hatching". */
  label?: string;
  reducedMotion?: boolean;
}>;

/** Full-area overlay for the hatch sequence, then the result card over the final frame. */
export function HatchOverlay({ stage, canvasRef, onSkip, onClose, children, label = "Your egg is hatching", reducedMotion }: HatchOverlayProps) {
  const node = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion(reducedMotion);
  const hatching = stage === "hatching";
  useModalFocus(node, hatching ? onSkip : onClose, stage);
  return <div ref={node} className={cx("rb-hatch", !reduced && "rb-animate")} data-stage={stage} role="dialog" aria-modal="true"
    aria-label={hatching ? label : "Your new baby"} tabIndex={-1}>
    <canvas ref={canvasRef} className="rb-hatch-canvas" aria-hidden="true" />
    <p className="rb-sr-only" role="status">{hatching ? `${label}…` : "Hatched!"}</p>
    {hatching && onSkip && <button type="button" className="rb-button rb-button-dark rb-hatch-skip" onClick={onSkip}>
      <span>Skip</span><PixelIcon name="back" className="rb-flip" />
    </button>}
    {!hatching && <div className="rb-hatch-result">{children}</div>}
  </div>;
}
