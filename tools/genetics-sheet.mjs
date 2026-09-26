// Dev tool: render Rare Breeds genetics contact sheets from the bundled wild Friend pool.
// Run from the SDK root: node tools/genetics-sheet.mjs [--out <dir>]
// Writes genetics-{sheet,pairs,f2}.svg and, on macOS (qlmanage), matching PNGs to games/rare-breeds/docs/media (or --out).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { breed, breedSeed } from "../games/rare-breeds/src/genetics.ts";
import { familyLine } from "../games/rare-breeds/src/legacy.ts";
import { creatureFromRecord, FAMILY_NAMES } from "../games/rare-breeds/src/sprites.ts";
import { TIER_ORDER, TIER_STYLE } from "../games/rare-breeds/src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const game = join(root, "games/rare-breeds");
const outFlag = process.argv.indexOf("--out");
const media = outFlag > 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : join(game, "docs/media");
const pool = JSON.parse(readFileSync(join(game, "data/wild-friends.json"), "utf8")).friends.map(record => creatureFromRecord(record));
const pinned = pool.find(creature => creature.tokenId === 77949n);
const byFamily = FAMILY_NAMES.map((_, id) => pool.filter(creature => creature.familyId === id && creature !== pinned));
/** Every creature by key, like the game's lineage map (for familyLine). */
const known = new Map(pool.map(creature => [creature.key, creature]));

const PAPER = "#F4F1EA", INK = "#111111", MUTED = "#8C877D", GRID = "#E6E1D6", A_TINT = "#2F6BFF", B_TINT = "#FF5A36";
const S = 4, BOX = 18 * S; // sprite pixel size, and a sprite cell including the one-pixel halo
const ROW = BOX + 30, LABELS = 150, WALK_X = LABELS + 2 * (BOX + 4) + 30 + 4 * (BOX + 4) + 18;

/** Hatch a baby the way the game does (seed from friend, parent keys and play id). */
function hatch(a, b, tier, playId) {
  const play = BigInt(playId), result = breed({ a, b, seed: breedSeed(77949n, a.key, b.key, play), tier, playId: play });
  const baby = Object.freeze({ key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [a.key, b.key], dna: result.dna, playId: play });
  known.set(baby.key, baby);
  return baby;
}

/** Sticker sprite like drawCreature: white halo, ink, pattern pixels in the tier accent (prismatic: rainbow at time 0). */
function sprite(creature, x, y, { clip = "idle", facing = "down", frame = 0 } = {}) {
  const pixels = creature.sheet[clip][facing][frame], pattern = creature.dna?.pattern, tier = creature.tier ?? "common";
  const halo = new Uint8Array(18 * 18), out = [];
  for (let i = 0; i < 256; i++) if (pixels[i]) for (let d = 0; d < 9; d++) halo[((i >> 4) + ((d / 3) | 0)) * 18 + (i & 15) + (d % 3)] = 1;
  for (let r = 0; r < 18; r++) for (let c = 0; c < 18; c++) {
    if (!halo[r * 18 + c] || (c > 0 && halo[r * 18 + c - 1])) continue;
    let end = c;
    while (end + 1 < 18 && halo[r * 18 + end + 1]) end++;
    out.push(`<rect x="${x + c * S}" y="${y + r * S}" width="${(end - c + 1) * S}" height="${S}" fill="#fff"/>`);
  }
  for (let i = 0; i < 256; i++) if (pixels[i]) {
    const px = i & 15, py = i >> 4, accent = pattern && pattern[i];
    const fill = !accent ? INK : tier === "prismatic" ? `hsl(${((px + py) * 22) % 360} 95% 58%)` : TIER_STYLE[tier].accent;
    out.push(`<rect x="${x + (px + 1) * S}" y="${y + (py + 1) * S}" width="${S}" height="${S}" fill="${fill}"/>`);
  }
  return out.join("");
}

const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x, y, value, { size = 12, fill = INK, anchor = "start", weight = 400 } = {}) =>
  `<text x="${x}" y="${y}" font-family="ui-monospace, Menlo, monospace" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escape(value)}</text>`;

/** DNA strip: the 16 rows coloured by the parent they came from. */
const dnaStrip = (baby, x, y) => baby.dna.rowSource.map((source, row) =>
  `<rect x="${x}" y="${y + S + row * S}" width="${S * 3}" height="${S - 1}" fill="${source ? B_TINT : A_TINT}"/>`).join("");

/** One pair: parents, DNA strip, the same seed in all four tiers, and 8 walk frames of one tier. */
function pairRow({ a, b, playId, walkTier = "mutant", walkFacing = "right", line = false }, y) {
  const babies = TIER_ORDER.map(tier => hatch(a, b, tier, playId)), parts = [];
  parts.push(text(16, y + 16, a.name, { size: 11, weight: 700 }), text(16, y + 30, a.family, { size: 10, fill: MUTED }));
  parts.push(text(16, y + 48, `× ${b.name}`, { size: 11, weight: 700 }), text(16, y + 62, b.family, { size: 10, fill: MUTED }));
  let x = LABELS;
  for (const [parent, label, tint] of [[a, "A", A_TINT], [b, "B", B_TINT]]) {
    parts.push(sprite(parent, x, y), text(x + BOX / 2, y + BOX + 12, label, { size: 10, fill: tint, anchor: "middle" }));
    x += BOX + 4;
  }
  parts.push(dnaStrip(babies[0], x + 8, y));
  x += 30;
  for (const baby of babies) {
    parts.push(sprite(baby, x, y), text(x + BOX / 2, y + BOX + 12, TIER_STYLE[baby.tier].label, { size: 9, fill: baby.tier === "common" ? MUTED : TIER_STYLE[baby.tier].accent, anchor: "middle" }));
    x += BOX + 4;
  }
  const shown = babies[TIER_ORDER.indexOf(walkTier)];
  const lineage = line ? ` · line ${familyLine(shown, key => known.get(key) ?? null).join(" + ")}` : "";
  parts.push(text(WALK_X, y + 8, `${shown.name} · ${shown.family} · F${shown.lineage}${lineage} · ${shown.dna.traits.join(", ") || "plain"} · walk ${walkFacing}`, { size: 10, fill: MUTED }));
  for (let frame = 0; frame < 8; frame++) parts.push(sprite(shown, WALK_X + frame * (BOX + 2), y + 12, { clip: "walk", facing: walkFacing, frame }));
  return parts.join("");
}

/** A square page (qlmanage thumbnails are square) with titled sections of pair rows. */
function writePage(name, title, subtitle, sections) {
  const body = [];
  let y = 76;
  for (const section of sections) {
    body.push(`<rect x="0" y="${y}" width="100%" height="1" fill="${GRID}"/>`, text(16, y + 24, section.title, { size: 15, weight: 700 }), text(16, y + 42, section.note, { size: 11, fill: MUTED }));
    y += 58;
    for (const row of section.rows) { body.push(pairRow(row, y)); y += ROW; }
    y += 6;
  }
  const size = Math.max(WALK_X + 8 * (BOX + 2) + 16, y + 10);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="${PAPER}"/>` + text(16, 34, title, { size: 22, weight: 800 }) + text(16, 56, subtitle, { size: 12, fill: MUTED }) + body.join("") + `</svg>`;
  mkdirSync(media, { recursive: true });
  const file = join(media, `${name}.svg`);
  writeFileSync(file, svg);
  try {
    execFileSync("qlmanage", ["-t", "-s", "1600", "-o", media, file], { stdio: "ignore" });
    if (existsSync(`${file}.png`)) renameSync(`${file}.png`, join(media, `${name}.png`));
    console.log("wrote", file, "and", `${name}.png`);
  } catch {
    console.log("wrote", file, "(no qlmanage: PNG skipped)");
  }
}

// Deterministic sample pairs.
let state = 11;
const pick = list => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return list[(state >>> 8) % list.length]; };
const randomPair = () => { const a = pick(pool); let b = pick(pool); while (b === a) b = pick(pool); return [a, b]; };

writePage("genetics-sheet", "Rare Breeds genetics", "Babies inherit whole pixel rows from both parents (DNA strip: blue rows from A, orange from B). One seed per row, shown in all four tiers.", [
  { title: "Friend #77949 × one Friend of every family", note: "Colossus has no front art: its babies are Side-walkers and show their right-facing frames from every side.",
    rows: byFamily.map((list, id) => ({ a: pinned, b: list[0], playId: 1000 + id, walkTier: id % 2 ? "prismatic" : "mutant" })) },
]);

writePage("genetics-pairs", "Rare Breeds genetics: wild pairs", "Random pairs from the 73 Friend pool. Walk strips alternate right and down facings.", [
  { title: "Random wild pairs", note: "Same row mask for all 64 frames, so the walk cycle stays coherent.",
    rows: Array.from({ length: 10 }, (_, i) => { const [a, b] = randomPair(); return { a, b, playId: 2000 + i, walkTier: TIER_ORDER[1 + (i % 3)], walkFacing: i % 2 ? "down" : "right" }; }) },
]);

const f1 = [
  hatch(pinned, byFamily[0][1], "common", 3001), hatch(pinned, byFamily[7][1], "spotted", 3002), hatch(byFamily[1][2], byFamily[8][2], "mutant", 3003),
  hatch(byFamily[5][1], byFamily[2][3], "common", 3004), hatch(pinned, byFamily[6][2], "common", 3005), hatch(byFamily[4][1], byFamily[3][2], "prismatic", 3006),
];
// One Friend's family line, as a player builds it: two F1s, their F2, a backcross and an F3.
const lines = { mask: byFamily[1][0], sparkling: byFamily[7][0], hollow: byFamily[8][0] };
const fapu = hatch(pinned, lines.mask, "common", 5001), sibo = hatch(pinned, lines.sparkling, "common", 5002);
const rimi = hatch(fapu, sibo, "common", 5003), hollowF1 = hatch(pinned, lines.hollow, "common", 5005);

writePage("genetics-f2", "Rare Breeds genetics: later generations", "F1 babies bred again. Lineage grows by one per generation; Side-walker stays dominant.", [
  { title: "Family lines: F2 and F3 labels", note: "A label names the family line each side passes on (rows traced to the Friend or wild Friend they came from); 'line' lists every family mixed in.",
    rows: [{ a: pinned, b: lines.mask, playId: 5001, line: true }, { a: pinned, b: lines.sparkling, playId: 5002, line: true },
      { a: fapu, b: sibo, playId: 5003, line: true }, { a: fapu, b: pinned, playId: 5004, line: true, walkFacing: "down" },
      { a: rimi, b: hollowF1, playId: 5006, line: true, walkTier: "prismatic" }] },
  { title: "F2: baby × baby", note: "Both parents are babies from the rows below.",
    rows: [{ a: f1[0], b: f1[1], playId: 4000 }, { a: f1[2], b: f1[3], playId: 4001 }, { a: f1[4], b: f1[5], playId: 4002, walkTier: "prismatic" },
      { a: f1[5], b: f1[2], playId: 4003, walkTier: "spotted", walkFacing: "down" }] },
  { title: "F2: baby × wild, and F3", note: "Kept babies can mate with wild Friends or their own offspring.",
    rows: [{ a: f1[0], b: byFamily[6][0], playId: 4004 }, { a: f1[3], b: pinned, playId: 4005, walkTier: "prismatic", walkFacing: "down" },
      { a: hatch(f1[0], f1[1], "mutant", 4000), b: f1[2], playId: 4006 }] },
]);
