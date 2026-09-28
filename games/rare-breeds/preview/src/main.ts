// Rare Breeds preview page: boots each section once the Friend pool has loaded. No wallet, no RF, nothing saved.
import { mountBase } from "./base.ts";
import { mountBook, mountTierCards } from "./book.ts";
import { $, $$, reducedMotion, revealOnScroll } from "./core.ts";
import { mountHero } from "./hero.ts";
import { mountLab } from "./lab.ts";
import { allTiers, loadPool } from "./pool.ts";
import { mountSling } from "./sling.ts";
import { mountStory } from "./story.ts";

/** Julius's Friend (pinned in the pool) plays "your Friend"; its intro mate from the game plays the wild Friend. */
const FRIEND_ID = 77949n, MATE_ID = 190688n;

async function boot() {
  const pool = await loadPool();
  const friend = pool.get(FRIEND_ID), mate = pool.get(MATE_ID);
  const babies = allTiers(friend, mate);
  const brood = [Object.freeze({ ...babies.common, accessory: "party-hat" as const }), babies.prismatic, babies.spotted];
  const mounts: [string, () => void][] = [
    ["hero", () => mountHero($<HTMLCanvasElement>("#hero-canvas"), friend, brood)],
    ["story", () => mountStory(pool, friend, mate)],
    ["nursery", () => mountBase(friend, [brood[0], brood[1]])],
    ["lab", () => mountLab(pool, [friend, mate])],
    ["slingshot", () => mountSling(friend, babies)],
    ["book", () => mountBook(pool)],
    ["rules", () => mountTierCards(babies)],
  ];
  for (const [name, mount] of mounts) {
    try { mount(); } catch (error) { console.error(`The ${name} section could not start.`, error); }
  }
  revealOnScroll($$(".section-head, .video-frame, .tier-row, .facts, .checks"));
  autoplayTrailer($<HTMLVideoElement>("#trailer-video"));
}

/** The trailer plays muted while it is on screen (never with reduced motion) and pauses when it leaves. */
function autoplayTrailer(video: HTMLVideoElement) {
  let touched = false;
  video.addEventListener("pointerdown", () => { touched = true; });
  video.addEventListener("keydown", () => { touched = true; });
  new IntersectionObserver(([entry]) => {
    if (touched || reducedMotion()) return;
    if (entry.isIntersecting) { video.muted = true; void video.play().catch(() => {}); } else video.pause();
  }, { threshold: 0.5 }).observe(video);
}

boot().catch(error => {
  console.error(error);
  document.documentElement.classList.add("no-js");
});
