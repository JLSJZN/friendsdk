// Legends shared by the intro tour and the "?" panel: the four stations on a picture of the real room, and the HUD.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { PICTURE_HEIGHT, PICTURE_MARKERS, PICTURE_WIDTH, paintRoomPicture } from "../scene/picture.ts";
import { LAUNCH_ZONES, multiplierLabel } from "../slingshot.ts";
import type { Creature, StationId } from "../types.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { signedRF } from "./SlingshotPanel.tsx";
import { ALL_FAMILIES } from "./collection.ts";
import { cx, useDevicePixelRatio } from "./shared.ts";

const multipliers = LAUNCH_ZONES.map(zone => zone.multiplierBps);
/** "x0 to x10": the Moon Slingshot's lowest and highest landing. */
export const MULTIPLIER_RANGE = `${multiplierLabel(Math.min(...multipliers))} to ${multiplierLabel(Math.max(...multipliers))}`;

/** The stations in tour order (the numbers on the room picture). */
const STATION_ORDER: readonly StationId[] = ["matchmaker", "incubator", "sanctuary", "slingshot"];

function stationItems(price: string): Readonly<Record<StationId, { name: string; detail: string }>> {
  return {
    matchmaker: { name: "Matchmaker", detail: "Pick a mate for your Friend and breed." },
    incubator: { name: "Incubator", detail: `Optional: stock up on eggs. Find a match buys one for you (${price}, simulated).` },
    sanctuary: { name: "Sanctuary", detail: "Trade a baby in for fixed simulated RF." },
    slingshot: { name: "Moon Slingshot", detail: `Launch a kept baby: where it lands pays ${MULTIPLIER_RANGE} its value.` },
  };
}

/** The real room (scene art) with a numbered pin on each station and a "You" tag on the Friend. */
export function RoomMap({ player }: { player: Creature }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ratio = useDevicePixelRatio();
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const paint = () => paintRoomPicture(node, player, ratio);
    paint();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(paint);
    observer.observe(node);
    return () => observer.disconnect();
  }, [player, ratio]);
  return <figure className="rb-map" style={{ aspectRatio: `${PICTURE_WIDTH} / ${PICTURE_HEIGHT}` }}>
    <canvas ref={canvas} className="rb-map-canvas" aria-hidden="true" />
    {PICTURE_MARKERS.map(({ id, x, y }) => <span key={id} className={cx("rb-map-pin", id === "you" && "rb-map-you")}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }} aria-hidden="true">{id === "you" ? "You" : STATION_ORDER.indexOf(id) + 1}</span>)}
    <figcaption className="rb-sr-only">The nursery: 1 the Matchmaker kiosk on the left, 2 the Incubator on the back wall,
      3 the Sanctuary arch on the right, 4 the Moon Slingshot in front of the right-hand window. Your Friend stands on the rug.</figcaption>
  </figure>;
}

/** The four stations: the room picture (when `player` is given), a numbered list and how to use them. */
export function StationLegend({ player, price, compact }: { player?: Creature; price: string; compact?: boolean }) {
  const items = stationItems(price);
  return <div className={cx("rb-legend-stations", compact && "rb-legend-compact", !player && "rb-legend-nomap")}>
    {player && <RoomMap player={player} />}
    <ol className="rb-legend-list">
      {STATION_ORDER.map((id, index) => <li key={id}>
        <span className="rb-legend-num" aria-hidden="true">{index + 1}</span>
        <span className="rb-legend-text"><strong>{items[id].name}</strong> <span>{items[id].detail}</span></span>
      </li>)}
    </ol>
    <p className="rb-legend-how">Walk there (<kbd className="rb-kbd">WASD</kbd> / arrows, or tap the floor),
      then press <kbd className="rb-kbd">E</kbd> or tap the station.</p>
  </div>;
}

/** Live HUD values for the replicas (at the start of a session: 0 Hearts, the start balance, 0 eggs...). */
export type HudSample = Readonly<{ hearts: number; balance: string; eggs: number; brood: number; families: number; net: bigint }>;

/** A static copy of one HUD chip, with the HUD's own classes so it looks the same at every frame size. */
const Chip = ({ children }: { children: ReactNode }) => <span className="rb-hud-stats rb-legend-chip"><span className="rb-hud-stat">{children}</span></span>;
const Tool = ({ children }: { children: ReactNode }) => <span className="rb-icon-button rb-legend-tool">{children}</span>;
const Num = ({ children }: { children: ReactNode }) => <span className="rb-hud-num">{children}</span>;

/** What each part of the HUD is. `help` words the "?" line for the help panel itself. */
export function HudLegend({ sample, help }: { sample: HudSample; help?: boolean }) {
  const rows: readonly (readonly [string, ReactNode, ReactNode, string?])[] = [
    ["hearts", <Chip><PixelIcon name="heart" /><Num>{sample.hearts}</Num></Chip>, <><strong>Hearts</strong>: game points from kept babies, never RF. Tap for the shop.</>],
    ["balance", <Chip><span className="rb-hud-tag"><span className="rb-long">Simulated</span><span className="rb-short">Sim</span></span><Num>{sample.balance}</Num></Chip>,
      <><strong>Balance</strong>: simulated RF ($RAREFRIENDS), no real money.</>],
    ["eggs", <Chip><PixelIcon name="egg" /><Num>{sample.eggs}</Num></Chip>, <><strong>Eggs</strong>: waiting to hatch. Each breed uses one.</>],
    ["brood", <Chip><PixelIcon name="baby" /><Num>{sample.brood}</Num></Chip>, <><strong>Brood</strong>: the babies you kept. Tap to see them.</>],
    ["families", <Chip><PixelIcon name="dna" /><Num>{sample.families}<span className="rb-hud-of">/{ALL_FAMILIES.length}</span></Num></Chip>,
      <><strong>Families</strong>: collected so far, out of {ALL_FAMILIES.length}.</>, "rb-legend-wide"],
    ["net", <span className="rb-hud-sling rb-legend-chip"><PixelIcon name="moon" />
      <span className="rb-hud-sling-word"><span className="rb-long">Slingshot</span><span className="rb-short">Net</span></span>
      <Num>{signedRF(sample.net)}</Num><span className="rb-hud-tag">Sim</span></span>,
      <><strong>Slingshot net</strong>: <span className="rb-legend-long">what your launches paid, minus the babies' value you bet. Separate from your balance, not spendable. Shows after your first launch.</span><span className="rb-legend-short">launch wins minus the value you bet, kept apart from your balance. Shows after your first launch.</span></>],
    ["tools", <span className="rb-legend-tools"><Tool><PixelIcon name="soundOn" /></Tool><Tool><PixelIcon name="help" /></Tool></span>,
      <><strong>Sound</strong> on or off. <strong>Help</strong>: {help ? "this panel (Replay intro is at the top)." : "rules, odds, settings; replays this tour."}</>],
  ];
  return <ul className="rb-legend-hud">
    {rows.map(([key, chip, text, extra]) => <li key={key} className={cx("rb-legend-row", extra)}>
      <span className="rb-legend-chip-slot" aria-hidden="true">{chip}</span>
      <p>{text}</p>
    </li>)}
  </ul>;
}
