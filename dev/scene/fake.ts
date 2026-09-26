// Dev-only stand-in genetics for the scene harness (?fake=1). The real breed() lives in src/genetics.ts.
import { FACINGS, FRAME_SIZE, type Clip, type Creature, type Facing, type Frame, type SpriteSheet, type TierId } from "../../games/rare-breeds/src/types.ts";

const NAMES = ["Zibu", "Mopo", "Kiki", "Tolu", "Brix", "Nena", "Pif", "Oru"];

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fakeBaby(a: Creature, b: Creature, index: number, tier: TierId): Creature {
  const next = random(index * 7919 + 13);
  const rowSource: (0 | 1)[] = [];
  let source: 0 | 1 = next() < 0.5 ? 0 : 1;
  while (rowSource.length < FRAME_SIZE) {
    const run = 2 + Math.floor(next() * 4);
    for (let i = 0; i < run && rowSource.length < FRAME_SIZE; i++) rowSource.push(source);
    source = source ? 0 : 1;
  }
  const mutations: number[] = [];
  if (tier === "mutant" || tier === "prismatic") {
    const base = a.sheet.idle.down[0];
    let top = 0;
    while (top < FRAME_SIZE && !base.slice(top * FRAME_SIZE, top * FRAME_SIZE + FRAME_SIZE).some(Boolean)) top++;
    const y = Math.max(0, top - 1);
    mutations.push(y * FRAME_SIZE + 5, y * FRAME_SIZE + 10, Math.max(0, y - 1) * FRAME_SIZE + 4, Math.max(0, y - 1) * FRAME_SIZE + 11);
  }
  const mix = (fa: Frame, fb: Frame): Frame => {
    const out = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
    for (let y = 0; y < FRAME_SIZE; y++) for (let x = 0; x < FRAME_SIZE; x++) {
      const i = y * FRAME_SIZE + x;
      out[i] = rowSource[y] ? fb[i] : fa[i];
    }
    for (const cell of mutations) out[cell] = 1;
    return out;
  };
  const clips: Clip[] = ["idle", "walk"];
  const sheet = Object.fromEntries(clips.map(clip => [clip, Object.fromEntries(FACINGS.map((facing: Facing) =>
    [facing, a.sheet[clip][facing].map((frame, n) => mix(frame, b.sheet[clip][facing][n]))]))])) as unknown as SpriteSheet;
  const pattern = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
  if (tier !== "common") for (let y = 0; y < FRAME_SIZE; y++) for (let x = 0; x < FRAME_SIZE; x++) {
    const on = tier === "spotted" ? (x * 7 + y * 3) % 5 === 0 : tier === "mutant" ? y % 3 === 0 : (x + y) % 2 === 0;
    if (on) pattern[y * FRAME_SIZE + x] = 1;
  }
  return Object.freeze({
    key: `baby:${9000 + index}`, kind: "baby", name: NAMES[index % NAMES.length], family: `${a.family} x ${b.family}`,
    familyId: a.familyId, lineage: 1, sheet, tier, parents: [a.key, b.key] as const, playId: BigInt(9000 + index),
    dna: Object.freeze({ rowSource, pattern, mutations, traits: tier === "mutant" ? ["Antennae"] : [] }),
  });
}
