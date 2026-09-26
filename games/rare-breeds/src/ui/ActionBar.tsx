import { PixelIcon } from "./PixelIcon.tsx";

export type StationPrompt = Readonly<{
  /** What happens, e.g. "Open the Matchmaker". */
  label: string;
  /** Key hint, default "E". Hidden on touch-sized layouts. */
  keyHint?: string;
  onActivate: () => void;
}>;

export type ActionBarProps = Readonly<{
  onFindMatch: () => void;
  broodCount: number;
  onOpenBrood: () => void;
  /** Default "Find a match". */
  primaryLabel?: string;
  disabled?: boolean;
  /** Shown while the player stands near a station. */
  prompt?: StationPrompt | null;
  /** Small controls hint for wide layouts, e.g. "WASD or tap to walk". Hidden when compact. */
  hint?: string;
}>;

/**
 * Bottom actions. Wide layouts centre them; compact (phone) layouts shrink them into one slim row in the
 * bottom-right corner so the middle of the world stays visible. Always above the runtime toolbar band
 * (wallet/Friend controls bottom-left, menu bottom-right), so it never collides with them at any frame size.
 */
export function ActionBar({ onFindMatch, broodCount, onOpenBrood, primaryLabel = "Find a match", disabled, prompt, hint }: ActionBarProps) {
  return <div className="rb-actionbar">
    {prompt ? <button type="button" className="rb-prompt" onClick={prompt.onActivate} disabled={disabled}>
      <kbd className="rb-kbd" aria-hidden="true">{prompt.keyHint ?? "E"}</kbd>
      <span>{prompt.label}</span>
    </button> : hint ? <p className="rb-actionbar-hint">{hint}</p> : null}
    <div className="rb-actionbar-row">
      <button type="button" className="rb-button rb-button-primary rb-button-lg rb-find" onClick={onFindMatch} disabled={disabled}>
        <PixelIcon name="heart" />
        <span>{primaryLabel}</span>
      </button>
      <button type="button" className="rb-button rb-button-dark rb-button-lg rb-brood-button" onClick={onOpenBrood} disabled={disabled}
        aria-label={`Brood, ${broodCount} ${broodCount === 1 ? "baby" : "babies"}`}>
        <PixelIcon name="baby" />
        <span aria-hidden="true"><span className="rb-brood-word">Brood </span><span className="rb-count">{broodCount}</span></span>
      </button>
    </div>
  </div>;
}
