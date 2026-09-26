// Module interfaces between the renderer (src/scene/) and the React UI (src/ui/, index.tsx).
// Owned by the project lead: change only by agreement.
import type { Creature, StationId } from "./types.ts";

export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 640;

export type NurserySceneOptions = Readonly<{
  canvas: HTMLCanvasElement;
  player: Creature;
  reducedMotion: boolean;
  /** Player walked into (or away from, null) a station's reach. */
  onStationNear?: (station: StationId | null) => void;
  /** Player tapped/clicked a station, or pressed E / Enter / Space near one. */
  onStationActivate?: (station: StationId) => void;
  /** Player tapped/clicked a baby in the world. */
  onCreatureActivate?: (key: string) => void;
}>;

/** Created by createNurseryScene(options) in src/scene/nursery.ts. Owns its canvas, loop and input listeners. */
export interface NurseryScene {
  /** Replace the player's creature (same key), e.g. after equipping an accessory. Position and state are kept. */
  setPlayer(player: Creature): void;
  /** Visual only: pixel hearts pop from a creature (key) and fly toward the HUD heart counter (top-left). */
  emitHearts(key: string, amount: number): void;
  /** Babies currently kept; they follow the player in a line (newest last). Same keys with new objects (e.g. new accessory) update in place. */
  setBrood(babies: readonly Creature[]): void;
  /** While paused the world renders a still frame, ignores input and stops held movement. */
  setPaused(paused: boolean): void;
  setReducedMotion(reducedMotion: boolean): void;
  /** Number of eggs waiting (drawn on the incubator). */
  setEggCount(count: number): void;
  /** A wild mate walks in from the door to the player, hearts, then leaves. Resolves when done (fast when reduced motion). */
  playCourtship(mate: Creature): Promise<void>;
  /** A baby walks from the player to the sanctuary gate and disappears. */
  playRelease(babyKey: string): Promise<void>;
  /** Emits a short celebration burst around a creature (key) in the world. */
  celebrate(key: string): void;
  destroy(): void;
}

export type HatchSequenceOptions = Readonly<{
  canvas: HTMLCanvasElement;
  parentA: Creature;
  parentB: Creature;
  baby: Creature;
  reducedMotion: boolean;
  /** Called at the dramatic beats so the UI can play sounds. */
  onBeat?: (beat: "wobble" | "crack" | "merge" | "reveal") => void;
}>;

/** Created by createHatchSequence(options) in src/scene/hatch.ts. Draws on its own overlay canvas. */
export interface HatchSequence {
  /** Plays egg wobble -> crack -> parent pixel rows fly in and merge -> baby reveal. Resolves at the end. */
  play(): Promise<void>;
  /** Jump to the final reveal frame immediately. */
  skip(): void;
  destroy(): void;
}
