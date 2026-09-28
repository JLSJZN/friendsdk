// The breed book (src/breeds.ts): the 45 family pairs as a triangle, each named. Hovering or tapping a square breeds
// that pair from the pool's first Friend of each family and walks the baby in the preview. Also the rule cards.
import { BREEDS } from "../../src/breeds.ts";
import { paintCreature } from "../../src/scene/creatures.ts";
import { FAMILY_NAMES } from "../../src/sprites.ts";
import { FACINGS, TIER_ORDER, type Creature, type TierId } from "../../src/types.ts";
import { $, $$, pixelView, reducedMotion, whileVisible } from "./core.ts";
import { thumbnail } from "./lab.ts";
import { hatch, type Pool } from "./pool.ts";

export function mountBook(pool: Pool) {
  const matrix = $("#book-matrix");
  const preview = $("#book-preview");
  const name = $("#book-name"), pair = $("#book-pair");
  const reps = pool.byFamily.map(list => list[0]);
  const view = pixelView($<HTMLCanvasElement>("#book-canvas"), 320, 240);
  let current: { a: Creature; b: Creature; baby: Creature } | null = null;
  const heads: HTMLElement[][] = [[], []];

  const head = (family: number, axis: 0 | 1) => {
    const cell = document.createElement("div");
    cell.className = `book-head${axis ? " is-row" : ""}`;
    cell.setAttribute("role", axis ? "rowheader" : "columnheader");
    cell.setAttribute("aria-label", FAMILY_NAMES[family]);
    cell.title = FAMILY_NAMES[family];
    const canvas = document.createElement("canvas");
    cell.append(canvas);
    requestAnimationFrame(() => thumbnail(canvas, reps[family], 48, 2));
    heads[axis][family] = cell;
    return cell;
  };

  const cells: HTMLButtonElement[] = [];
  const corner = document.createElement("div");
  corner.className = "book-corner";
  matrix.append(corner, ...FAMILY_NAMES.map((_, i) => head(i, 0)));
  for (let row = 0; row < FAMILY_NAMES.length; row++) {
    matrix.append(head(row, 1));
    for (let col = 0; col < FAMILY_NAMES.length; col++) {
      if (col < row) { const empty = document.createElement("div"); empty.className = "book-empty"; matrix.append(empty); continue; }
      const breed = BREEDS.find(item => item.families[0] === FAMILY_NAMES[row] && item.families[1] === FAMILY_NAMES[col])!;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `book-cell${row === col ? " pure" : ""}`;
      button.textContent = breed.name;
      button.setAttribute("aria-label", `${breed.name}: ${breed.families[0]} × ${breed.families[1]}`);
      const pick = () => select(row, col, button);
      button.addEventListener("mouseenter", pick);
      button.addEventListener("focus", pick);
      button.addEventListener("click", pick);
      cells.push(button);
      matrix.append(button);
    }
  }

  function select(row: number, col: number, button: HTMLButtonElement) {
    const breed = BREEDS.find(item => item.families[0] === FAMILY_NAMES[row] && item.families[1] === FAMILY_NAMES[col])!;
    // A purebred needs two Friends of the same family.
    const a = reps[row], b = row === col ? pool.byFamily[col][1] : reps[col];
    current = { a, b, baby: hatch(a, b, "common") };
    name.textContent = breed.name;
    pair.textContent = `${breed.families[0]} × ${breed.families[1]}`;
    for (const cell of cells) cell.setAttribute("aria-selected", String(cell === button));
    heads.forEach(list => list.forEach((cell, i) => cell.classList.toggle("is-lit", i === row || i === col)));
  }
  const skeleton = FAMILY_NAMES.indexOf("Skeleton"), hollow = FAMILY_NAMES.indexOf("Hollow");
  select(skeleton, hollow, cells.find(cell => cell.textContent === "Ghost Bones")!);

  whileVisible(preview, now => {
    if (!current) return;
    view.sync();
    view.begin(true);
    const still = reducedMotion(), frame = still ? 0 : Math.floor(now / 110) & 7;
    const facing = still ? "down" : FACINGS[Math.floor(now / 1800) % 4];
    paintCreature(view.ctx, current.a, { clip: "idle", facing: "down", frame, x: 52, y: 200, scale: 3, time: now });
    paintCreature(view.ctx, current.b, { clip: "idle", facing: "down", frame: (frame + 4) & 7, x: 268, y: 200, scale: 3, time: now });
    paintCreature(view.ctx, current.baby, { clip: still ? "idle" : "walk", facing, frame, x: 160, y: 196, scale: 8, time: now });
  });
}

/** The four tier cards under the rules: the same egg of the story's pair in every tier. */
export function mountTierCards(babies: Readonly<Record<TierId, Creature>>) {
  const cards = $$("#tier-row .tier-card");
  const views = cards.map(card => pixelView($<HTMLCanvasElement>("canvas", card), 160, 120));
  whileVisible($("#tier-row"), now => {
    const still = reducedMotion();
    views.forEach((view, i) => {
      const tier = TIER_ORDER[i];
      view.sync();
      view.begin(true);
      paintCreature(view.ctx, babies[tier], { clip: "idle", facing: "down", frame: still ? 0 : (Math.floor(now / 110) + i * 2) & 7, x: 80, y: 104, scale: 5, time: still ? 0 : now });
    });
  });
}
