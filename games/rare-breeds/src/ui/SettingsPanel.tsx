import type { ReactNode } from "react";
import { formatChance, formatRF } from "../economy.ts";
import { LAUNCH_ZONES, MOON_FUND_START, multiplierLabel } from "../slingshot.ts";
import type { Creature } from "../types.ts";
import { HudLegend, StationLegend, type HudSample } from "./Legend.tsx";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { AVERAGE_BACK } from "./SlingshotPanel.tsx";
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
  /** Current simulated Moon Fund, preformatted (e.g. "594 RF"), shown in the Moon Slingshot rules. */
  moonFund?: string;
  /** The player's Friend: shows the room picture in the Stations legend. */
  player?: Creature;
  /** Live HUD values: shows the "Your screen" legend. */
  hud?: HudSample;
}>;

/** The top multiplier as "10x": a launch needs the Moon Fund to cover this much of the baby's value. */
const TOP_MULTIPLIER = `${multiplierLabel(LAUNCH_ZONES[LAUNCH_ZONES.length - 1].multiplierBps).slice(1)}x`;

function Switch({ label, detail, checked, onToggle }: { label: string; detail: string; checked: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} className="rb-switch" onClick={onToggle}>
    <span className="rb-switch-text"><strong>{label}</strong><span>{detail}</span></span>
    <span className="rb-switch-track" aria-hidden="true"><span className="rb-switch-knob" /></span>
    <span className="rb-switch-state" aria-hidden="true">{checked ? "On" : "Off"}</span>
  </button>;
}

/** Sound and motion settings, how to play, the stations and HUD legends, the exact odds table and the simulation notice. */
export function SettingsPanel({ muted, onToggleSound, reducedMotion, onToggleReducedMotion, odds, price, onClose, note, onReplayIntro, moonFund, player, hud }: SettingsPanelProps) {
  return <Panel eyebrow="Rare Breeds" title="How to play" onClose={onClose} size="md" className="rb-settings">
    <p className="rb-notice" role="note"><PixelIcon name="sparkle" /><span>Everything here is simulated: RF ($RAREFRIENDS) balances, eggs and hatches. No real money moves, no transactions are sent, and reloading starts a fresh session.</span></p>
    {onReplayIntro && <button type="button" className="rb-button rb-button-ghost rb-replay" onClick={onReplayIntro}>
      <PixelIcon name="back" className="rb-flip" /><span>Replay intro</span></button>}

    <ol className="rb-steps">
      <li><strong>Find a match.</strong> Pick a parent and one of three real Rare Friends. New faces are free.</li>
      <li><strong>Hatch an egg.</strong> Each egg costs {price} (simulated). Rare Friends asks you to confirm Buy egg and Use egg; both are previews.</li>
      <li><strong>Meet the baby.</strong> Every pixel row comes from one parent, walk cycle included.</li>
      <li><strong>Keep or trade in.</strong> Kept babies follow you, earn Hearts and can breed again; each generation counts up (F1, F2, F3). The Sanctuary trades a baby in for a fixed simulated RF value.</li>
      <li><strong>Feeling lucky?</strong> Launch a kept baby from the Moon Slingshot. Where it lands pays x0 to x10 its value.</li>
      <li><strong>Spend Hearts.</strong> Hearts are game points, never RF. Tap the heart counter to buy hats for your Friend and babies, or a Wish match (three mates from a family you pick).</li>
      <li><strong>Collect them all.</strong> Hatch babies from all 9 Friend families and find all 4 tiers. Your brood tracks the set.</li>
    </ol>

    <h3 className="rb-section-label">Stations</h3>
    <StationLegend player={player} price={price} compact />
    {hud && <>
      <h3 className="rb-section-label">Your screen</h3>
      <HudLegend sample={hud} help />
    </>}

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

    <h3 className="rb-section-label"><PixelIcon name="moon" />Moon Slingshot · per launch</h3>
    <p className="rb-sling-about">Pick a kept baby, hold to pull the band, let go. A launch trades the baby in for its Sanctuary value
      (runtime confirmation), paid into your balance as usual; that value is the stake. Where it lands pays stake x multiplier,
      and the difference to the stake goes to your Slingshot net.
      <strong> The baby is gone after the launch, even in the pond.</strong></p>
    <table className="rb-odds rb-sling-odds">
      <thead><tr><th scope="col">Lands on</th><th scope="col">Chance</th><th scope="col">Multiplier</th></tr></thead>
      <tbody>{[...LAUNCH_ZONES].reverse().map(zone => <tr key={zone.id} className={`rb-zone-${zone.id}`}>
        <th scope="row">{zone.label}</th>
        <td>{formatChance(zone.chanceBps)}</td>
        <td>{multiplierLabel(zone.multiplierBps)}</td>
      </tr>)}</tbody>
    </table>
    <p className="rb-muted rb-small">On average {AVERAGE_BACK}x the stake comes back. Payouts come from the simulated Moon Fund
      (it starts at {formatRF(MOON_FUND_START)}{moonFund ? `, now ${moonFund}` : ""}); the Slingshot net (payouts minus stakes) is its own HUD counter, apart from
      your balance and not spendable in this preview. A launch needs the fund to cover {TOP_MULTIPLIER} the baby's value. Where it lands is random with these odds; how hard you pull is just for fun.</p>

    <h3 className="rb-section-label">Settings</h3>
    <div className="rb-switches">
      <Switch label="Sound" detail="Chirps, cracks and hearts" checked={!muted} onToggle={onToggleSound} />
      <Switch label="Reduce motion" detail="Calmer animations" checked={reducedMotion} onToggle={onToggleReducedMotion} />
    </div>
  </Panel>;
}
