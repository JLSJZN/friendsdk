"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { createFriendSoundKit, type FriendSoundCue, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import { useRareBreeds } from "./src/controller.ts";
import { describeTiers, expectedValueLabel, formatRF, purchaseBlocker } from "./src/economy.ts";
import { createNurseryScene } from "./src/scene/nursery.ts";
import { createHatchSequence } from "./src/scene/hatch.ts";
import type { HatchSequence, NurseryScene } from "./src/api.ts";
import { TIER_ORDER, type Creature, type StationId, type TierId } from "./src/types.ts";
import {
  ActionBar, BabyCard, BroodPanel, EggShopPanel, ErrorScreen, GameRoot, HatchOverlay, Hud, LoadingScreen, MatchmakerPanel,
  SettingsPanel, Toast, WorldLayer, buildCollection, discoveriesOf, type TierInfo,
} from "./src/ui/index.ts";
import "./style.css";

type PanelId = "match" | "brood" | "settings" | "eggs";
type Note = Readonly<{ message: string; tone: "info" | "success" | "error"; id: number }>;

const STATION_LABEL: Record<StationId, string> = { matchmaker: "Matchmaker", incubator: "Egg incubator", sanctuary: "Sanctuary" };
const BUSY_LABEL = { buying: "Buying egg…", laying: "Laying egg…", hatching: "Hatching…", releasing: "Sending…" } as const;
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
    if (next) cue("select");
  }, [paused, cue]);
  const openMatch = useCallback((parentA?: string) => { setParentAKey(parentA); openPanel("match"); }, [openPanel]);

  // The nursery world. Callbacks go through a ref so the scene is created once per Friend.
  const handlers = useRef({ station: (_: StationId) => {}, creature: (_: string) => {} });
  handlers.current = {
    station: station => station === "matchmaker" ? openMatch() : openPanel(station === "incubator" ? "eggs" : "brood"),
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
  useEffect(() => { scene.current?.setBrood(brood); }, [brood, worldCanvas, player]);
  useEffect(() => { scene.current?.setEggCount(Number(snapshot?.consumables ?? 0n)); }, [snapshot, worldCanvas, player]);
  useEffect(() => { scene.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);
  const worldPaused = paused || panel !== null || hatch !== null;
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
  }

  function keep(baby: Creature) {
    game.closeHatch();
    cue("reward");
    scene.current?.celebrate(baby.key);
    notify(`${baby.name} joined your brood.`, "success");
  }

  async function release(baby: Creature, fromReveal: boolean) {
    const value = tierInfo(baby.tier).value;
    if (!(await game.release(baby))) return;
    if (fromReveal) game.closeHatch();
    setPanel(null);
    cue("reward");
    notify(`${baby.name} moved to the Sanctuary. +${value} (simulated)`, "success");
    void scene.current?.playRelease(baby.key);
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
  const modalOpen = panel !== null || hatch !== null;
  const hatchParents = hatch ? [hatch.parentA, hatch.parentB] : [];
  const shopBlocker = panel === "eggs" ? purchaseBlocker(snapshot, definition) : null;

  return <GameRoot reducedMotion={reducedMotion} busy={!!busy}>
    <WorldLayer inert={modalOpen || paused}>
      <canvas ref={setWorldCanvas} className="rb-world-canvas" aria-label={`Nursery. ${player.name} and ${brood.length} babies. Use WASD or arrow keys, or tap to walk.`} />
      <Hud balance={formatRF(snapshot.rfBalance)} eggs={eggs} broodCount={brood.length} muted={muted}
        onToggleSound={() => setMuted(value => !value)} onOpenSettings={() => openPanel("settings")}
        onOpenBrood={() => openPanel("brood")} disabled={paused || !!busy} collection={collection} />
      {note && <Toast key={note.id} message={note.message} tone={note.tone} onDismiss={() => { setNote(null); game.clearError(); }} />}
      {!modalOpen && <ActionBar onFindMatch={() => openMatch()} broodCount={brood.length} onOpenBrood={() => openPanel("brood")}
        primaryLabel={game.pendingPlay ? "Finish hatching" : busy ? busyLabel : undefined} disabled={paused || !!busy}
        prompt={near ? { label: STATION_LABEL[near], keyHint: "E", onActivate: () => handlers.current.station(near) } : null} />}
    </WorldLayer>

    {panel === "match" && <MatchmakerPanel key={parentAKey ?? "friend"} parents={[player, ...brood]} candidates={game.candidates}
      eggs={eggs} price={price} needsEgg={game.needsEgg} canAfford={game.canAfford} busy={!!busy} busyLabel={busyLabel}
      actionLabel={game.pendingPlay ? "Finish hatching" : undefined} error={game.error} disabledReason={game.blockerText || undefined}
      initialParentA={parentAKey} onReroll={() => { cue("select"); game.reroll(); }} onBreed={(a, b) => void breed(a, b)}
      onClose={busy ? undefined : () => openPanel(null)} collectedFamilies={collection.families} reducedMotion={reducedMotion} />}

    {panel === "brood" && <BroodPanel babies={brood} tiers={tiers} creature={game.creature} initialSelectedKey={broodFocus}
      onRelease={baby => void release(baby, false)} onUseAsParent={baby => openMatch(baby.key)} onFindMatch={() => openMatch()}
      onClose={busy ? undefined : () => { setBroodFocus(null); openPanel(null); }} collection={collection} busy={!!busy} busyLabel={busyLabel}
      error={game.error} reducedMotion={reducedMotion} />}

    {panel === "eggs" && <EggShopPanel eggs={eggs} balance={formatRF(snapshot.rfBalance)} busy={!!busy} onBuy={quantity => void buyEggs(quantity)}
      packs={EGG_PACKS.map(quantity => ({ quantity, price: formatRF(definition.price * quantity), disabled: paused || purchaseBlocker(snapshot, definition, quantity) !== null }))}
      reason={shopBlocker === "balance" ? "Not enough simulated RF for an egg right now." : shopBlocker === "backing" ? "The hatchery is out of prize backing right now." : undefined}
      note={<>Average Sanctuary value: {expectedValueLabel(definition)}.</>} onClose={busy ? undefined : () => openPanel(null)} />}

    {panel === "settings" && <SettingsPanel muted={muted} onToggleSound={() => setMuted(value => !value)} reducedMotion={reducedMotion}
      onToggleReducedMotion={() => setReducedMotion(value => !value)} odds={tiers} price={price} onClose={() => openPanel(null)}
      note={<>Expected Sanctuary value: {expectedValueLabel(definition)}.</>} />}

    {hatch && <HatchOverlay stage={hatch.stage} canvasRef={setHatchCanvas} onSkip={() => sequence.current?.skip()}
      onClose={hatch.stage === "result" && !busy ? () => keep(hatch.baby) : undefined} reducedMotion={reducedMotion}
      label={`${hatch.baby.name} hatched`}>
      {hatch.stage === "result" && <BabyCard baby={hatch.baby} parentA={hatchParents[0]} parentB={hatchParents[1]}
        chance={tierInfo(hatch.baby.tier).chance} value={tierInfo(hatch.baby.tier).value} mode="reveal" discoveries={discoveriesOf(hatch.baby, collection)}
        onKeep={() => keep(hatch.baby)} onRelease={() => void release(hatch.baby, true)} busy={!!busy} busyLabel={busyLabel}
        error={game.error} reducedMotion={reducedMotion} />}
    </HatchOverlay>}
  </GameRoot>;
}
