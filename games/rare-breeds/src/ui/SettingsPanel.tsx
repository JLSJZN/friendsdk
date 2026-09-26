import type { ReactNode } from "react";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { tierLabel, tierVars, type TierInfo } from "./shared.ts";

export type SettingsPanelProps = Readonly<{
  muted: boolean;
  onToggleSound: () => void;
  reducedMotion: boolean;
  onToggleReducedMotion: () => void;
  /** Exact odds, one row per tier in TIER_ORDER: chance ("60%") and fixed Sanctuary value ("0.5 RF"). */
  odds: readonly TierInfo[];
  /** Preformatted egg price, e.g. "1 RF". */
  price: string;
  onClose: () => void;
  /** Optional extra economy line under the table, e.g. the expected value per egg. */
  note?: ReactNode;
  /** Shows a "Replay intro" button that reopens the first-run tour. */
  onReplayIntro?: () => void;
}>;

function Switch({ label, detail, checked, onToggle }: { label: string; detail: string; checked: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} className="rb-switch" onClick={onToggle}>
    <span className="rb-switch-text"><strong>{label}</strong><span>{detail}</span></span>
    <span className="rb-switch-track" aria-hidden="true"><span className="rb-switch-knob" /></span>
    <span className="rb-switch-state" aria-hidden="true">{checked ? "On" : "Off"}</span>
  </button>;
}

/** Sound and motion settings, how to play, the exact odds table and the simulation notice. */
export function SettingsPanel({ muted, onToggleSound, reducedMotion, onToggleReducedMotion, odds, price, onClose, note, onReplayIntro }: SettingsPanelProps) {
  return <Panel eyebrow="Rare Breeds" title="How to play" onClose={onClose} size="md" className="rb-settings">
    <p className="rb-notice" role="note"><PixelIcon name="sparkle" /><span>Everything here is simulated: RF ($RAREFRIENDS) balances, eggs and hatches. No real money moves, no transactions are sent, and reloading starts a fresh session.</span></p>
    {onReplayIntro && <button type="button" className="rb-button rb-button-ghost rb-replay" onClick={onReplayIntro}>
      <PixelIcon name="back" className="rb-flip" /><span>Replay intro</span></button>}

    <ol className="rb-steps">
      <li><strong>Find a match.</strong> Pick a parent and one of three real Rare Friends. New faces are free.</li>
      <li><strong>Hatch an egg.</strong> Each egg costs {price} (simulated). Rare Friends asks you to confirm Buy egg and Use egg; both are previews.</li>
      <li><strong>Meet the baby.</strong> Every pixel row comes from one parent, walk cycle included.</li>
      <li><strong>Keep or trade in.</strong> Kept babies follow you, earn Hearts and can breed again (F1, F2, F3). The Sanctuary trades a baby in for a fixed simulated RF value.</li>
      <li><strong>Spend Hearts.</strong> Hearts are game points, never RF. Tap the heart counter to buy hats for your Friend and babies, or a Wish match (three mates from a family you pick).</li>
      <li><strong>Collect them all.</strong> Hatch babies from all 9 Friend families and find all 4 tiers. Your brood tracks the set.</li>
    </ol>
    <p className="rb-controls rb-muted rb-small">
      Walk with <kbd className="rb-kbd">WASD</kbd> / arrows or tap the floor. Use a station with <kbd className="rb-kbd">E</kbd>, Enter, Space or a tap:
      the MATCH terminal finds a mate, the egg incubator sells eggs, the Sanctuary gate takes babies you trade in.
    </p>

    <h3 className="rb-section-label">Hatch odds · per egg</h3>
    <table className="rb-odds">
      <thead><tr><th scope="col">Tier</th><th scope="col">Chance</th><th scope="col">Sanctuary value</th></tr></thead>
      <tbody>{odds.map(row => <tr key={row.tier} className={`rb-tier-${row.tier}`} style={tierVars(row.tier)}>
        <th scope="row"><span className="rb-tier-badge rb-tier-badge-sm">{tierLabel(row.tier)}</span></th>
        <td>{row.chance}</td>
        <td>{row.value}</td>
      </tr>)}</tbody>
    </table>
    <p className="rb-muted rb-small">Values are in Simulated RF. The tier is decided by the game's odds when the egg hatches; which parents you pick never changes it.{note ? <> {note}</> : null}</p>

    <h3 className="rb-section-label">Settings</h3>
    <div className="rb-switches">
      <Switch label="Sound" detail="Chirps, cracks and hearts" checked={!muted} onToggle={onToggleSound} />
      <Switch label="Reduce motion" detail="Calmer animations" checked={reducedMotion} onToggle={onToggleReducedMotion} />
    </div>
  </Panel>;
}
