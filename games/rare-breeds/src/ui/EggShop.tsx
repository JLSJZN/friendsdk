import { useState, type ReactNode } from "react";
import { Panel } from "./Panel.tsx";
import { PixelIcon } from "./PixelIcon.tsx";

export type EggPack = Readonly<{
  quantity: bigint;
  /** Preformatted total price, e.g. "3 RF". */
  price: string;
  /** The runtime would refuse this pack right now (balance or prize backing). */
  disabled?: boolean;
}>;

export type EggShopPanelProps = Readonly<{
  /** Eggs already waiting in the incubator. */
  eggs: number;
  packs: readonly EggPack[];
  /** Preformatted Simulated RF balance, e.g. "20 RF". */
  balance: string;
  /** Extra economy line, e.g. the average Sanctuary value per egg. */
  note?: ReactNode;
  /** Why packs are disabled, shown above the buttons. */
  reason?: string;
  busy?: boolean;
  onBuy: (quantity: bigint) => void;
  /** Omit while busy so the panel cannot be dismissed mid-purchase. */
  onClose?: () => void;
}>;

const eggWord = (count: bigint | number) => `${count} ${count === 1 || count === 1n ? "egg" : "eggs"}`;

/** The incubator station: stock up on eggs in packs (one runtime confirmation per pack). */
export function EggShopPanel({ eggs, packs, balance, note, reason, busy, onBuy, onClose }: EggShopPanelProps) {
  const [pressed, setPressed] = useState<bigint | null>(null);
  return <Panel title="Egg incubator" eyebrow="Simulated RF" size="sm" onClose={onClose} className="rb-eggshop-panel">
    <div className="rb-eggshop">
      <div className="rb-eggshop-stock">
        <span className="rb-slot rb-eggshop-art" aria-hidden="true"><PixelIcon name="eggBig" pixel={3} /></span>
        <p className="rb-eggshop-lead">
          <strong>{eggs === 0 ? "The incubator is empty" : `${eggWord(eggs)} waiting`}</strong>
          <span>Each hatch uses one egg. Buy a pack and you confirm once, not every hatch.</span>
        </p>
      </div>
      {reason && <p className="rb-eggshop-reason rb-warn" role="status">{reason}</p>}
      <div className="rb-eggshop-buttons">
        {packs.map(pack => {
          const active = busy && pressed === pack.quantity;
          return <button key={String(pack.quantity)} type="button" className="rb-button rb-button-primary rb-eggshop-pack"
            disabled={busy || pack.disabled} aria-busy={active || undefined} aria-label={`Buy ${eggWord(pack.quantity)} for ${pack.price} (simulated)`}
            onClick={() => { setPressed(pack.quantity); onBuy(pack.quantity); }}>
            <span className="rb-eggshop-eggs" aria-hidden="true">
              {active ? <span className="rb-spinner" /> : Array.from({ length: Number(pack.quantity) }, (_, index) => <PixelIcon key={index} name="egg" />)}
            </span>
            <span className="rb-eggshop-qty">{eggWord(pack.quantity)}</span>
            <span className="rb-eggshop-price">{pack.price}</span>
          </button>;
        })}
      </div>
      <p className="rb-eggshop-note">Balance {balance} (simulated).{note ? <> {note}</> : null}</p>
    </div>
  </Panel>;
}
