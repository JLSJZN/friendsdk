import { useId, useRef, type ReactNode } from "react";
import { PixelIcon } from "./PixelIcon.tsx";
import { cx, useModalFocus } from "./shared.ts";

export type PanelProps = Readonly<{
  title: string;
  /** Small uppercase label above the title, e.g. "Matchmaker". */
  eyebrow?: string;
  /** Close button, Escape and backdrop click. Omit (e.g. while busy) to make the panel non-dismissable. */
  onClose?: () => void;
  children: ReactNode;
  /** Sticky area under the scrolling body, e.g. the primary action. */
  footer?: ReactNode;
  /** Header slot before the title, e.g. a back button. */
  headerStart?: ReactNode;
  /** Max card width: sm 440, md 600, lg 760 px. Default md. */
  size?: "sm" | "md" | "lg";
  /** Change it to move focus back to the first control (e.g. when switching views inside the panel). */
  focusKey?: unknown;
  className?: string;
}>;

/** Centred modal card: aria-modal dialog, initial focus, focus trap, Escape to close, scrolls inside. */
export function Panel({ title, eyebrow, onClose, children, footer, headerStart, size = "md", focusKey, className }: PanelProps) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  useModalFocus(node, onClose, focusKey);
  return <div className="rb-scrim" onClick={event => { if (event.target === event.currentTarget && onClose) onClose(); }}>
    <div ref={node} className={cx("rb-panel", `rb-panel-${size}`, className)} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
      tabIndex={-1}>
      <header className="rb-panel-head" data-focus-late>
        {headerStart}
        <div className="rb-panel-titles">
          {eyebrow && <p className="rb-eyebrow">{eyebrow}</p>}
          <h2 id={`${id}-title`} className="rb-panel-title">{title}</h2>
        </div>
        {onClose && <button type="button" className="rb-icon-button rb-panel-close" onClick={onClose} aria-label={`Close ${title}`}>
          <PixelIcon name="close" />
        </button>}
      </header>
      <div className="rb-panel-body">{children}</div>
      {footer && <footer className="rb-panel-foot">{footer}</footer>}
    </div>
  </div>;
}
