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
  /** Hearts balance (game points, never RF). Shown first in the pill: the scene's heart particles fly there. */
  hearts?: number;
  /** Makes the Hearts counter a button that opens the Hearts shop. */
  onOpenShop?: () => void;
}>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Top-left stats pill and top-right icon buttons. Leaves both bottom corners free for the runtime. */
export function Hud({ balance, eggs, broodCount, muted, onToggleSound, onOpenSettings, onOpenBrood, disabled, collection, hearts, onOpenShop }: HudProps) {
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
      {hearts !== undefined && (onOpenShop
        ? <button type="button" className="rb-hud-stat rb-hud-stat-button rb-hud-hearts" onClick={onOpenShop} disabled={disabled}
            title="Hearts: game points your kept babies earn. Not RF. Tap for the shop.">
            <PixelIcon name="heart" />
            <span key={hearts} className="rb-hud-num rb-hud-bump">{hearts}</span>
            <span className="rb-sr-only">Hearts, open the shop</span>
          </button>
        : <span className="rb-hud-stat rb-hud-hearts" title="Hearts: game points your kept babies earn. Not RF.">
            <PixelIcon name="heart" /><span className="rb-hud-num">{hearts}</span><span className="rb-sr-only">Hearts</span>
          </span>)}
      <span className="rb-hud-stat rb-hud-balance" title="Simulated RF ($RAREFRIENDS) balance. No real money.">
        <span className="rb-sr-only">Simulated balance:</span>
        <span className="rb-hud-tag" aria-hidden="true"><span className="rb-long">Simulated</span><span className="rb-short">Sim</span></span>
        <span className="rb-hud-num">{balance}</span>
      </span>
      <span className="rb-hud-stat" title={`${plural(eggs, "egg", "eggs")} waiting. One egg per hatch.`}>
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
