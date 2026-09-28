// DNA lab: pick any two Friends from the pool, lock rows in the Gene Lab, hatch an egg with the game's own hatch sequence
// (src/scene/hatch.ts), then read the baby's card and trace its rows to real Friends. A demo only: nothing is kept,
// nothing is paid, and in the game parent A is your Friend.
import { breedOf } from "../../src/breeds.ts";
import { drawCreature, setupPixelCanvas } from "../../src/draw.ts";
import { isSideWalker } from "../../src/genetics.ts";
import { rowPath, rowSources } from "../../src/legacy.ts";
import { MUTED, PAPER, WHITE } from "../../src/scene/art.ts";
import { paintCreature } from "../../src/scene/creatures.ts";
import { drawText } from "../../src/scene/font.ts";
import { createHatchSequence } from "../../src/scene/hatch.ts";
import { FAMILY_NAMES } from "../../src/sprites.ts";
import type { HatchSequence } from "../../src/api.ts";
import { FACINGS, FRAME_SIZE, TIER_ORDER, TIER_STYLE, type Creature, type TierId } from "../../src/types.ts";
import { familiesOf } from "../../src/ui/collection.ts";
import { $, $$, pixelView, reducedMotion, setPressed, whileVisible } from "./core.ts";
import { mountGeneLab, rowsLabel } from "./genelab.ts";
import { hatch, lookup, randomBelow, rowCounts, type Pool } from "./pool.ts";
import { chainOf, paintTraced, pathText, sourcesText, TRACE_HINT } from "./trace.ts";

const CHANCE_BPS: Record<TierId, number> = { common: 6000, spotted: 2500, mutant: 1250, prismatic: 250 };
const ONE_IN: Record<TierId, string> = { common: "6 in 10", spotted: "1 in 4", mutant: "1 in 8", prismatic: "1 in 40" };

function rollTier(): TierId {
  let roll = randomBelow(10_000);
  for (const tier of TIER_ORDER) { if (roll < CHANCE_BPS[tier]) return tier; roll -= CHANCE_BPS[tier]; }
  return "common";
}

/** A still thumbnail of a Friend or baby (idle, facing down) on a small canvas. */
export function thumbnail(canvas: HTMLCanvasElement, creature: Creature, size = 48, scale = 2) {
  const { ctx } = setupPixelCanvas(canvas, size, size);
  ctx.clearRect(0, 0, size, size);
  drawCreature(ctx, creature, { x: size / 2, y: size / 2 + 8 * scale, scale, facing: "down", frame: 0 });
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

export function mountLab(pool: Pool, first: readonly [Creature, Creature]) {
  const section = $("#lab");
  const canvas = $<HTMLCanvasElement>("#lab-canvas");
  const skip = $<HTMLButtonElement>("#lab-skip");
  const card = $("#baby-card");
  const hatchButton = $<HTMLButtonElement>("#lab-hatch");
  const hint = $("#lab-hint");
  const slots = $$<HTMLButtonElement>(".parent-slot", section);
  const tierChips = $$<HTMLButtonElement>("[data-lab-tier]", section);
  const tabs = $(".family-tabs", section);
  const grid = $("#pool-grid");
  const geneLab = mountGeneLab($("#genelab"));

  const parents: [Creature, Creature] = [first[0], first[1]];
  let active: 0 | 1 = 1, family = -1, tierMode: TierId | "roll" = "roll";
  let play = BigInt(1 + randomBelow(1_000_000)), hatches = 0;
  let sequence: HatchSequence | null = null, busy = false, baby: Creature | null = null;

  // ---------- Idle stage: both parents waiting, before the first egg ----------
  const idle = pixelView(canvas, 960, 640);
  let showingIdle = true;
  function drawIdle() {
    if (!showingIdle) return;
    idle.sync();
    const ctx = idle.ctx;
    idle.begin(true);
    ctx.fillStyle = "#0b0b0b"; ctx.fillRect(0, 0, 960, 640);
    for (const [creature, x, color] of [[parents[0], 250, PAPER], [parents[1], 710, "#CCFF00"]] as const) {
      paintCreature(ctx, creature, { clip: "idle", facing: "down", frame: 0, x, y: 430, scale: 10 });
      drawText(ctx, creature.name.replace("Friend ", ""), x, 470, { scale: 4, color, align: "center" });
      drawText(ctx, creature.family, x, 510, { scale: 3, color: MUTED, align: "center" });
    }
    drawText(ctx, "×", 480, 300, { scale: 8, color: WHITE, align: "center" });
    drawText(ctx, "PRESS HATCH", 480, 580, { scale: 3, color: MUTED, align: "center" });
  }
  new ResizeObserver(() => drawIdle()).observe(canvas);

  // ---------- Parent slots (animated idle while the lab is on screen) ----------
  const slotViews = slots.map(slot => pixelView($<HTMLCanvasElement>("canvas", slot), 48, 48));
  function writeSlots() {
    slots.forEach((slot, i) => {
      $(".slot-name", slot).innerHTML = `${escapeHtml(parents[i].name)}<small>${escapeHtml(parents[i].family)}${parents[i].kind === "baby" ? ` · F${parents[i].lineage}` : ""}</small>`;
    });
    setPressed(slots, slot => Number(slot.dataset.slot) === active);
    hint.textContent = `Picking parent ${active ? "B" : "A"}. Tap a Friend below, or tap the other slot.`;
    for (const item of $$<HTMLElement>(".pool-item", grid)) item.setAttribute("aria-selected", String(item.dataset.id === parents[active].tokenId?.toString()));
    geneLab.setPair(parents[0], parents[1]);
    drawIdle();
  }
  slots.forEach(slot => slot.addEventListener("click", () => { active = Number(slot.dataset.slot) as 0 | 1; writeSlots(); }));

  whileVisible(section, now => {
    slotViews.forEach((view, i) => {
      view.sync();
      view.begin(true);
      paintCreature(view.ctx, parents[i], { clip: "idle", facing: "down", frame: reducedMotion() ? 0 : (Math.floor(now / 110) + i * 4) & 7, x: 24, y: 40, scale: 2, time: now });
    });
    geneLab.frame(now);
    if (baby) paintPortrait(now);
  });

  // ---------- Pool picker ----------
  const familyButtons = [-1, ...FAMILY_NAMES.map((_, i) => i)].map(id => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.setAttribute("role", "tab");
    button.textContent = id < 0 ? "All" : FAMILY_NAMES[id];
    button.addEventListener("click", () => { family = id; renderGrid(); });
    tabs.append(button);
    return { id, button };
  });
  function renderGrid() {
    for (const { id, button } of familyButtons) button.setAttribute("aria-selected", String(id === family)), button.setAttribute("aria-pressed", String(id === family));
    grid.replaceChildren(...pool.friends.filter(friend => family < 0 || friend.familyId === family).map(friend => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pool-item";
      item.dataset.id = friend.tokenId!.toString();
      item.setAttribute("role", "option");
      item.setAttribute("aria-label", `${friend.name}, ${friend.family}`);
      item.title = `${friend.name} · ${friend.family}`;
      const thumb = document.createElement("canvas");
      item.append(thumb);
      item.addEventListener("click", () => {
        parents[active] = friend;
        if (active === 0) active = 1;
        writeSlots();
      });
      requestAnimationFrame(() => thumbnail(thumb, friend, 48, 2));
      return item;
    }));
    writeSlots();
  }
  renderGrid();

  // ---------- Tier ----------
  tierChips.forEach(chip => chip.addEventListener("click", () => {
    tierMode = chip.dataset.labTier as TierId | "roll";
    setPressed(tierChips, other => other === chip);
  }));

  // ---------- Hatch ----------
  async function hatchEgg() {
    if (busy) return;
    busy = true;
    hatchButton.disabled = true;
    const [a, b] = parents;
    if (a === b) { hint.textContent = "A Friend cannot be both parents. Pick another one."; busy = false; hatchButton.disabled = false; return; }
    const tier = tierMode === "roll" ? rollTier() : tierMode;
    play += 1n;
    hatches++;
    baby = null;
    card.hidden = true;
    // The Gene Lab's locks go into breed() exactly as in the game (makeBaby in src/controller.ts).
    const next = hatch(a, b, tier, play, geneLab.locks());
    showingIdle = false;
    sequence?.destroy();
    sequence = createHatchSequence({ canvas, parentA: a, parentB: b, baby: next, reducedMotion: reducedMotion() });
    skip.hidden = false;
    // The stage sits below the picker (one column) or above the Gene Lab (two columns): bring it into view when it is not.
    const stage = $("#lab-stage"), box = stage.getBoundingClientRect();
    if (box.top < $(".nav").offsetHeight || box.bottom > innerHeight) stage.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    try { await sequence.play(); } finally {
      skip.hidden = true;
      busy = false;
      hatchButton.disabled = false;
      hatchButton.textContent = "Hatch another";
    }
    baby = next;
    renderCard(next, tier);
  }
  hatchButton.addEventListener("click", () => void hatchEgg());
  skip.addEventListener("click", () => sequence?.skip());

  // ---------- The baby's card ----------
  let portrait: ReturnType<typeof pixelView> | null = null;
  let facingIndex = 0, traced: number | null = null;
  function paintPortrait(now: number) {
    if (!portrait || !baby) return;
    portrait.sync();
    portrait.begin(true);
    const still = reducedMotion();
    if (!still && Math.floor(now / 1600) % 4 !== facingIndex) facingIndex = Math.floor(now / 1600) % 4;
    // The traced row, lit behind the walking baby (the sprite box spans y 0 to 64, 4 px a row).
    if (traced !== null) {
      portrait.ctx.fillStyle = "rgba(204, 255, 0, .7)";
      portrait.ctx.fillRect(0, traced * 4, 80, 4);
    }
    paintCreature(portrait.ctx, baby, { clip: still ? "idle" : "walk", facing: still ? "down" : FACINGS[facingIndex], frame: still ? 0 : Math.floor(now / 110) & 7, x: 40, y: 64, scale: 4, time: now });
  }

  function renderCard(creature: Creature, tier: TierId) {
    const [fromA, fromB] = rowCounts(creature);
    const breed = breedOf(familiesOf(creature));
    const traits = creature.dna?.traits ?? [];
    const style = TIER_STYLE[tier];
    const rolled = tierMode === "roll" ? `Rolled ${style.label}, ${ONE_IN[tier]}` : `Set to ${style.label}`;
    const rowSource = creature.dna?.rowSource ?? [], locks = creature.dna?.locks;
    const locked = rowSource.map((_, row) => row).filter(row => locks?.[row] === 0 || locks?.[row] === 1);
    const kept = locked.every(row => rowSource[row] === locks![row]);
    const [nameA, nameB] = creature.parents!.map(key => lookup(key)?.name ?? "?");
    traced = null;
    card.innerHTML = `
      <div class="portrait" title="Tap a row to trace it"><canvas aria-hidden="true"></canvas></div>
      <div>
        <h3>${escapeHtml(creature.name)}</h3>
        <p class="meta"><span class="tier-tag" style="background:${tier === "common" ? "#eee" : style.glow ?? style.accent}">${style.label}</span>F${creature.lineage} · ${escapeHtml(creature.family)}${breed ? ` · <b>${escapeHtml(breed.name)}</b>` : ""}</p>
        <p class="meta">${rolled} · egg #${hatches} of this visit</p>
        ${traits.length ? `<div class="traits">${traits.map(trait => `<span class="trait${/ \(from /.test(trait) ? " inherited" : ""}">${escapeHtml(trait)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="card-dna">
        <div class="dna" role="group" aria-label="DNA rows, top first: ${fromA} from parent A, ${fromB} from parent B. Pick a row to trace it.">${rowSource.map((source, row) =>
          `<button type="button" class="${source ? "b" : "a"}${locked.includes(row) ? " locked" : ""}" data-row="${row}" tabindex="${row ? -1 : 0}" aria-pressed="false"
            aria-label="Row ${row + 1}, from parent ${source ? "B" : "A"}${locked.includes(row) ? ", locked" : ""}">${locked.includes(row) ? '<svg aria-hidden="true"><use href="#i-lock"/></svg>' : ""}</button>`).join("")}</div>
        <p class="dna-note">${fromA} rows from ${escapeHtml(nameA)}, ${fromB} from ${escapeHtml(nameB)}${locked.length ? ` · <span class="dna-lock"><svg aria-hidden="true"><use href="#i-lock"/></svg>Locked ${rowsLabel(locked).toLowerCase()}${kept ? ", all inherited" : ""}</span>` : ""}</p>
        ${creature.lineage > 1 ? `<p class="dna-note dna-sources">${sourcesText(rowSources(creature, lookup))}</p>` : ""}
        <div class="trace" aria-live="polite"><p class="trace-text">${TRACE_HINT}</p></div>
      </div>
      <div class="card-actions">
        <button class="btn btn-dark btn-sm" type="button" data-card="again">Same pair, new egg</button>
        <button class="btn btn-dark btn-sm" type="button" data-card="parent">Breed with ${escapeHtml(creature.name)}</button>
      </div>`;
    card.hidden = false;
    const portraitCanvas = $<HTMLCanvasElement>(".portrait canvas", card);
    portrait = pixelView(portraitCanvas, 80, 80);
    paintPortrait(performance.now());
    wireTrace(creature, portraitCanvas);
    $("[data-card=again]", card).addEventListener("click", () => void hatchEgg());
    $("[data-card=parent]", card).addEventListener("click", () => {
      parents[0] = creature;
      active = 1;
      writeSlots();
      hint.textContent = `${creature.name} is parent A now: its babies will be F${creature.lineage + 1}. Pick parent B below.`;
      section.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    });
  }

  /** Tap, slide over or arrow through the DNA strip (or the portrait's rows) to trace a row to its real Friend. */
  function wireTrace(creature: Creature, portraitCanvas: HTMLCanvasElement) {
    const strip = $(".dna", card), trace = $(".trace", card);
    const buttons = $$<HTMLButtonElement>("button", strip);
    const sideWalker = isSideWalker(creature);
    function show(row: number) {
      if (row === traced) return;
      traced = row;
      buttons.forEach((button, i) => { button.setAttribute("aria-pressed", String(i === row)); button.tabIndex = i === row ? 0 : -1; });
      const path = rowPath(creature, row, lookup);
      if (!path) return;
      const chain = chainOf(path);
      trace.innerHTML = `<ol class="trace-chain" aria-hidden="true">${chain.map(link => `<li>${link.side === null ? "" : `<span class="trace-link"><i class="trace-${link.side ? "b" : "a"}"></i></span>`}<figure><canvas></canvas><figcaption>${escapeHtml(link.label)}</figcaption></figure></li>`).join("")}</ol>
        <p class="trace-text">${pathText(path, creature)}</p>`;
      $$<HTMLCanvasElement>("canvas", trace).forEach((canvas, i) => paintTraced(canvas, chain[i].creature, row, sideWalker));
      if (reducedMotion() && baby) paintPortrait(performance.now());
    }
    buttons.forEach((button, row) => button.addEventListener("click", () => show(row)));
    strip.addEventListener("keydown", event => {
      const at = traced ?? 0;
      const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? Math.min(FRAME_SIZE - 1, at + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? Math.max(0, at - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? FRAME_SIZE - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      show(next);
      buttons[next].focus();
    });
    // Press and slide: the strip reads across (rows left to right), the portrait down (sprite rows, 4 px each).
    const slide = (element: HTMLElement, rowAt: (event: PointerEvent) => number) => {
      let pointer: number | null = null;
      element.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        pointer = event.pointerId;
        try { element.setPointerCapture(event.pointerId); } catch { /* not an active pointer */ }
        show(rowAt(event));
      });
      element.addEventListener("pointermove", event => { if (event.pointerId === pointer) show(rowAt(event)); });
      const end = () => { pointer = null; };
      element.addEventListener("pointerup", end);
      element.addEventListener("pointercancel", end);
    };
    const clampRow = (row: number) => Math.max(0, Math.min(FRAME_SIZE - 1, Math.floor(row)));
    slide(strip, event => { const box = strip.getBoundingClientRect(); return clampRow((event.clientX - box.left) / (box.width / FRAME_SIZE)); });
    slide(portraitCanvas, event => clampRow(portrait!.toLogical(event.clientX, event.clientY).y / 4));
  }

  drawIdle();
}
