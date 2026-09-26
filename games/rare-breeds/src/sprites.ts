// Canonical sprite decoding. Pure module (type-only SDK import) so node tests can use it.
import type { GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { FACINGS, FRAME_SIZE, type Creature, type Facing, type Frame, type SpriteSheet } from "./types.ts";

/** Same order as the SDK's GENERATION_FAMILY_NAMES (registry family ids 0-8). */
export const FAMILY_NAMES = ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"] as const;
export const COLOSSUS = 6;

/** Registry bitmap: bit 0 is the top-left pixel, bit 255 the bottom-right. */
export function frameFromBitmap(bitmap: bigint): Frame {
  const frame = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
  for (let i = 0; i < frame.length; i++) frame[i] = Number((bitmap >> BigInt(i)) & 1n);
  return frame;
}

export function frameFromHex(hex: string): Frame {
  return frameFromBitmap(BigInt("0x" + (hex || "0")));
}

export const inkCount = (frame: Frame) => frame.reduce((sum, value) => sum + value, 0);

/**
 * Build a sheet from the 64 registry frames (idle down/up/left/right x 8, then walk).
 * Colossus has no up/down art: those facings reuse the right-facing frames.
 */
export function sheetFromFrames(frames: readonly Frame[], familyId: number): SpriteSheet {
  if (frames.length !== 64) throw new RangeError("A sprite sheet needs exactly 64 frames.");
  const clip = (offset: number) => {
    const byFacing = Object.fromEntries(FACINGS.map((facing, index) =>
      [facing, frames.slice(offset + index * 8, offset + index * 8 + 8)])) as Record<Facing, Frame[]>;
    const empty = (list: Frame[]) => list.every(frame => inkCount(frame) === 0);
    if (familyId === COLOSSUS || empty(byFacing.down)) byFacing.down = byFacing.right;
    if (familyId === COLOSSUS || empty(byFacing.up)) byFacing.up = byFacing.right;
    return Object.freeze(byFacing);
  };
  return Object.freeze({ idle: clip(0), walk: clip(32) });
}

export type WildFriendRecord = Readonly<{ id: string; familyId: number; family: string; seed: number; frames: readonly string[]; pinned?: boolean }>;

export function creatureFromRecord(record: WildFriendRecord, kind: "wild" | "friend" = "wild"): Creature {
  return Object.freeze({
    key: `${kind}:${record.id}`, kind, tokenId: BigInt(record.id), name: `Friend #${record.id}`,
    family: FAMILY_NAMES[record.familyId] ?? "Unknown", familyId: record.familyId, lineage: 0,
    sheet: sheetFromFrames(record.frames.map(frameFromHex), record.familyId),
  });
}

/** Convert the SDK reader result (createFriendReader().read(friendId)) for the player's Friend. */
export function creatureFromGenerationSprites(sprites: GenerationSprites): Creature {
  return Object.freeze({
    key: `friend:${sprites.tokenId}`, kind: "friend", tokenId: sprites.tokenId, name: `Friend #${sprites.tokenId}`,
    family: sprites.familyName, familyId: sprites.familyId, lineage: 0,
    sheet: sheetFromFrames(sprites.frames.map(frameFromBitmap), sprites.familyId),
  });
}
