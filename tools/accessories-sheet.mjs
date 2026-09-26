// Dev tool: render the head accessories on real Friends and babies as a contact sheet.
// Run from the SDK root: node tools/accessories-sheet.mjs
// Writes games/rare-breeds/docs/media/accessories-sheet.svg and, on macOS (qlmanage), accessories-sheet.png.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESSORIES, accessoryPixels } from "../games/rare-breeds/src/accessories.ts";
import { breed, breedSeed } from "../games/rare-breeds/src/genetics.ts";
import { creatureFromRecord, FAMILY_NAMES } from "../games/rare-breeds/src/sprites.ts";
import { TIER_STYLE } from "../games/rare-breeds/src/types.ts";

const game = join(dirname(fileURLToPath(import.meta.url)), "../games/rare-breeds"), media = join(game, "docs/media");
const pool = JSON.parse(readFileSync(join(game, "data/wild-friends.json"), "utf8")).friends.map(record => creatureFromRecord(record));
const pinned = pool.find(creature => creature.tokenId === 77949n);
const byFamily = FAMILY_NAMES.map((_, id) => pool.filter(creature => creature.familyId === id && creature !== pinned));
const PAPER = "#F4F1EA", INK = "#111111", MUTED = "#8C877D", GRID = "#E6E1D6";
const S = 3, CELL_W = 20 * S, CELL_H = 24 * S; // sprite box plus accessory bounds (x -2..17, y -8..15)

function hatch(a, b, tier, playId) {
  const play = BigInt(playId), result = breed({ a, b, seed: breedSeed(77949n, a.key, b.key, play), tier, playId: play });
  return Object.freeze({ key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [a.key, b.key], dna: result.dna, playId: play });
}

/** Like drawCreature: halo under body and accessory, then body ink (tier pattern), then the accessory. */
function sprite(creature, accessory, x0, y0, { clip = "idle", facing = "down", frame = 0 } = {}) {
  const ox = x0 + 2 * S, oy = y0 + 8 * S, pixels = creature.sheet[clip][facing][frame];
  const extras = accessory ? accessoryPixels(creature.sheet, clip, facing, frame, accessory) : [];
  const pattern = creature.dna?.pattern, tier = creature.tier ?? "common", out = [];
  const rect = (x, y, w, h, fill) => out.push(`<rect x="${ox + x * S}" y="${oy + y * S}" width="${w * S}" height="${h * S}" fill="${fill}"/>`);
  for (let i = 0; i < 256; i++) if (pixels[i]) rect((i & 15) - 1, (i >> 4) - 1, 3, 3, "#fff");
  for (const cell of extras) rect(cell.x - 1, cell.y - 1, 3, 3, "#fff");
  for (let i = 0; i < 256; i++) if (pixels[i]) {
    const px = i & 15, py = i >> 4, accent = pattern && pattern[i];
    rect(px, py, 1, 1, !accent ? INK : tier === "prismatic" ? `hsl(${((px + py) * 22) % 360} 95% 58%)` : TIER_STYLE[tier].accent);
  }
  for (const cell of extras) rect(cell.x, cell.y, 1, 1, cell.color);
  return out.join("");
}

const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x, y, value, { size = 11, fill = INK, anchor = "start", weight = 400 } = {}) =>
  `<text x="${x}" y="${y}" font-family="ui-monospace, Menlo, monospace" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escape(value)}</text>`;

const LABELS = 120, VIEWS = ["down", "right", "up"], COLUMN = VIEWS.length * (CELL_W - 4) + 10;
const body = [];
let y = 70;
const section = (title, note) => {
  body.push(`<rect x="0" y="${y}" width="100%" height="1" fill="${GRID}"/>`, text(16, y + 22, title, { size: 14, weight: 700 }), text(16, y + 38, note, { size: 10, fill: MUTED }));
  y += 48;
};
const columnHeads = () => {
  ACCESSORIES.forEach((item, k) => body.push(text(LABELS + k * COLUMN + (COLUMN - 10) / 2, y + 4, item.name, { size: 11, weight: 700, anchor: "middle" })));
  y += 8;
};

/** One creature: every accessory in front (down), side (right) and back (up) idle frame 0. */
function wardrobeRow(creature, label, note) {
  body.push(text(16, y + 36, label, { weight: 700 }), text(16, y + 50, note, { size: 10, fill: MUTED }));
  ACCESSORIES.forEach((item, k) => VIEWS.forEach((facing, v) => body.push(sprite(creature, item.id, LABELS + k * COLUMN + v * (CELL_W - 4), y, { facing }))));
  y += CELL_H + 2;
}

section("The wardrobe on Friend #77949 and one Friend of every family", "Each item in front (down), side (right) and back (up) view, idle frame 0. Colossus is side-only.");
columnHeads();
wardrobeRow(pinned, "#77949", "Cellular");
byFamily.forEach((list, id) => wardrobeRow(list[0], `#${list[0].tokenId}`, FAMILY_NAMES[id]));

section("Babies", "Mutant antennae, horns and crests poke through; a Side-walker and an F2 baby too.");
columnHeads();
const babies = [
  hatch(pinned, byFamily[0][0], "mutant", 1000), hatch(pinned, byFamily[1][0], "prismatic", 1001), hatch(pinned, byFamily[4][0], "mutant", 1004),
  hatch(pinned, byFamily[6][0], "mutant", 1006),
];
babies.push(hatch(babies[0], babies[2], "prismatic", 5000));
for (const baby of babies) wardrobeRow(baby, baby.name, `${TIER_STYLE[baby.tier].label} F${baby.lineage}`);

section("Walk cycles", "The accessory follows each frame's own head through the bob and the walk, in all four facings.");
const walks = [
  [pinned, "top-hat", "walk", "down"], [pinned, "headphones", "walk", "right"], [pinned, "bow", "walk", "left"], [pinned, "crown", "walk", "up"],
  [babies[1], "party-hat", "walk", "left"], [babies[3], "halo", "walk", "right"], [byFamily[5][0], "beanie", "idle", "down"], [babies[4], "flower", "walk", "down"],
];
const STRIP = 8 * (CELL_W - 8) + LABELS + 30;
walks.forEach(([creature, accessory, clip, facing], k) => {
  const x = (k % 2) * STRIP, row = y + ((k / 2) | 0) * (CELL_H + 2);
  const name = ACCESSORIES.find(item => item.id === accessory).name;
  body.push(text(x + 16, row + 30, creature.name, { size: 10, weight: 700 }), text(x + 16, row + 44, name, { size: 10, fill: MUTED }), text(x + 16, row + 58, `${clip} ${facing}`, { size: 10, fill: MUTED }));
  for (let frame = 0; frame < 8; frame++) body.push(sprite(creature, accessory, x + LABELS + frame * (CELL_W - 8), row, { clip, facing, frame }));
});
y += Math.ceil(walks.length / 2) * (CELL_H + 2) + 10;

const size = Math.max(LABELS + ACCESSORIES.length * COLUMN + 6, 2 * STRIP, y);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
  `<rect width="100%" height="100%" fill="${PAPER}"/>` + text(16, 32, "Rare Breeds accessories", { size: 22, weight: 800 }) +
  text(16, 52, "Bought with Hearts (game points, never RF). Each frame's own head anchors the item; it never covers body ink.", { size: 11, fill: MUTED }) + body.join("") + "</svg>";
mkdirSync(media, { recursive: true });
const file = join(media, "accessories-sheet.svg");
writeFileSync(file, svg);
try {
  execFileSync("qlmanage", ["-t", "-s", String(Math.min(1800, size)), "-o", media, file], { stdio: "ignore" });
  if (existsSync(`${file}.png`)) renameSync(`${file}.png`, join(media, "accessories-sheet.png"));
  console.log("wrote", file, "and accessories-sheet.png", size, "px");
} catch {
  console.log("wrote", file, "(no qlmanage: PNG skipped)");
}
