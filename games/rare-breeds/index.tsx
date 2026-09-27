"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendSoundKit, type FriendSoundCue, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import { useRareBreeds } from "./src/controller.ts";
import { ACCESSORIES } from "./src/accessories.ts";
import { KEEP_BONUS, WISH_PRICE, heartsPerMinute, useHearts, wishFamilies } from "./src/hearts.ts";
import { describeTiers, expectedValueLabel, formatRF, purchaseBlocker } from "./src/economy.ts";
import { createNurseryScene } from "./src/scene/nursery.ts";
import { createHatchSequence, createQuickHatchSequence } from "./src/scene/hatch.ts";
import { createLaunchSequence } from "./src/scene/launch.ts";
import { multiplierLabel, slingshotNet, useSlingshot, type LaunchResult } from "./src/slingshot.ts";
import { PASS_ON_ODDS, passableShapes } from "./src/genetics.ts";
import { lineageTitles } from "./src/titles.ts";
import type { HatchSequence, LaunchBeat, LaunchSequence, NurseryScene } from "./src/api.ts";
import { TIER_ORDER, type Creature, type StationId, type TierId } from "./src/types.ts";
import {
  ActionBar, BabyCard, BroodPanel, EggShopPanel, ErrorScreen, GameRoot, HatchOverlay, HeartShopPanel, Hud, IntroPanel, LaunchOverlay, LoadingScreen,
  MatchmakerPanel, SettingsPanel, SlingshotPanel, Toast, WorldLayer, buildCollection, discoveriesOf, familyOf, signedRF, type BroodTab, type ShopTab, type TierInfo,
} from "./src/ui/index.ts";
import "./style.css";

type PanelId = "match" | "brood" | "settings" | "eggs" | "shop" | "sling";
type Note = Readonly<{ message: string; tone: "info" | "success" | "error"; id: number; duration?: number }>;
/** A launched baby (traded in, out of the brood): the scene shot, then the flight overlay; `result` once the flight is booked. */
type Flight = Readonly<{ baby: Creature; value: bigint; result: LaunchResult | null; stage: "shot" | "flight" | "result" }>;

const STATION_LABEL: Record<StationId, string> = { matchmaker: "Open Matchmaker", incubator: "Buy eggs", sanctuary: "Visit Sanctuary", slingshot: "Load the slingshot" };
const STATION_SHORT: Record<StationId, string> = { matchmaker: "Matchmaker", incubator: "Buy eggs", sanctuary: "Sanctuary", slingshot: "Slingshot" };
const COACH = { title: "Start here", detail: "Find a mate for your Friend, or walk to the MATCH terminal." } as const;
const BUSY_LABEL = { buying: "Buying egg…", laying: "Laying egg…", hatching: "Hatching…", releasing: "Trading in…" } as const;
const REVEAL_CUE: Record<TierId, FriendSoundCue> = {
  common: "reveal-common", spotted: "reveal-common", mutant: "reveal-rare", prismatic: "reveal-legendary",
};
const FLIGHT_CUE: Record<LaunchBeat, readonly FriendSoundCue[]> = {
  ignite: ["action-start"], pass: ["action-ready"], sputter: ["anticipation"], jump: ["select"], splash: ["impact", "reveal-common"],
  touchdown: ["reveal-rare"], moon: ["reveal-legendary"],
};
/** The nursery shot's band pull (cosmetic): the baby is tossed out of the window onto its rocket. */
const SHOT_PULL = 0.8;
/** Once the player has a kept baby and has never opened the slingshot: a tappable pointer to it in the prompt slot. */
const SLING_HINT = "Moon Slingshot: x0 to x10", SLING_HINT_SHORT = "Slingshot x0-x10";
const EGG_PACKS = [1n, 3n, 5n] as const;
/** Matchmaker "Stock up" pack: one runtime confirmation for several eggs. */
const STOCK_UP = 5n;

/** Rare Breeds: the SDK runtime supplies the verified Friend, the simulated ledger and every confirmation. */
export default function RareBreeds({ friendId, client, paused }: GameComponentProps) {
  const game = useRareBreeds({ friendId, client, paused });
  const { player, snapshot, hatch, brood, definition } = game;
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [parentAKey, setParentAKey] = useState<string | undefined>();
  const [broodFocus, setBroodFocus] = useState<string | null>(null);
  // Brood panel tab: "legacy" shows the Friend's card and family tree (e.g. after tapping the Friend).
  const [broodTab, setBroodTab] = useState<BroodTab>("brood");
  // Hatches presented this session: after the first two, common and spotted babies get the quick cut.
  const hatchesShown = useRef(new Set<string>());
  const [near, setNear] = useState<StationId | null>(null);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [note, setNote] = useState<Note | null>(null);
  const [hatchCanvas, setHatchCanvas] = useState<HTMLCanvasElement | null>(null);
  const [worldCanvas, setWorldCanvas] = useState<HTMLCanvasElement | null>(null);
  const [launchCanvas, setLaunchCanvas] = useState<HTMLCanvasElement | null>(null);
  const scene = useRef<NurseryScene | null>(null), sequence = useRef<HatchSequence | null>(null);
  const [launchSeq, setLaunchSeq] = useState<LaunchSequence | null>(null);
  const sound = useRef<FriendSoundKit | null>(null);
  // First-run help (session only: the sandbox has no storage). The intro opens on every game start.
  const [intro, setIntro] = useState(true);
  const [firstTime, setFirstTime] = useState({ match: true, breed: true, card: true, sling: true, passOn: true });
  const [sanctuary, setSanctuary] = useState(false);
  const startBalance = useRef<bigint | null>(null);
  if (snapshot && startBalance.current === null) startBalance.current = snapshot.rfBalance;
  // The intro's example mate: a real wild Friend on offer, from another family when possible. Fixed per Friend.
  const introMate = useMemo(() => game.candidates.find(mate => mate.familyId !== player?.familyId) ?? game.candidates[0], [player]);
  const showIntro = intro && !!introMate;
  // Moon Slingshot: the simulated side ledger and the launch on screen.
  const sling = useSlingshot();
  const [flight, setFlight] = useState<Flight | null>(null);
  // Hearts: game points kept babies earn (never RF). Income pauses with the runtime, the intro, a hatch and a flight.
  const hearts = useHearts({ brood, active: !paused && !showIntro && !hatch && !flight, onEarn: (key, amount) => scene.current?.emitHearts(key, amount) });
  const [shopTab, setShopTab] = useState<ShopTab>("hats");
  // Everyone shown anywhere wears their equipped accessory.
  const dressedPlayer = useMemo(() => player && hearts.dress(player), [player, hearts.dress]);
  const dressedBrood = useMemo(() => brood.map(baby => hearts.dress(baby)), [brood, hearts.dress]);
  const dressedCreature = useCallback((key: string) => {
    const found = game.creature(key);
    return found && hearts.dress(found);
  }, [hearts.dress]);

  const tierRows = useMemo(() => describeTiers(definition), [definition]);
  const tiers: readonly TierInfo[] = useMemo(() => tierRows.map(row => ({ tier: row.tier, chance: row.chancePercent, value: row.rewardLabel })), [tierRows]);
  const tierInfo = (tier: TierId | undefined) => tiers.find(row => row.tier === (tier ?? "common")) ?? tiers[0];
  // Collection goal: families and tiers of every baby hatched this session, kept or sent to the Sanctuary.
  // The baby on the reveal card joins once the card closes, so the card can show what it adds.
  const collection = useMemo(() => {
    const revealing = hatch?.baby.key;
    const settled = (snapshot?.plays ?? []).filter(play => play.outcomeId !== null && `baby:${play.id}` !== revealing);
    return buildCollection([...brood, ...settled.map(play => game.creature(`baby:${play.id}`))].filter(baby => baby?.key !== revealing),
      settled.map(play => TIER_ORDER[(play.outcomeId ?? 1) - 1]), baby => lineageTitles(baby, game.creature, player));
  }, [snapshot, brood, hatch?.baby.key, player]);
  // "Hatch #7": the baby's place among this session's settled hatches (the ledger's plays, oldest first).
  const hatchNumber = useCallback((baby: Creature) => baby.playId === undefined ? undefined
    : 1 + (snapshot?.plays ?? []).filter(play => play.outcomeId !== null && play.id < baby.playId!).length, [snapshot]);
  const notify = useCallback((message: string, tone: Note["tone"] = "info", duration?: number) => setNote({ message, tone, id: Date.now(), duration }), []);
  const titlesOf = useCallback((baby: Creature) => lineageTitles(baby, game.creature, player), [player]);
  const cue = useCallback((id: FriendSoundCue) => { sound.current?.play(id); }, []);

  // Sound: created muted-safe, unlocked only from a real player gesture, as the SDK sound kit requires.
  useEffect(() => {
    const kit = createFriendSoundKit({ volume: 0.6 });
    sound.current = kit;
    const unlock = () => { void kit.unlock(); };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      kit.dispose(); sound.current = null;
    };
  }, []);
  useEffect(() => { sound.current?.setMuted(muted); }, [muted]);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const openPanel = useCallback((next: PanelId | null) => {
    if (paused) return;
    game.clearError();
    setPanel(next);
    setSanctuary(false);
    if (next) cue("select");
  }, [paused, cue]);
  const openMatch = useCallback((parentA?: string) => {
    setParentAKey(parentA); openPanel("match");
    setFirstTime(seen => seen.match ? { ...seen, match: false } : seen);
  }, [openPanel]);
  const openSling = useCallback(() => {
    openPanel("sling");
    setFirstTime(seen => seen.sling ? { ...seen, sling: false } : seen);
  }, [openPanel]);

  // The nursery world. Callbacks go through a ref so the scene is created once per Friend.
  const handlers = useRef({ station: (_: StationId) => {}, creature: (_: string) => {} });
  handlers.current = {
    station: station => {
      if (station === "matchmaker") openMatch();
      else if (station === "slingshot") openSling();
      else { openPanel(station === "incubator" ? "eggs" : "brood"); setSanctuary(station === "sanctuary"); }
    },
    creature: key => {
      const friend = key === player?.key;
      setBroodTab(friend ? "legacy" : "brood"); setBroodFocus(friend ? null : key); openPanel("brood");
    },
  };
  useEffect(() => {
    if (!worldCanvas || !player) return;
    const created = createNurseryScene({
      canvas: worldCanvas, player, reducedMotion,
      onStationNear: setNear,
      onStationActivate: station => handlers.current.station(station),
      onCreatureActivate: key => handlers.current.creature(key),
    });
    scene.current = created;
    return () => { created.destroy(); if (scene.current === created) scene.current = null; };
  }, [worldCanvas, player]);
  useEffect(() => { scene.current?.setBrood(dressedBrood); }, [dressedBrood, worldCanvas, player]);
  useEffect(() => { if (dressedPlayer) scene.current?.setPlayer(dressedPlayer); }, [dressedPlayer, worldCanvas]);
  useEffect(() => { scene.current?.setEggCount(Number(snapshot?.consumables ?? 0n)); }, [snapshot, worldCanvas, player]);
  useEffect(() => { scene.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);
  // The scene shot plays in the live world; the flight overlay pauses it.
  const worldPaused = paused || panel !== null || hatch !== null || showIntro || (flight !== null && flight.stage !== "shot");
  useEffect(() => { scene.current?.setPaused(worldPaused); }, [worldPaused, worldCanvas, player]);

  // The hatch overlay: the outcome is already settled; this only presents it.
  useEffect(() => {
    if (!hatch || hatch.stage !== "hatching" || !hatchCanvas) return;
    let revealed = false;
    const tier = hatch.baby.tier ?? "common";
    // First two hatches and every Mutant or Prismatic get the full show; later ones the 1.8 s cut.
    const quick = hatchesShown.current.add(hatch.baby.key).size > 2 && tier !== "mutant" && tier !== "prismatic";
    const created = (quick ? createQuickHatchSequence : createHatchSequence)({
      canvas: hatchCanvas, parentA: hatch.parentA, parentB: hatch.parentB, baby: hatch.baby, reducedMotion,
      onBeat: beat => {
        if (beat === "wobble") cue("anticipation");
        else if (beat === "crack") cue("impact");
        else if (beat === "merge") cue("action-start");
        else if (!revealed) { revealed = true; cue(REVEAL_CUE[hatch.baby.tier ?? "common"]); }
      },
    });
    sequence.current = created;
    void created.play().then(() => { if (sequence.current === created) game.finishHatch(); });
    return () => { created.destroy(); if (sequence.current === created) sequence.current = null; };
  }, [hatch?.baby.key, hatch?.stage === "hatching", hatchCanvas]);

  // The flight scene: LaunchOverlay drives it (the crash point is drawn at ignition). It stays alive behind the result card.
  useEffect(() => {
    if (!flight || flight.stage === "shot" || !launchCanvas) return;
    const created = createLaunchSequence({ canvas: launchCanvas, baby: flight.baby, reducedMotion, onBeat: beat => { for (const id of FLIGHT_CUE[beat]) cue(id); } });
    setLaunchSeq(created);
    return () => { created.destroy(); setLaunchSeq(current => current === created ? null : current); };
  }, [flight?.baby.key, flight?.stage === "shot", launchCanvas]);
  useEffect(() => { if (flight?.stage === "result" && flight.result && flight.result.payout > 0n) cue("reward"); }, [flight?.result, flight?.stage]);

  useEffect(() => { if (game.error) notify(game.error, "error"); }, [game.error]);

  async function breed(a: Creature, b: Creature) {
    setPanel(null);
    const result = await game.breedPair(a, b, async () => {
      cue("action-start");
      if (b.kind === "wild") await scene.current?.playCourtship(b);
    });
    if (!result) setPanel("match");
    else setFirstTime(seen => ({ ...seen, breed: false }));
  }

  function keep(baby: Creature) {
    game.closeHatch();
    setFirstTime(seen => ({ ...seen, card: false }));
    cue("reward");
    scene.current?.celebrate(baby.key);
    hearts.grant(KEEP_BONUS);
    // Once: the first kept baby with a shape it can pass on says why to breed it (with your Friend as the example mate).
    const labels = [...new Set(player ? passableShapes(baby, player).filter(item => item.side === 0).map(item => item.label) : [])];
    if (firstTime.passOn && labels.length) {
      setFirstTime(seen => ({ ...seen, passOn: false }));
      notify(`${baby.name} joined your brood (+${KEEP_BONUS} Hearts) and can pass on its ${labels.join(" and ")} (${PASS_ON_ODDS}${labels.length > 1 ? " each" : ""}): pick it as a parent.`, "success", 9000);
    } else notify(`${baby.name} joined your brood. +${KEEP_BONUS} Hearts`, "success");
  }

  async function release(baby: Creature, fromReveal: boolean) {
    const value = tierInfo(baby.tier).value;
    if (!(await game.release(baby))) return;
    // Its hat goes back to the wardrobe.
    if (hearts.equipped.has(baby.key)) hearts.equip(baby.key, null);
    if (fromReveal) { game.closeHatch(); setFirstTime(seen => ({ ...seen, card: false })); }
    setPanel(null);
    cue("reward");
    notify(`${baby.name} was traded in at the Sanctuary. +${value} (simulated)`, "success");
    void scene.current?.playRelease(baby.key);
  }

  /**
   * Moon Slingshot: trade the baby in first (runtime "Redeem reward" confirmation; its value is the stake). Cancelling
   * changes nothing. Then the scene shot, then the flight overlay, which draws the crash point only at ignition.
   */
  async function launch(key: string) {
    const baby = dressedBrood.find(item => item.key === key);
    const value = tierRows.find(row => row.tier === (baby?.tier ?? "common"))?.reward ?? 0n;
    if (!baby || sling.blocker(value)) return;
    if (!(await game.release(baby))) return;
    setNote(null);
    // Its hat goes back to the wardrobe.
    if (hearts.equipped.has(baby.key)) hearts.equip(baby.key, null);
    setPanel(null);
    setFlight({ baby, value, result: null, stage: "shot" });
    try { await scene.current?.playLaunch(baby.key, SHOT_PULL); }
    finally { setFlight(current => current?.baby.key === baby.key && current.stage === "shot" ? { ...current, stage: "flight" } : current); }
  }

  function closeFlight(again: boolean) {
    const done = flight;
    setFlight(null);
    if (again) { openSling(); return; }
    if (done?.stage === "result" && done.result) {
      const { end, exit, payout, value } = done.result, net = payout - value;
      const how = end === "jump" ? `jumped at ${multiplierLabel(exit ?? 0, true)}` : end === "moon" ? "reached the Moon" : "landed in the pond";
      notify(`${done.baby.name} ${how}. Slingshot net ${signedRF(net)} (simulated)`, net > 0n ? "success" : "info");
    }
  }

  /** Closed before lighting the rocket: no flight, nothing booked in the side ledger; it was a plain Sanctuary trade-in. */
  function skipFlight() {
    const done = flight;
    setFlight(null);
    if (done) notify(`No flight: ${done.baby.name} stays traded in at the Sanctuary. +${formatRF(done.value)} (simulated)`, "success");
  }

  function openShop(tab: ShopTab) { setShopTab(tab); openPanel("shop"); }
  function openBrood(tab: BroodTab = "brood") { setBroodTab(tab); setBroodFocus(null); openPanel("brood"); }

  /** Matchmaker "Stock up": buys a pack of eggs and stays in the Matchmaker, ready to breed. */
  async function stockUp(quantity: bigint) {
    if (await game.buyEggs(quantity)) { cue("purchase"); notify(`${quantity} eggs in the incubator.`, "success"); }
  }

  function wish(familyId: number) {
    const family = wishFamilies.find(item => item.familyId === familyId);
    if (!family || !hearts.spend(WISH_PRICE)) return;
    game.wish(familyId);
    cue("purchase");
    notify(`Wish granted: 3 ${family.name} mates. -${WISH_PRICE} Hearts`, "success");
    openMatch();
  }

  async function buyEggs(quantity: bigint) {
    if (await game.buyEggs(quantity)) {
      cue("purchase");
      notify(`${quantity} ${quantity === 1n ? "egg" : "eggs"} in the incubator.`, "success");
      setPanel(null);
    }
  }

  if (game.loadError) return <GameRoot reducedMotion={reducedMotion}>
    <ErrorScreen title="Your Friend did not load" message={game.loadError} onRetry={game.retryLoad} />
  </GameRoot>;
  if (!player || !snapshot) return <GameRoot reducedMotion={reducedMotion}>
    <LoadingScreen label="Waking up your Friend" detail="Reading its on-chain pixels" />
  </GameRoot>;
  if (snapshot.friendId !== friendId) return <GameRoot><ErrorScreen message="This game session does not match the selected Friend." /></GameRoot>;

  const busy = game.busy;
  const busyLabel = busy ? BUSY_LABEL[busy] : undefined;
  const eggs = Number(snapshot.consumables);
  const price = formatRF(definition.price);
  const modalOpen = panel !== null || hatch !== null || showIntro || flight !== null;
  // The HUD counts a launch once its result card is up, so it never gives the ending away early.
  const inAir = flight && flight.stage !== "result" ? flight.result : null;
  const hatchParents = hatch ? [hearts.dress(hatch.parentA), hearts.dress(hatch.parentB)] : [];
  const shopBlocker = panel === "eggs" ? purchaseBlocker(snapshot, definition) : null;
  // What the HUD shows right now, for the intro's and the help panel's HUD legend.
  // The HUD counts a new baby only once it is kept: during the hatch and its reveal card it is not decided yet.
  const keptCount = brood.length - (hatch && brood.some(baby => baby.key === hatch.baby.key) ? 1 : 0);
  const hudSample = { hearts: hearts.hearts, balance: formatRF(snapshot.rfBalance), eggs, brood: keptCount, families: collection.families.length, net: slingshotNet(sling.ledger) };

  return <GameRoot reducedMotion={reducedMotion} busy={!!busy}>
    <WorldLayer inert={modalOpen || paused}>
      <canvas ref={setWorldCanvas} className="rb-world-canvas" aria-label={`Nursery. ${player.name} and ${brood.length} babies. Use WASD or arrow keys, or tap to walk.`} />
      <Hud balance={formatRF(snapshot.rfBalance)} eggs={eggs} broodCount={keptCount} muted={muted}
        onToggleSound={() => setMuted(value => !value)} onOpenSettings={() => openPanel("settings")}
        onOpenBrood={() => openBrood()} disabled={paused || !!busy} collection={collection}
        hearts={hearts.hearts} onOpenShop={() => openShop("hats")}
        slingshot={{ net: slingshotNet(sling.ledger) - (inAir ? inAir.payout - inAir.value : 0n), launches: sling.ledger.launches - (inAir ? 1 : 0) }}
        onOpenSlingshot={openSling} />
      {note && <Toast key={note.id} message={note.message} tone={note.tone} duration={note.duration} onDismiss={() => { setNote(null); game.clearError(); }} />}
      {!modalOpen && <ActionBar onFindMatch={() => openMatch()} broodCount={brood.length} onOpenBrood={() => openBrood()}
        primaryLabel={game.pendingPlay ? "Finish hatching" : busy ? busyLabel : undefined} disabled={paused || !!busy}
        prompt={near ? { label: STATION_LABEL[near], short: STATION_SHORT[near], keyHint: "E", onActivate: () => handlers.current.station(near) }
          : firstTime.sling && !firstTime.match && brood.length > 0 ? { label: SLING_HINT, short: SLING_HINT_SHORT, keyHint: "!", onActivate: openSling } : null}
        coach={firstTime.match ? COACH : null} />}
    </WorldLayer>

    {panel === "match" && <MatchmakerPanel key={parentAKey ?? "friend"} parents={[dressedPlayer ?? player, ...dressedBrood]} candidates={game.candidates}
      eggs={eggs} price={price} needsEgg={game.needsEgg} canAfford={game.canAfford} busy={!!busy} busyLabel={busyLabel}
      actionLabel={game.pendingPlay ? "Finish hatching" : undefined} error={game.error} disabledReason={game.blockerText || undefined}
      initialParentA={parentAKey} onReroll={() => { cue("select"); game.reroll(); }} onBreed={(a, b) => void breed(a, b)}
      onClose={busy ? undefined : () => openPanel(null)} collectedFamilies={collection.families} odds={tiers} guide={firstTime.breed}
      onWish={() => openShop("wish")} wishPrice={WISH_PRICE} reducedMotion={reducedMotion}
      preferredMateKey={game.candidates.find(mate => !collection.families.includes(familyOf(mate)))?.key}
      onStockUp={quantity => void stockUp(quantity)} stockUpQuantity={Number(STOCK_UP)} stockUpPrice={formatRF(definition.price * STOCK_UP)}
      stockUpDisabled={paused || purchaseBlocker(snapshot, definition, STOCK_UP) !== null} />}

    {panel === "brood" && <BroodPanel babies={dressedBrood} tiers={tiers} creature={dressedCreature} initialSelectedKey={broodFocus}
      friend={dressedPlayer ?? player} initialTab={broodTab}
      heartsRate={baby => heartsPerMinute(baby.tier)} onOpenShop={() => openShop("hats")} hatchNumber={hatchNumber}
      onRelease={baby => void release(baby, false)} onUseAsParent={baby => openMatch(baby.key)} onFindMatch={() => openMatch()}
      onClose={busy ? undefined : () => { setBroodFocus(null); openPanel(null); }} collection={collection} sanctuary={sanctuary} busy={!!busy}
      busyLabel={busyLabel} error={game.error} reducedMotion={reducedMotion} />}

    {panel === "eggs" && <EggShopPanel eggs={eggs} balance={formatRF(snapshot.rfBalance)} busy={!!busy} onBuy={quantity => void buyEggs(quantity)}
      packs={EGG_PACKS.map(quantity => ({ quantity, price: formatRF(definition.price * quantity), disabled: paused || purchaseBlocker(snapshot, definition, quantity) !== null }))}
      reason={shopBlocker === "balance" ? "Not enough simulated RF for an egg right now." : shopBlocker === "backing" ? "The hatchery is out of prize backing right now." : undefined}
      note={<>Average Sanctuary value: {expectedValueLabel(definition)}.</>} onClose={busy ? undefined : () => openPanel(null)} />}

    {panel === "settings" && <SettingsPanel muted={muted} onToggleSound={() => setMuted(value => !value)} reducedMotion={reducedMotion}
      onToggleReducedMotion={() => setReducedMotion(value => !value)} odds={tiers} price={price} onClose={() => openPanel(null)}
      note={<>Expected Sanctuary value: {expectedValueLabel(definition)}.</>} onReplayIntro={() => { setPanel(null); setIntro(true); }}
      moonFund={formatRF(sling.ledger.fund)} player={dressedPlayer ?? player} hud={hudSample} />}

    {panel === "shop" && <HeartShopPanel hearts={hearts.hearts} perMinute={hearts.perMinute} wearers={[dressedPlayer ?? player, ...dressedBrood]}
      catalog={ACCESSORIES} owned={hearts.owned} equipped={hearts.equipped} initialTab={shopTab} reducedMotion={reducedMotion}
      onBuy={id => { if (hearts.buy(id)) cue("purchase"); }} onEquip={(key, id) => { hearts.equip(key, id); cue("select"); }}
      families={wishFamilies} wishPrice={WISH_PRICE} collectedFamilies={collection.families} onWish={wish} onClose={() => openPanel(null)} />}

    {/* The runtime also pauses the game while its "Redeem reward" dialog is open: busy wins, so the panel says what to confirm. */}
    {panel === "sling" && <SlingshotPanel brood={dressedBrood} tiers={tierRows} blocker={sling.blocker} fund={sling.ledger.fund} bestExit={sling.ledger.topExit} titles={titlesOf} busy={!!busy}
      disabledReason={paused && !busy ? "The game is paused." : undefined} onLaunch={key => void launch(key)} onFindMatch={() => openMatch()}
      onClose={busy ? undefined : () => openPanel(null)} reducedMotion={reducedMotion} />}

    {flight && flight.stage !== "shot" && <LaunchOverlay key={flight.baby.key} canvasRef={setLaunchCanvas} sequence={launchSeq} baby={flight.baby} value={flight.value}
      paused={paused} onIgnite={() => sling.ignite(flight.baby.key, flight.value)}
      onSettle={exit => { const result = sling.settle(exit); if (result) setFlight(current => current && { ...current, result }); return result; }}
      onLanded={() => setFlight(current => current && { ...current, stage: "result" })} onCancel={skipFlight}
      canLaunchAgain={brood.length > 0} bestExit={sling.ledger.topExit} onLaunchAgain={() => closeFlight(true)} onClose={() => closeFlight(false)} reducedMotion={reducedMotion} />}

    {showIntro && introMate && <IntroPanel keepHeartsPerMinute={[heartsPerMinute("common"), heartsPerMinute("prismatic")]} player={player} mate={introMate} tiers={tiers} price={price}
      startBalance={formatRF(startBalance.current ?? snapshot.rfBalance)} hud={hudSample} reducedMotion={reducedMotion}
      onStepChange={() => cue("select")} onClose={() => { setIntro(false); cue("select"); }} />}

    {hatch && <HatchOverlay stage={hatch.stage} canvasRef={setHatchCanvas} onSkip={() => sequence.current?.skip()}
      onClose={hatch.stage === "result" && !busy ? () => keep(hatch.baby) : undefined} reducedMotion={reducedMotion}
      label={`${hatch.baby.name} hatched`}>
      {hatch.stage === "result" && <BabyCard baby={hatch.baby} parentA={hatchParents[0]} parentB={hatchParents[1]}
        chance={tierInfo(hatch.baby.tier).chance} value={tierInfo(hatch.baby.tier).value} mode="reveal"
        discoveries={discoveriesOf(hatch.baby, collection, lineageTitles(hatch.baby, game.creature, player))}
        heartsPerMinute={heartsPerMinute(hatch.baby.tier)} keepBonus={KEEP_BONUS} creature={dressedCreature} friend={dressedPlayer ?? player} hatchNumber={hatchNumber(hatch.baby)}
        onKeep={() => keep(hatch.baby)} onRelease={() => void release(hatch.baby, true)} busy={!!busy} busyLabel={busyLabel}
        error={game.error} reducedMotion={reducedMotion} />}
    </HatchOverlay>}
  </GameRoot>;
}
