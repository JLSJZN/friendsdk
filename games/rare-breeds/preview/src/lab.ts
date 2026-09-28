// DNA lab: pick any two Friends from the pool, hatch an egg with the game's own hatch sequence (src/scene/hatch.ts),
// then read the baby's card. A demo only: nothing is kept, nothing is paid, and in the game parent A is your Friend.
import { breedOf } from "../../src/breeds.ts";
import { drawCreature, setupPixelCanvas } from "../../src/draw.ts";
import { MUTED, PAPER, WHITE } from "../../src/scene/art.ts";
import { paintCreature } from "../../src/scene/creatures.ts";
import { drawText } from "../../src/scene/font.ts";
import { createHatchSequence } from "../../src/scene/hatch.ts";
import { FAMILY_NAMES } from "../../src/sprites.ts";
import type { HatchSequence } from "../../src/api.ts";
import { FACINGS, TIER_ORDER, TIER_STYLE, type Creature, type TierId } from "../../src/types.ts";
import { familiesOf } from "../../src/ui/collection.ts";
import { $, $$, pixelView, reducedMotion, setPressed, whileVisible } from "./core.ts";
import { hatch, randomBelow, rowCounts, type Pool } from "./pool.ts";

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
    drawIdle();
  }
  slots.forEach(slot => slot.addEventListener("click", () => { active = Number(slot.dataset.slot) as 0 | 1; writeSlots(); }));

  whileVisible(section, now => {
    slotViews.forEach((view, i) => {
      view.sync();
      view.begin(true);
      paintCreature(view.ctx, parents[i], { clip: "idle", facing: "down", frame: reducedMotion() ? 0 : (Math.floor(now / 110) + i * 4) & 7, x: 24, y: 40, scale: 2, time: now });
    });
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
    const next = hatch(a, b, tier, play);
    showingIdle = false;
    sequence?.destroy();
    sequence = createHatchSequence({ canvas, parentA: a, parentB: b, baby: next, reducedMotion: reducedMotion() });
    skip.hidden = false;
    // One column (phones, tablets): the stage sits below the picker, so bring it into view.
    if (matchMedia("(max-width: 1080px)").matches) $("#lab-stage").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
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
  let facingIndex = 0;
  function paintPortrait(now: number) {
    if (!portrait || !baby) return;
    portrait.sync();
    portrait.begin(true);
    const still = reducedMotion();
    if (!still && Math.floor(now / 1600) % 4 !== facingIndex) facingIndex = Math.floor(now / 1600) % 4;
    paintCreature(portrait.ctx, baby, { clip: still ? "idle" : "walk", facing: still ? "down" : FACINGS[facingIndex], frame: still ? 0 : Math.floor(now / 110) & 7, x: 40, y: 64, scale: 4, time: now });
  }

  function renderCard(creature: Creature, tier: TierId) {
    const [fromA, fromB] = rowCounts(creature);
    const breed = breedOf(familiesOf(creature));
    const traits = creature.dna?.traits ?? [];
    const style = TIER_STYLE[tier];
    const rolled = tierMode === "roll" ? `Rolled ${style.label}, ${ONE_IN[tier]}` : `Set to ${style.label}`;
    card.innerHTML = `
      <div class="portrait"><canvas aria-hidden="true"></canvas></div>
      <div>
        <h3>${escapeHtml(creature.name)}</h3>
        <p class="meta"><span class="tier-tag" style="background:${tier === "common" ? "#eee" : style.glow ?? style.accent}">${style.label}</span>F${creature.lineage} · ${escapeHtml(creature.family)}${breed ? ` · <b>${escapeHtml(breed.name)}</b>` : ""}</p>
        <p class="meta">${rolled} · egg #${hatches} of this visit</p>
        <div class="dna" aria-label="DNA: ${fromA} rows from parent A, ${fromB} from parent B">${(creature.dna?.rowSource ?? []).map(source => `<span class="${source ? "b" : "a"}"></span>`).join("")}</div>
        <p class="dna-note">${fromA} rows from ${escapeHtml(parents[0].name)}, ${fromB} from ${escapeHtml(parents[1].name)}</p>
        ${traits.length ? `<div class="traits">${traits.map(trait => `<span class="trait${/ \(from /.test(trait) ? " inherited" : ""}">${escapeHtml(trait)}</span>`).join("")}</div>` : ""}
        <div class="card-actions">
          <button class="btn btn-dark btn-sm" type="button" data-card="again">Same pair, new egg</button>
          <button class="btn btn-dark btn-sm" type="button" data-card="parent">Breed with ${escapeHtml(creature.name)}</button>
        </div>
      </div>`;
    card.hidden = false;
    portrait = pixelView($<HTMLCanvasElement>(".portrait canvas", card), 80, 80);
    paintPortrait(performance.now());
    $("[data-card=again]", card).addEventListener("click", () => void hatchEgg());
    $("[data-card=parent]", card).addEventListener("click", () => {
      parents[0] = creature;
      active = 1;
      writeSlots();
      hint.textContent = `${creature.name} is parent A now: its babies will be F${creature.lineage + 1}. Pick parent B below.`;
      section.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    });
  }

  drawIdle();
}
