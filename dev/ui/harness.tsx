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
  ActionBar, BabyCard, BroodPanel, EggShopPanel, ErrorScreen, FriendPanel, GameRoot, HatchOverlay, HeartShopPanel, Hud, IntroPanel, LoadingScreen, MatchmakerPanel,
  PixelIcon, SettingsPanel, SpriteThumb, Toast, WorldLayer, buildCollection, discoveriesOf, type BroodTab, type Collection, type PixelIconName,
} from "../../games/rare-breeds/src/ui/index.ts";
import { babies, candidates, creature, player, rerolled, tierInfo, tiers, wild } from "./fixtures.ts";
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

function Nursery({ prompt, toast, coach, brood = babies.slice(0, 3), inert }: { prompt?: boolean; toast?: boolean; coach?: boolean; brood?: Creature[]; inert?: boolean }) {
  const [muted, setMuted] = useState(false);
  const [message, setMessage] = useState<string | null>(toast ? "Zibu joined your brood" : null);
  const dismiss = useCallback(() => setMessage(null), []);
  return <WorldLayer inert={inert}>
    <FakeWorld brood={brood} />
    <Hud balance="18.5 RF" eggs={2} broodCount={brood.length} muted={muted} onToggleSound={() => setMuted(!muted)} onOpenSettings={() => {}} onOpenBrood={() => {}}
      collection={collectionWithout()} hearts={42} onOpenShop={() => {}} />
    {message && <Toast message={message} tone="success" onDismiss={dismiss} duration={0} />}
    {!inert && <ActionBar onFindMatch={() => {}} broodCount={brood.length} onOpenBrood={() => {}} hint="WASD / arrows or tap to walk · E near a station"
      prompt={prompt ? { label: "Buy eggs", onActivate: () => {} } : null}
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
      <BabyCard baby={baby} parentA={creature(baby.parents![0])} parentB={creature(baby.parents![1])} chance={info.chance} value={info.value}
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

function Intro({ step }: { step: number }) {
  const mate = wild.find(item => item.familyId !== player.familyId) ?? wild[0];
  return <>
    <Nursery inert />
    <IntroPanel player={player} mate={mate} tiers={tiers} price="1 RF" startBalance="20 RF" initialStep={step}
      collection={buildCollection([])} onClose={() => console.log("close")} onStepChange={next => console.log("step", next)} />
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

function Settings() {
  const [muted, setMuted] = useState(false), [motion, setMotion] = useState(false);
  return <>
    <Nursery inert />
    <SettingsPanel muted={muted} onToggleSound={() => setMuted(!muted)} reducedMotion={motion} onToggleReducedMotion={() => setMotion(!motion)}
      odds={tiers} price="1 RF" onClose={() => console.log("close")} note="Average Sanctuary value per egg: 0.8 RF." />
  </>;
}

const ICONS: PixelIconName[] = ["heart", "heartOutline", "egg", "eggCracked", "eggBig", "eggCrackedBig", "baby", "soundOn", "soundOff", "help", "close", "dice", "sparkle", "sprout", "back", "check", "dna"];

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
  "nursery-coach": () => <Nursery coach />,
  eggs: () => <Eggs />,
  "eggs-stocked": () => <Eggs eggs={3} />,
  "eggs-broke": () => <Eggs broke />,
  hatching: () => <Hatch stage="hatching" baby={babies[0]} />,
  "reveal-common": () => <Hatch stage="result" baby={babies[1]} />,
  "reveal-spotted": () => <Hatch stage="result" baby={babies[2]} />,
  "reveal-mutant": () => <Hatch stage="result" baby={babies[0]} />,
  "reveal-prismatic": () => <Hatch stage="result" baby={babies[3]} />,
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
