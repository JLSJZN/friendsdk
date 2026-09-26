import { useEffect, useRef } from "react";
import { PixelIcon } from "./PixelIcon.tsx";
import { cx } from "./shared.ts";

export type ToastProps = Readonly<{
  message: string;
  tone?: "info" | "success" | "error";
  /** Called after `duration` ms (default 3200) or when the close button is pressed. */
  onDismiss?: () => void;
  /** Auto-dismiss delay in ms; 0 keeps it until dismissed. Errors default to 0. */
  duration?: number;
}>;

/** Short message under the HUD, e.g. "Zibu joined your brood". The timer restarts when the message changes. */
export function Toast({ message, tone = "info", onDismiss, duration }: ToastProps) {
  const delay = duration ?? (tone === "error" ? 0 : 3200);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!delay) return;
    const timer = window.setTimeout(() => dismiss.current?.(), delay);
    return () => window.clearTimeout(timer);
  }, [delay, message]);
  return <div className={cx("rb-toast", `rb-toast-${tone}`)} role={tone === "error" ? "alert" : "status"}>
    <PixelIcon name={tone === "error" ? "eggCracked" : tone === "success" ? "sparkle" : "heart"} />
    <span className="rb-toast-text">{message}</span>
    {onDismiss && <button type="button" className="rb-toast-close" onClick={onDismiss} aria-label="Dismiss"><PixelIcon name="close" /></button>}
  </div>;
}
