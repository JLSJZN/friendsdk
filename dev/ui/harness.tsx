// Dev-only harness: renders each Rare Breeds UI component with fixture data inside the real SDK frame chrome
// (GameFrame toolbar overlay), so layout can be checked against the runtime controls.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { GameFrame } from "@rarefriends/friendsdk/frame";
import "@rarefriends/friendsdk/frame.css";
// The game's trusted host.css: a 3:4 frame on portrait phones (390 x 520), like the CLI runtime.
import "../../games/rare-breeds/host.css";
import "../../games/rare-breeds/style.css";
import "./harness.css";
import { drawCreature, setupPixelCanvas } from "../../games/rare-breeds/src/draw.ts";
import type { Creature } from "../../games/rare-breeds/src/types.ts";
import {
  ActionBar, BabyCard, BroodPanel, EggShopPanel, ErrorScreen, FriendPanel, GameRoot, HatchOverlay, HeartShopPanel, Hud, IntroPanel, LaunchOverlay, LoadingScreen,
  MatchmakerPanel, PixelIcon, SettingsPanel, SlingshotPanel, SpriteThumb, Toast, WorldLayer, buildCollection, discoveriesOf, type BroodTab, type Collection,
  type HudSample, type PixelIconName,
} from "../../games/rare-breeds/src/ui/index.ts";
import { babies, candidates, creature, player, rerolled, tierInfo, tierRows, tiers, tierValue, wild } from "./fixtures.ts";
import { RF_UNIT } from "../../games/rare-breeds/src/economy.ts";
import { initialLedger, launchBlocker, launchPayout, resolveLaunch, slingshotNet, type LaunchResult, type SlingshotLedger } from "../../games/rare-breeds/src/slingshot.ts";
import type { LaunchZoneId } from "../../games/rare-breeds/src/types.ts";
import { ACCESSORIES } from "../../games/rare-breeds/src/accessories.ts";
import { heartsPerMinute, wishFamilies } from "../../games/rare-breeds/src/hearts.ts";
import type { AccessoryId } from "../../games/rare-breeds/src/types.ts";

const params = new URLSearchParams(location.search);
const reduced = params.has("rm");

/** Collection before a baby hatched: every other fixture baby. &full shows both sets completed. */
const FULL: Collection = { families: ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"],
  tiers: ["common", "spotted", "mutant", "prismatic"] };
const collectionWithout = (baby?: Creature): Collection => params.has("full") ? FULL : buildCollection(babies.filter(item => item !== baby));

/** A fake nursery floor so the HUD is seen over something world-like. */
function FakeWorld({ brood = babies.slice(0, 3) }: { brood?: Creature[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const { ctx } = setupPixelCanvas(element, 960, 640);
    let frame = 0, raf = 0;
    const draw = (now: number) => {
      ctx.fillStyle = "#F4F1EA"; ctx.fillRect(0, 0, 960, 640);
      ctx.strokeStyle = "#E6E1D6"; ctx.lineWidth = 2;
      for (let x = 0; x <= 960; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 640); ctx.stroke(); }
      for (let y = 0; y <= 640; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(960, y); ctx.stroke(); }
      const station = (x: number, y: number, w: number, h: number, label: string) => {
        ctx.fillStyle = "#fff"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "#111"; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = "#CCFF00"; ctx.fillRect(x + 12, y + 12, w - 24, 20);
        ctx.fillStyle = "#111"; ctx.font = "bold 14px ui-monospace, monospace"; ctx.fillText(label, x + 12, y + h - 14);
      };
      station(90, 190, 150, 120, "MATCHMAKER"); station(405, 110, 150, 110, "INCUBATOR"); station(720, 190, 150, 120, "SANCTUARY");
      frame = Math.floor(now / 110) % 8;
      drawCreature(ctx, player, { clip: "walk", facing: "right", frame, x: 430, y: 430, scale: 3 });
      brood.forEach((baby, index) => drawCreature(ctx, baby, { clip: "walk", facing: "right", frame: (frame + index * 3) % 8, x: 370 - index * 50, y: 432, scale: 2, time: now }));
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [brood]);
  return <canvas ref={canvas} className="rb-world-canvas" aria-label="Nursery (fixture)" />;
}

/** Simulates the renderer drawing its hatch frames onto the overlay canvas. */
function useFakeHatch(stage: "hatching" | "result") {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas) return;
    const { ctx } = setupPixelCanvas(canvas, 960, 640);
    let raf = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, 960, 640);
      const wobble = stage === "hatching" ? Math.sin(now / 90) * 6 : 0;
      ctx.save(); ctx.translate(480, 360); ctx.rotate(wobble * Math.PI / 180);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#111"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(0, -40, 70, 92, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#CCFF00"; for (const [x, y] of [[-30, -80], [20, -20], [-10, 10], [35, -70]]) ctx.fillRect(x, y, 14, 14);
      ctx.strokeStyle = "#111"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-60, -40); ctx.lineTo(-30, -60); ctx.lineTo(-5, -35); ctx.lineTo(25, -62); ctx.lineTo(60, -40); ctx.stroke();
      ctx.restore();
      drawCreature(ctx, player, { clip: "idle", facing: "right", frame: Math.floor(now / 110) % 8, x: 250, y: 440, scale: 4 });
      drawCreature(ctx, candidates[0], { clip: "idle", facing: "left", frame: Math.floor(now / 110) % 8, x: 710, y: 440, scale: 4 });
      if (!reduced && stage === "hatching") raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [canvas, stage]);
  return setCanvas;
}

type Winnings = Readonly<{ net: bigint; launches: number }>;

function Nursery({ prompt, toast, coach, brood = babies.slice(0, 3), inert, slingshot, onOpenSlingshot }: {
  prompt?: boolean | Readonly<{ label: string; short?: string; keyHint?: string }>; toast?: boolean | string; coach?: boolean; brood?: Creature[]; inert?: boolean; slingshot?: Winnings; onOpenSlingshot?: () => void;
}) {
  const [muted, setMuted] = useState(false);
  const [message, setMessage] = useState<string | null>(typeof toast === "string" ? toast : toast ? "Zibu joined your brood" : null);
  const dismiss = useCallback(() => setMessage(null), []);
  return <WorldLayer inert={inert}>
    <FakeWorld brood={brood} />
    <Hud balance="18.5 RF" eggs={2} broodCount={brood.length} muted={muted} onToggleSound={() => setMuted(!muted)} onOpenSettings={() => {}} onOpenBrood={() => {}}
      collection={collectionWithout()} hearts={42} onOpenShop={() => {}} slingshot={slingshot} onOpenSlingshot={onOpenSlingshot} />
    {message && <Toast message={message} tone="success" onDismiss={dismiss} duration={0} />}
    {!inert && <ActionBar onFindMatch={() => {}} broodCount={brood.length} onOpenBrood={() => {}} hint="WASD / arrows or tap to walk · E near a station"
      prompt={prompt ? { ...(prompt === true ? { label: "Buy eggs" } : prompt), onActivate: () => {} } : null}
      coach={coach ? { title: "Start here", detail: "Find a mate for your Friend, or walk to the MATCH terminal." } : null} />}
  </WorldLayer>;
}

function Matchmaker(props: { needsEgg?: boolean; canAfford?: boolean; busy?: boolean; error?: string; withBrood?: boolean; reason?: string; guide?: boolean;
  stock?: boolean; preferred?: string; parentA?: string }) {
  const [pool, setPool] = useState(candidates);
  return <>
    <Nursery inert />
    <MatchmakerPanel parents={props.withBrood ? [player, ...babies.slice(0, 5)] : [player]} candidates={pool}
      onStockUp={props.stock ? quantity => console.log("stock up", String(quantity)) : undefined} stockUpPrice="5 RF"
      preferredMateKey={props.preferred} initialParentA={props.parentA}
      eggs={props.needsEgg ? 0 : 2} price="1 RF" needsEgg={!!props.needsEgg} canAfford={props.canAfford ?? true}
      busy={props.busy} busyLabel={props.busy ? "Buying egg…" : undefined} error={props.error} disabledReason={props.reason}
      onReroll={() => setPool(pool === candidates ? rerolled : candidates)} onBreed={(a, b) => console.log("breed", a.key, b.key)}
      onClose={() => console.log("close")} collectedFamilies={props.guide ? [] : collectionWithout().families} odds={tiers} guide={props.guide}
      onWish={() => console.log("wish")} wishPrice={15} />
  </>;
}

function Hatch({ stage, baby }: { stage: "hatching" | "result"; baby: Creature }) {
  const setCanvas = useFakeHatch(stage);
  const info = tierInfo(baby.tier ?? "common");
  return <>
    <Nursery inert />
    <HatchOverlay stage={stage} canvasRef={setCanvas} onSkip={() => console.log("skip")} onClose={() => console.log("close")}>
      <BabyCard baby={baby} parentA={creature(baby.parents![0])} parentB={creature(baby.parents![1])} creature={creature} chance={info.chance} value={info.value}
        onKeep={() => console.log("keep")} onRelease={() => console.log("release")} heartsPerMinute={heartsPerMinute(baby.tier)} keepBonus={5}
        hint={params.has("first") ? `Keep ${baby.name} to breed again (it follows your Friend), or trade it in at the Sanctuary for a fixed ${info.value} (simulated).` : undefined}
        discoveries={discoveriesOf(baby, params.has("first") ? buildCollection([]) : collectionWithout(baby))} />
    </HatchOverlay>
  </>;
}

function Brood({ list, detail, friend, tab }: { list: Creature[]; detail?: string; friend?: boolean; tab?: BroodTab }) {
  const [items, setItems] = useState(list);
  return <>
    <Nursery brood={items.slice(0, 3)} inert />
    <BroodPanel babies={items} tiers={tiers} creature={creature} initialSelectedKey={detail} onRelease={baby => setItems(items.filter(item => item !== baby))}
      friend={friend ? { ...player, accessory: "party-hat" } : undefined} initialTab={tab}
      onUseAsParent={baby => console.log("parent", baby.key)} onFindMatch={() => console.log("find")} onClose={() => console.log("close")}
      heartsRate={baby => heartsPerMinute(baby.tier)} onOpenShop={() => console.log("shop")}
      collection={list.length ? collectionWithout() : buildCollection([])} />
  </>;
}

function Eggs({ eggs = 0, broke }: { eggs?: number; broke?: boolean }) {
  const [busy, setBusy] = useState(false);
  return <>
    <Nursery inert />
    <EggShopPanel eggs={eggs} balance={broke ? "0.5 RF" : "18.5 RF"} busy={busy} note="Average Sanctuary value: 0.8875 RF per egg (88.75% of the 1 RF price)."
      reason={broke ? "Not enough simulated RF for an egg right now." : undefined}
      packs={[1n, 3n, 5n].map(quantity => ({ quantity, price: `${quantity} RF`, disabled: broke }))}
      onBuy={quantity => { console.log("buy", String(quantity)); setBusy(true); setTimeout(() => setBusy(false), 1500); }}
      onClose={busy ? undefined : () => console.log("close")} />
  </>;
}

/** HUD values at the start of a session (the intro) and mid-game (the "?" panel). */
const START_HUD: HudSample = { hearts: 0, balance: "20 RF", eggs: 0, brood: 0, families: 0, net: 0n };
const PLAYING_HUD: HudSample = { hearts: 42, balance: "18.5 RF", eggs: 2, brood: 3, families: 4, net: 54n * RF_UNIT };

function Intro({ step }: { step: number }) {
  const mate = wild.find(item => item.familyId !== player.familyId) ?? wild[0];
  return <>
    <Nursery inert />
    <IntroPanel player={player} mate={mate} tiers={tiers} price="1 RF" startBalance="20 RF" initialStep={step} hud={START_HUD}
      keepHeartsPerMinute={heartsPerMinute("common")} onClose={() => console.log("close")} onStepChange={next => console.log("step", next)} />
  </>;
}

function Shop({ tab }: { tab: "hats" | "wish" }) {
  const [hearts, setHearts] = useState(64);
  const [owned, setOwned] = useState<ReadonlySet<AccessoryId>>(new Set(["bow"]));
  const [equipped, setEquipped] = useState<ReadonlyMap<string, AccessoryId>>(new Map([[babies[0].key, "bow"]]));
  const brood = babies.slice(0, 4);
  const dress = (item: Creature) => ({ ...item, accessory: equipped.get(item.key) });
  return <>
    <Nursery inert />
    <HeartShopPanel hearts={hearts} perMinute={brood.reduce((sum, baby) => sum + heartsPerMinute(baby.tier), 0)} wearers={[player, ...brood].map(dress)}
      catalog={ACCESSORIES} owned={owned} equipped={equipped} initialTab={tab} families={wishFamilies} wishPrice={15}
      collectedFamilies={collectionWithout().families} onClose={() => console.log("close")} onWish={id => console.log("wish", id)}
      onBuy={id => { const price = ACCESSORIES.find(item => item.id === id)!.price; if (hearts >= price) { setHearts(hearts - price); setOwned(new Set([...owned, id])); } }}
      onEquip={(key, id) => setEquipped(current => { const next = new Map([...current].filter(([, value]) => value !== id)); if (id) next.set(key, id); else next.delete(key); return next; })} />
  </>;
}

function Settings({ scrollTo }: { scrollTo?: string }) {
  const [muted, setMuted] = useState(false), [motion, setMotion] = useState(false);
  useEffect(() => { if (scrollTo) document.querySelector(scrollTo)?.scrollIntoView({ block: "start" }); }, [scrollTo]);
  return <>
    <Nursery inert />
    <SettingsPanel muted={muted} onToggleSound={() => setMuted(!muted)} reducedMotion={motion} onToggleReducedMotion={() => setMotion(!motion)}
      odds={tiers} price="1 RF" onClose={() => console.log("close")} note="Average Sanctuary value per egg: 0.8 RF." moonFund="594.5 RF"
      player={player} hud={PLAYING_HUD} />
  </>;
}

// ---------- Moon Slingshot ----------

const ZONE_SPOT: Record<LaunchZoneId, readonly [number, number]> = {
  pond: [250, 540], haystack: [390, 500], rooftop: [540, 372], cloud: [680, 214], orbit: [800, 150], moon: [868, 104],
};

/** Simulates the renderer's flight on the overlay canvas: landmarks, then the baby arcs to its zone. `onLanded` fires at the end. */
function useFakeLaunch(stage: "flying" | "result", baby: Creature | null, zone: LaunchZoneId | null, onLanded?: () => void) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  useEffect(() => {
    if (!canvas || !baby || !zone) return;
    const { ctx } = setupPixelCanvas(canvas, 960, 640);
    const start = performance.now(), duration = reduced || stage === "result" || !onLanded ? 0 : 1400;
    let raf = 0;
    const draw = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : stage === "result" ? 1 : .55;
      ctx.fillStyle = "#F4F1EA"; ctx.fillRect(0, 0, 960, 640);
      ctx.fillStyle = "#111"; ctx.fillRect(0, 560, 960, 80);
      ctx.fillStyle = "#9FE8FF"; ctx.fillRect(190, 548, 130, 14);
      ctx.fillStyle = "#E8C95A"; ctx.beginPath(); ctx.moveTo(340, 548); ctx.lineTo(390, 490); ctx.lineTo(440, 548); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#111"; ctx.lineWidth = 4; ctx.strokeRect(480, 400, 120, 148); ctx.fillRect(480, 400, 120, 148);
      ctx.beginPath(); ctx.moveTo(470, 400); ctx.lineTo(540, 360); ctx.lineTo(610, 400); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(680, 232, 70, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(800, 150, 60, 16, -.3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#FFE27A"; ctx.beginPath(); ctx.arc(880, 80, 44, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const [tx, ty] = ZONE_SPOT[zone], sx = 90, sy = 540;
      const x = sx + (tx - sx) * t, y = sy + (ty - sy) * t - Math.sin(t * Math.PI) * 180;
      drawCreature(ctx, baby, { clip: "idle", facing: "right", frame: Math.floor(now / 110) % 8, x, y, scale: 3, time: now });
      if (t < 1 && duration) raf = requestAnimationFrame(draw);
      else if (duration) landed.current?.();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [canvas, baby, zone, stage]);
  return setCanvas;
}

const withFund = (fund: bigint): SlingshotLedger => ({ ...initialLedger(), fund });
const resultFor = (baby: Creature, zone: LaunchZoneId, roll = 4242): LaunchResult => {
  const value = tierValue(baby.tier);
  return { babyKey: baby.key, zone, value, payout: launchPayout(value, zone), roll };
};
/** &roll=0-9999 makes the harness flow land deterministically (pond 0-3999 ... moon 9800-9999). */
const fixedRoll = params.has("roll") ? Number(params.get("roll")) : null;

/**
 * The whole station flow, wired the way index.tsx should: panel -> onLaunch -> the runtime's trade-in confirmation
 * (faked here: busy for 900 ms; &hold keeps it open) -> book the result (resolveLaunch, like useSlingshot().launch) and
 * remove the baby -> overlay flies -> result card -> Launch another / Back to the nursery.
 */
function SlingshotFlow({ list, fund, initialKey, busy: startBusy }: { list: Creature[]; fund?: bigint; initialKey?: string; busy?: boolean }) {
  const [ledger, setLedger] = useState(() => withFund(fund ?? initialLedger().fund));
  const [brood, setBrood] = useState(list);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(!!startBusy);
  const [flight, setFlight] = useState<{ baby: Creature; result: LaunchResult; stage: "flying" | "result" } | null>(null);
  const land = useCallback(() => setFlight(current => current && { ...current, stage: "result" }), []);
  const setCanvas = useFakeLaunch(flight?.stage ?? "flying", flight?.baby ?? null, flight?.result.zone ?? null, land);
  const launch = (key: string, pull: number) => {
    console.log("launch", key, pull.toFixed(2));
    const baby = brood.find(item => item.key === key);
    if (!baby || launchBlocker(ledger, tierValue(baby.tier))) return;
    setBusy(true);
    if (params.has("hold")) return;
    setTimeout(() => {
      const next = resolveLaunch(ledger, key, tierValue(baby.tier), fixedRoll ?? Math.floor(Math.random() * 10_000));
      setLedger(next.ledger);
      setBrood(brood.filter(item => item !== baby));
      setBusy(false);
      setOpen(false);
      setFlight({ baby, result: next.result, stage: "flying" });
    }, 900);
  };
  return <>
    <Nursery brood={brood.slice(0, 3)} inert={open || !!flight} slingshot={{ net: slingshotNet(ledger), launches: ledger.launches }}
      onOpenSlingshot={() => setOpen(true)} />
    {open && <SlingshotPanel brood={brood} tiers={tierRows} initialKey={initialKey} blocker={value => launchBlocker(ledger, value)} fund={ledger.fund} busy={busy}
      onLaunch={launch} onFindMatch={() => console.log("find")} onClose={() => { console.log("close"); setOpen(false); }} />}
    {flight && <LaunchOverlay stage={flight.stage} canvasRef={setCanvas} onSkip={() => { console.log("skip"); land(); }} result={flight.result} baby={flight.baby}
      canLaunchAgain={brood.length > 0} onLaunchAgain={() => { console.log("again"); setFlight(null); setOpen(true); }}
      onClose={() => { console.log("close"); setFlight(null); }} />}
  </>;
}

/** A fixed launch result (or the flight with a frozen frame) for screenshots. */
function Landing({ baby, zone, stage = "result", again = true }: { baby: Creature; zone: LaunchZoneId; stage?: "flying" | "result"; again?: boolean }) {
  const setCanvas = useFakeLaunch(stage, baby, zone);
  return <>
    <Nursery inert brood={babies.filter(item => item !== baby).slice(0, 3)} />
    <LaunchOverlay stage={stage} canvasRef={setCanvas} onSkip={() => console.log("skip")} result={stage === "result" ? resultFor(baby, zone) : null} baby={baby}
      canLaunchAgain={again} onLaunchAgain={() => console.log("again")} onClose={() => console.log("close")} />
  </>;
}

const ICONS: PixelIconName[] = ["heart", "heartOutline", "egg", "eggCracked", "eggBig", "eggCrackedBig", "baby", "soundOn", "soundOff", "help", "close", "dice", "sparkle", "sprout", "back", "check", "dna", "moon", "slingshot", "slingshotBig"];

function Thumbs() {
  return <div className="dev-thumbs">
    <div className="dev-icons">{ICONS.map(name => <span key={name} title={name}><PixelIcon name={name} pixel={3} /><small>{name}</small></span>)}</div>
    {[player, ...wild.slice(0, 3), ...babies].map((item, index) => <figure key={item.key}>
      <span className="rb-slot"><SpriteThumb creature={item} scale={index < 4 ? 4 : 3} compactScale={2} clip={index % 2 ? "walk" : "idle"} facing={index % 3 === 1 ? "left" : "down"} /></span>
      <figcaption>{item.name}<br />{item.tier ?? item.kind}</figcaption>
    </figure>)}
  </div>;
}

const scenarios: Record<string, () => ReactNode> = {
  thumbs: () => <Thumbs />,
  nursery: () => <Nursery />,
  "nursery-prompt": () => <Nursery prompt toast />,
  "nursery-prompt-long": () => <Nursery prompt={{ label: "Open Matchmaker", short: "Matchmaker" }} />,
  matchmaker: () => <Matchmaker />,
  "matchmaker-buy": () => <Matchmaker needsEgg />,
  "matchmaker-broke": () => <Matchmaker needsEgg canAfford={false} error="Cancelled. Nothing was spent." />,
  "matchmaker-busy": () => <Matchmaker needsEgg busy />,
  "matchmaker-brood": () => <Matchmaker withBrood />,
  "matchmaker-first": () => <Matchmaker needsEgg guide />,
  shop: () => <Shop tab="hats" />,
  "shop-wish": () => <Shop tab="wish" />,
  "intro-1": () => <Intro step={0} />,
  "intro-2": () => <Intro step={1} />,
  "intro-3": () => <Intro step={2} />,
  "intro-4": () => <Intro step={3} />,
  "intro-5": () => <Intro step={4} />,
  "intro-6": () => <Intro step={5} />,
  "nursery-coach": () => <Nursery coach />,
  eggs: () => <Eggs />,
  "eggs-stocked": () => <Eggs eggs={3} />,
  "eggs-broke": () => <Eggs broke />,
  hatching: () => <Hatch stage="hatching" baby={babies[0]} />,
  "reveal-common": () => <Hatch stage="result" baby={babies[1]} />,
  "reveal-spotted": () => <Hatch stage="result" baby={babies[2]} />,
  "reveal-mutant": () => <Hatch stage="result" baby={babies[0]} />,
  "reveal-prismatic": () => <Hatch stage="result" baby={babies[3]} />,
  "reveal-f3": () => <Hatch stage="result" baby={babies[5]} />,
  brood: () => <Brood list={babies} />,
  "brood-detail": () => <Brood list={babies} detail={babies[4].key} />,
  "brood-empty": () => <Brood list={[]} />,
  "brood-tabs": () => <Brood list={babies} friend />,
  "brood-legacy": () => <Brood list={babies} friend tab="legacy" />,
  "brood-legacy-ghost": () => <Brood list={babies.slice(1)} friend tab="legacy" />,
  "brood-legacy-empty": () => <Brood list={[]} friend tab="legacy" />,
  "brood-legacy-detail": () => <Brood list={babies} friend tab="legacy" detail={babies[5].key} />,
  "friend-panel": () => <><Nursery inert /><FriendPanel friend={player} babies={babies} creature={creature} onFindMatch={() => console.log("find")}
    onSelectBaby={baby => console.log("select", baby.key)} onClose={() => console.log("close")} /></>,
  "matchmaker-stock": () => <Matchmaker needsEgg withBrood stock />,
  "matchmaker-preferred": () => <Matchmaker withBrood preferred={candidates[2].key} parentA={babies[3].key} />,
  settings: () => <Settings />,
  "settings-stations": () => <Settings scrollTo=".rb-legend-stations" />,
  "settings-screen": () => <Settings scrollTo=".rb-legend-hud" />,
  slingshot: () => <SlingshotFlow list={[babies[1], babies[0], babies[3]]} />,
  "slingshot-many": () => <SlingshotFlow list={babies} initialKey={babies[2].key} />,
  // Seven babies: the newest (preselected) starts in the picker's hidden third row on wide frames.
  "slingshot-crowd": () => <SlingshotFlow list={[...babies, { ...babies[3], key: "baby:99", name: "Nova", playId: 99n }]} />,
  "slingshot-empty": () => <SlingshotFlow list={[]} />,
  "slingshot-busy": () => <SlingshotFlow list={[babies[1], babies[0], babies[3]]} busy />,
  "slingshot-blocked": () => <SlingshotFlow list={[babies[1], babies[0], babies[3]]} fund={40n * RF_UNIT} />,
  "slingshot-flying": () => <Landing baby={babies[3]} zone="cloud" stage="flying" />,
  "slingshot-pond": () => <Landing baby={babies[2]} zone="pond" />,
  "slingshot-rooftop": () => <Landing baby={babies[0]} zone="rooftop" />,
  "slingshot-moon": () => <Landing baby={babies[3]} zone="moon" again={false} />,
  "slingshot-hud": () => <Nursery slingshot={{ net: 54n * RF_UNIT, launches: 3 }} onOpenSlingshot={() => console.log("sling")} toast="Oro: The Moon. Slingshot net +54 RF (simulated)" />,
  "slingshot-hud-down": () => <Nursery slingshot={{ net: -15n * RF_UNIT / 10n, launches: 2 }} />,
  "slingshot-hint": () => <Nursery brood={babies.slice(0, 1)} prompt={{ label: "Moon Slingshot: x0 to x10", short: "Slingshot x0-x10", keyHint: "!" }} />,
  "slingshot-settings": () => <Settings scrollTo=".rb-sling-odds" />,
  "slingshot-intro": () => <Intro step={4} />,
  loading: () => <LoadingScreen />,
  error: () => <ErrorScreen message="Could not read Friend #77949's art from the chain. Check your connection and try again." onRetry={() => console.log("retry")} />,
};

/** Child document. With &defer the scenario mounts after 700 ms, so tests can focus the iframe first (like a real click). */
function Child({ render }: { render: () => ReactNode }) {
  const [ready, setReady] = useState(!params.has("defer"));
  useEffect(() => { if (!ready) { const timer = setTimeout(() => setReady(true), 700); return () => clearTimeout(timer); } }, [ready]);
  return <GameRoot reducedMotion={reduced}>{ready ? render() : <Nursery />}</GameRoot>;
}

function App() {
  const name = params.get("s");
  if (!name || !scenarios[name]) return <main className="dev-index">
    <h1>Rare Breeds UI harness</h1>
    <p>Add <code>&amp;rm</code> for reduced motion, <code>&amp;full</code> for a completed collection, <code>&amp;first</code> for a first-ever hatch. Resize the window to 392 x 262 (or 362 x 242) for the phone frame.</p>
    <ul>{Object.keys(scenarios).map(key => <li key={key}><a href={`?s=${key}`}>{key}</a></li>)}</ul>
  </main>;
  // Child document: what the sandboxed game iframe renders (no SDK frame CSS applies here).
  if (params.has("child")) return <Child render={scenarios[name]} />;
  // Parent document: the real SDK frame chrome with its toolbar overlaying the game iframe.
  return <GameFrame friends={[{ id: 77949n, label: "Friend #77949", kind: "owned" }]} selectedFriendId={77949n} mode="preview">
    <iframe src={`?${new URLSearchParams([...params, ["child", "1"]])}`} title="Rare Breeds" />
  </GameFrame>;
}

if (params.has("child")) document.documentElement.classList.add("dev-child");

createRoot(document.getElementById("root")!).render(<App />);
