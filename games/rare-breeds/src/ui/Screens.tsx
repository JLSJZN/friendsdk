import { PixelIcon } from "./PixelIcon.tsx";
import { cx, useReducedMotion } from "./shared.ts";

export type LoadingScreenProps = Readonly<{
  /** Default "Loading your Friend…". */
  label?: string;
  detail?: string;
  reducedMotion?: boolean;
}>;

function Wordmark() {
  return <p className="rb-wordmark" aria-hidden="true"><span>Rare</span><span>Breeds</span></p>;
}

/** Full-area loading state for the game's own loading (e.g. the Friend's on-chain art). */
export function LoadingScreen({ label = "Loading your Friend…", detail, reducedMotion }: LoadingScreenProps) {
  const reduced = useReducedMotion(reducedMotion);
  return <div className={cx("rb-screen", !reduced && "rb-animate")} role="status" aria-live="polite">
    <span className="rb-screen-art rb-screen-egg" aria-hidden="true"><PixelIcon name="eggBig" pixel={6} /></span>
    <Wordmark />
    <p className="rb-screen-label">{label}</p>
    {detail && <p className="rb-screen-detail">{detail}</p>}
    <span className="rb-loading-dots" aria-hidden="true"><i /><i /><i /></span>
  </div>;
}

export type ErrorScreenProps = Readonly<{
  /** Default "The nursery didn't load". */
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Default "Retry". */
  retryLabel?: string;
}>;

/** Full-area error state with Retry. */
export function ErrorScreen({ title = "The nursery didn't load", message, onRetry, retrying, retryLabel = "Retry" }: ErrorScreenProps) {
  return <div className="rb-screen rb-screen-error" role="alert">
    <span className="rb-screen-art" aria-hidden="true"><PixelIcon name="eggCrackedBig" pixel={6} /></span>
    <p className="rb-screen-title">{title}</p>
    <p className="rb-screen-detail">{message}</p>
    {onRetry && <button type="button" className="rb-button rb-button-primary rb-button-lg" onClick={onRetry} disabled={retrying} autoFocus>
      {retrying ? <span className="rb-spinner" aria-hidden="true" /> : <PixelIcon name="dice" />}
      <span>{retrying ? "Retrying…" : retryLabel}</span>
    </button>}
  </div>;
}
