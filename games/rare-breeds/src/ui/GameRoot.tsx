import type { ReactNode } from "react";
import { cx, MotionContext } from "./shared.ts";

export type GameRootProps = Readonly<{
  children: ReactNode;
  /** Applies to every Rare Breeds component inside (canvas animation and CSS motion). */
  reducedMotion?: boolean;
  /** Accessible name for the game region. */
  label?: string;
  busy?: boolean;
  className?: string;
}>;

/**
 * Full-size game container. It is the CSS size container the UI layout responds to
 * (compact under 600 x 480) and carries the reduced-motion setting. Render the world
 * canvas and every UI component inside it.
 */
export function GameRoot({ children, reducedMotion, label = "Rare Breeds", busy, className }: GameRootProps) {
  return <section className={cx("rb-root", className)} aria-label={label} aria-busy={busy || undefined}
    data-reduced-motion={reducedMotion === undefined ? undefined : String(reducedMotion)}>
    <MotionContext.Provider value={reducedMotion ?? null}>
      <div className="rb-stage">{children}</div>
    </MotionContext.Provider>
  </section>;
}

/** Full-area layer for the world canvas and HUD. Set inert while a panel or overlay is open. */
export function WorldLayer({ children, inert, className }: { children: ReactNode; inert?: boolean; className?: string }) {
  return <div className={cx("rb-world", className)} inert={inert || undefined}>{children}</div>;
}
