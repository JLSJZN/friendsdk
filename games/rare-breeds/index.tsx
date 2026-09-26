"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendSoundKit, type FriendSoundCue, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import { useRareBreeds } from "./src/controller.ts";
import { ACCESSORIES } from "./src/accessories.ts";
import { KEEP_BONUS, WISH_PRICE, heartsPerMinute, useHearts, wishFamilies } from "./src/hearts.ts";
import { describeTiers, expectedValueLabel, formatRF, purchaseBlocker } from "./src/economy.ts";
import { createNurseryScene } from "./src/scene/nursery.ts";
import { createHatchSequence } from "./src/scene/hatch.ts";
import type { HatchSequence, NurseryScene } from "./src/api.ts";
import { TIER_ORDER, type Creature, type StationId, type TierId } from "./src/types.ts";
import {
  ActionBar, BabyCard, BroodPanel, EggShopPanel, ErrorScreen, GameRoot, HatchOverlay, HeartShopPanel, Hud, IntroPanel, LoadingScreen,
  MatchmakerPanel, SettingsPanel, Toast, WorldLayer, buildCollection, discoveriesOf, type ShopTab, type TierInfo,
} from "./src/ui/index.ts";
import "./style.css";

type PanelId = "match" | "brood" | "settings" | "eggs" | "shop";
type Note = Readonly<{ message: string; tone: "info" | "success" | "error"; id: number }>;

const STATION_LABEL: Record<StationId, string> = { matchmaker: "Open Matchmaker", incubator: "Buy eggs", sanctuary: "Visit Sanctuary" };
const COACH = { title: "Start here", detail: "Find a mate for your Friend, or walk to the MATCH terminal." } as const;
const BUSY_LABEL = { buying: "Buying egg…", laying: "Laying egg…", hatching: "Hatching…", releasing: "Trading in…" } as const;
const REVEAL_CUE: Record<TierId, FriendSoundCue> = {
  common: "reveal-common", spotted: "reveal-common", mutant: "reveal-rare", prismatic: "reveal-legendary",
};
const EGG_PACKS = [1n, 3n, 5n] as const;

/** Rare Breeds: the SDK runtime supplies the verified Friend, the simulated ledger and every confirmation. */
export default function RareBreeds({ friendId, client, paused }: GameComponentProps) {
  const game = useRareBreeds({ friendId, client, paused });
  const { player, snapshot, hatch, brood, definition } = game;
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [parentAKey, setParentAKey] = useState<string | undefined>();
  const [broodFocus, setBroodFocus] = useState<string | null>(null);
  const [near, setNear] = useState<StationId | null>(null);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [note, setNote] = useState<Note | null>(null);
  const [hatchCanvas, setHatchCanvas] = useState<HTMLCanvasElement | null>(null);
  const [worldCanvas, setWorldCanvas] = useState<HTMLCanvasElement | null>(null);
  const scene = useRef<NurseryScene | null>(null), sequence = useRef<HatchSequence | null>(null);
  const sound = useRef<FriendSoundKit | null>(null);
  // First-run help (session only: the sandbox has no storage). The intro opens on every game start.
  const [intro, setIntro] = useState(true);
  const [firstTime, setFirstTime] = useState({ match: true, breed: true, card: true });
  const [sanctuary, setSanctuary] = useState(false);
  const startBalance = useRef<bigint | null>(null);
  if (snapshot && startBalance.current === null) startBalance.current = snapshot.rfBalance;
  // The intro's example mate: a real wild Friend on offer, from another family when possible. Fixed per Friend.
  const introMate = useMemo(() => game.candidates.find(mate => mate.familyId !== player?.familyId) ?? game.candidates[0], [player]);
  const showIntro = intro && !!introMate;
  // Hearts: game points kept babies earn (never RF). Income pauses with the runtime, the intro and a hatch.
  const hearts = useHearts({ brood, active: !paused && !showIntro && !hatch, onEarn: (key, amount) => scene.current?.emitHearts(key, amount) });
  const [shopTab, setShopTab] = useState<ShopTab>("hats");
  // Everyone shown anywhere wears their equipped accessory.
  const dressedPlayer = useMemo(() => player && hearts.dress(player), [player, hearts.dress]);
  const dressedBrood = useMemo(() => brood.map(baby => hearts.dress(baby)), [brood, hearts.dress]);
  const dressedCreature = useCallback((key: string) => {
    const found = game.creature(key);
    return found && hearts.dress(found);
  }, [hearts.dress]);

  const tiers: readonly TierInfo[] = useMemo(() => describeTiers(definition)
    .map(row => ({ tier: row.tier, chance: row.chancePercent, value: row.rewardLabel })), [definition]);
  const tierInfo = (tier: TierId | undefined) => tiers.find(row => row.tier === (tier ?? "common")) ?? tiers[0];
  // Collection goal: families and tiers of every baby hatched this session, kept or sent to the Sanctuary.
  // The baby on the reveal card joins once the card closes, so the card can show what it adds.
  const collection = useMemo(() => {
    const revealing = hatch?.baby.key;
    const settled = (snapshot?.plays ?? []).filter(play => play.outcomeId !== null && `baby:${play.id}` !== revealing);
    return buildCollection([...brood, ...settled.map(play => game.creature(`baby:${play.id}`))].filter(baby => baby?.key !== revealing),
      settled.map(play => TIER_ORDER[(play.outcomeId ?? 1) - 1]));
  }, [snapshot, brood, hatch?.baby.key]);
  const notify = useCallback((message: string, tone: Note["tone"] = "info") => setNote({ message, tone, id: Date.now() }), []);
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

  // The nursery world. Callbacks go through a ref so the scene is created once per Friend.
  const handlers = useRef({ station: (_: StationId) => {}, creature: (_: string) => {} });
  handlers.current = {
    station: station => {
      if (station === "matchmaker") openMatch();
      else { openPanel(station === "incubator" ? "eggs" : "brood"); setSanctuary(station === "sanctuary"); }
    },
    creature: key => { setBroodFocus(key); openPanel("brood"); },
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
  const worldPaused = paused || panel !== null || hatch !== null || showIntro;
  useEffect(() => { scene.current?.setPaused(worldPaused); }, [worldPaused, worldCanvas, player]);

  // The hatch overlay: the outcome is already settled; this only presents it.
  useEffect(() => {
    if (!hatch || hatch.stage !== "hatching" || !hatchCanvas) return;
    let revealed = false;
    const created = createHatchSequence({
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
    notify(`${baby.name} joined your brood. +${KEEP_BONUS} Hearts`, "success");
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

  function openShop(tab: ShopTab) { setShopTab(tab); openPanel("shop"); }

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
  const modalOpen = panel !== null || hatch !== null || showIntro;
  const hatchParents = hatch ? [hearts.dress(hatch.parentA), hearts.dress(hatch.parentB)] : [];
  const shopBlocker = panel === "eggs" ? purchaseBlocker(snapshot, definition) : null;

  return <GameRoot reducedMotion={reducedMotion} busy={!!busy}>
    <WorldLayer inert={modalOpen || paused}>
      <canvas ref={setWorldCanvas} className="rb-world-canvas" aria-label={`Nursery. ${player.name} and ${brood.length} babies. Use WASD or arrow keys, or tap to walk.`} />
      <Hud balance={formatRF(snapshot.rfBalance)} eggs={eggs} broodCount={brood.length} muted={muted}
        onToggleSound={() => setMuted(value => !value)} onOpenSettings={() => openPanel("settings")}
        onOpenBrood={() => openPanel("brood")} disabled={paused || !!busy} collection={collection}
        hearts={hearts.hearts} onOpenShop={() => openShop("hats")} />
      {note && <Toast key={note.id} message={note.message} tone={note.tone} onDismiss={() => { setNote(null); game.clearError(); }} />}
      {!modalOpen && <ActionBar onFindMatch={() => openMatch()} broodCount={brood.length} onOpenBrood={() => openPanel("brood")}
        primaryLabel={game.pendingPlay ? "Finish hatching" : busy ? busyLabel : undefined} disabled={paused || !!busy}
        prompt={near ? { label: STATION_LABEL[near], keyHint: "E", onActivate: () => handlers.current.station(near) } : null}
        coach={firstTime.match ? COACH : null} />}
    </WorldLayer>

    {panel === "match" && <MatchmakerPanel key={parentAKey ?? "friend"} parents={[dressedPlayer ?? player, ...dressedBrood]} candidates={game.candidates}
      eggs={eggs} price={price} needsEgg={game.needsEgg} canAfford={game.canAfford} busy={!!busy} busyLabel={busyLabel}
      actionLabel={game.pendingPlay ? "Finish hatching" : undefined} error={game.error} disabledReason={game.blockerText || undefined}
      initialParentA={parentAKey} onReroll={() => { cue("select"); game.reroll(); }} onBreed={(a, b) => void breed(a, b)}
      onClose={busy ? undefined : () => openPanel(null)} collectedFamilies={collection.families} odds={tiers} guide={firstTime.breed}
      onWish={() => openShop("wish")} wishPrice={WISH_PRICE} reducedMotion={reducedMotion} />}

    {panel === "brood" && <BroodPanel babies={dressedBrood} tiers={tiers} creature={dressedCreature} initialSelectedKey={broodFocus}
      heartsRate={baby => heartsPerMinute(baby.tier)} onOpenShop={() => openShop("hats")}
      onRelease={baby => void release(baby, false)} onUseAsParent={baby => openMatch(baby.key)} onFindMatch={() => openMatch()}
      onClose={busy ? undefined : () => { setBroodFocus(null); openPanel(null); }} collection={collection} sanctuary={sanctuary} busy={!!busy}
      busyLabel={busyLabel} error={game.error} reducedMotion={reducedMotion} />}

    {panel === "eggs" && <EggShopPanel eggs={eggs} balance={formatRF(snapshot.rfBalance)} busy={!!busy} onBuy={quantity => void buyEggs(quantity)}
      packs={EGG_PACKS.map(quantity => ({ quantity, price: formatRF(definition.price * quantity), disabled: paused || purchaseBlocker(snapshot, definition, quantity) !== null }))}
      reason={shopBlocker === "balance" ? "Not enough simulated RF for an egg right now." : shopBlocker === "backing" ? "The hatchery is out of prize backing right now." : undefined}
      note={<>Average Sanctuary value: {expectedValueLabel(definition)}.</>} onClose={busy ? undefined : () => openPanel(null)} />}

    {panel === "settings" && <SettingsPanel muted={muted} onToggleSound={() => setMuted(value => !value)} reducedMotion={reducedMotion}
      onToggleReducedMotion={() => setReducedMotion(value => !value)} odds={tiers} price={price} onClose={() => openPanel(null)}
      note={<>Expected Sanctuary value: {expectedValueLabel(definition)}.</>} onReplayIntro={() => { setPanel(null); setIntro(true); }} />}

    {panel === "shop" && <HeartShopPanel hearts={hearts.hearts} perMinute={hearts.perMinute} wearers={[dressedPlayer ?? player, ...dressedBrood]}
      catalog={ACCESSORIES} owned={hearts.owned} equipped={hearts.equipped} initialTab={shopTab} reducedMotion={reducedMotion}
      onBuy={id => { if (hearts.buy(id)) cue("purchase"); }} onEquip={(key, id) => { hearts.equip(key, id); cue("select"); }}
      families={wishFamilies} wishPrice={WISH_PRICE} collectedFamilies={collection.families} onWish={wish} onClose={() => openPanel(null)} />}

    {showIntro && introMate && <IntroPanel keepHeartsPerMinute={heartsPerMinute("common")} player={player} mate={introMate} tiers={tiers} price={price}
      startBalance={formatRF(startBalance.current ?? snapshot.rfBalance)} collection={collection} reducedMotion={reducedMotion}
      onStepChange={() => cue("select")} onClose={() => { setIntro(false); cue("select"); }} />}

    {hatch && <HatchOverlay stage={hatch.stage} canvasRef={setHatchCanvas} onSkip={() => sequence.current?.skip()}
      onClose={hatch.stage === "result" && !busy ? () => keep(hatch.baby) : undefined} reducedMotion={reducedMotion}
      label={`${hatch.baby.name} hatched`}>
      {hatch.stage === "result" && <BabyCard baby={hatch.baby} parentA={hatchParents[0]} parentB={hatchParents[1]}
        chance={tierInfo(hatch.baby.tier).chance} value={tierInfo(hatch.baby.tier).value} mode="reveal" discoveries={discoveriesOf(hatch.baby, collection)}
        heartsPerMinute={heartsPerMinute(hatch.baby.tier)} keepBonus={KEEP_BONUS}
        hint={firstTime.card ? `Keep ${hatch.baby.name} to earn ${heartsPerMinute(hatch.baby.tier)} Hearts a minute and breed again, or trade it in at the Sanctuary for a fixed ${tierInfo(hatch.baby.tier).value} (simulated).` : undefined}
        onKeep={() => keep(hatch.baby)} onRelease={() => void release(hatch.baby, true)} busy={!!busy} busyLabel={busyLabel}
        error={game.error} reducedMotion={reducedMotion} />}
    </HatchOverlay>}
  </GameRoot>;
}
