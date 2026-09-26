import { PixelIcon } from "./PixelIcon.tsx";
import { ALL_FAMILIES, type Collection } from "./collection.ts";
import { cx } from "./shared.ts";

export type HudProps = Readonly<{
  /** Preformatted Simulated RF balance, e.g. "19 RF". */
  balance: string;
  eggs: number;
  broodCount: number;
  muted: boolean;
  onToggleSound: () => void;
  /** Opens the settings / how-to-play panel. */
  onOpenSettings: () => void;
  /** Optional: makes the brood counter a button that opens the brood. */
  onOpenBrood?: () => void;
  /** Disables the buttons (e.g. while the runtime is paused). */
  disabled?: boolean;
  /** Collection progress: families collected, shown next to the brood count on wide layouts. */
  collection?: Collection;
}>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Top-left stats pill and top-right icon buttons. Leaves both bottom corners free for the runtime. */
export function Hud({ balance, eggs, broodCount, muted, onToggleSound, onOpenSettings, onOpenBrood, disabled, collection }: HudProps) {
  const families = collection && { found: collection.families.length, total: ALL_FAMILIES.length };
  const brood = <>
    <PixelIcon name="baby" />
    <span className="rb-hud-num">{broodCount}</span>
    <span className="rb-sr-only">{broodCount === 1 ? "baby in your brood" : "babies in your brood"}</span>
    {families && <span className={cx("rb-hud-families", families.found >= families.total && "rb-hud-done")}>
      <PixelIcon name="dna" />
      <span className="rb-hud-num">{families.found}<span className="rb-hud-of">/{families.total}</span></span>
      <span className="rb-sr-only">, {families.found} of {families.total} families collected</span>
    </span>}
  </>;
  return <div className="rb-hud">
    <div className="rb-hud-stats" role="group" aria-label="Your nursery">
      <span className="rb-hud-stat rb-hud-balance" title="Simulated RF balance">
        <span className="rb-sr-only">Simulated balance:</span>
        <span className="rb-hud-tag" aria-hidden="true"><span className="rb-long">Simulated</span><span className="rb-short">Sim</span></span>
        <span className="rb-hud-num">{balance}</span>
      </span>
      <span className="rb-hud-stat" title={plural(eggs, "egg", "eggs")}>
        <PixelIcon name="egg" />
        <span className="rb-hud-num">{eggs}</span>
        <span className="rb-sr-only">{eggs === 1 ? "egg" : "eggs"}</span>
      </span>
      {onOpenBrood
        ? <button type="button" className="rb-hud-stat rb-hud-stat-button" onClick={onOpenBrood} disabled={disabled}
            title={families ? `Open your brood (${families.found} of ${families.total} families collected)` : "Open your brood"}>{brood}</button>
        : <span className="rb-hud-stat" title={plural(broodCount, "baby", "babies")}>{brood}</span>}
    </div>
    <div className="rb-hud-tools">
      <button type="button" className="rb-icon-button" onClick={onToggleSound} disabled={disabled}
        aria-pressed={!muted} aria-label="Sound" title={muted ? "Sound is off" : "Sound is on"}>
        <PixelIcon name={muted ? "soundOff" : "soundOn"} />
      </button>
      <button type="button" className="rb-icon-button" onClick={onOpenSettings} disabled={disabled}
        aria-label="How to play and settings" title="How to play and settings">
        <PixelIcon name="help" />
      </button>
    </div>
  </div>;
}
