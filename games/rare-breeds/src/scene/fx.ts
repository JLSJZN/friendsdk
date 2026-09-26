// Pixel particles: dust, hearts, confetti, sparkles, rings and shards. Logical pixel units.
import { GREEN, HEART, HEART_WHITE, INK, MUTED, WHITE, clamp, easeOutCubic } from "./art.ts";

type Base = { x: number; y: number; vx: number; vy: number; age: number; life: number; delay: number };
export type Particle =
  | (Base & { kind: "dust"; size: number })
  | (Base & { kind: "heart"; px: number; white: boolean; sway: number })
  | (Base & { kind: "confetti"; color: string; size: number; spin: number; spinSpeed: number; gravity: number })
  | (Base & { kind: "sparkle"; px: number; color: string })
  | (Base & { kind: "ring"; radius: number; color: string; px: number })
  | (Base & { kind: "square"; color: string; size: number; gravity: number; outline: string | null });

export type Layer = "floor" | "top";

export function createParticles() {
  const floor: Particle[] = [], top: Particle[] = [];
  const random = Math.random;

  const add = (layer: Layer, particle: Particle) => { (layer === "floor" ? floor : top).push(particle); return particle; };
  const base = (x: number, y: number, life: number, delay = 0): Base => ({ x, y, vx: 0, vy: 0, age: 0, life, delay });

  return {
    get count() { return floor.length + top.length; },
    clear() { floor.length = 0; top.length = 0; },
    dust(x: number, y: number, direction = 0, size = 1) {
      for (let i = 0; i < 2; i++) {
        const p = add("floor", { ...base(x + (random() - 0.5) * 10, y - 2, 380 + random() * 180), kind: "dust", size: size * (0.8 + random() * 0.5) });
        p.vx = -direction * (20 + random() * 30) + (random() - 0.5) * 30;
        p.vy = -8 - random() * 14;
      }
    },
    puff(x: number, y: number, count = 8, spread = 34) {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + random() * 0.4;
        const p = add("floor", { ...base(x, y - 3, 420 + random() * 200), kind: "dust", size: 1.2 + random() * 0.6 });
        p.vx = Math.cos(angle) * spread * 2.2; p.vy = Math.sin(angle) * spread * 0.8;
      }
    },
    hearts(x: number, y: number, count: number, spread = 28, delayStep = 110) {
      for (let i = 0; i < count; i++) {
        const p = add("top", { ...base(x + (random() - 0.5) * spread, y, 900 + random() * 400, i * delayStep), kind: "heart", px: random() < 0.35 ? 2 : 3, white: random() < 0.3, sway: random() * Math.PI * 2 });
        p.vx = (random() - 0.5) * 30; p.vy = -70 - random() * 50;
      }
    },
    bigHeart(x: number, y: number, delay = 0) {
      add("top", { ...base(x, y, 1100, delay), kind: "heart", px: 5, white: false, sway: -1 });
    },
    confetti(x: number, y: number, colors: readonly string[], count = 42, power = 1, size = 6) {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (random() - 0.5) * Math.PI * 1.25;
        const speed = (180 + random() * 260) * power;
        const p = add("top", {
          ...base(x + (random() - 0.5) * 12, y + (random() - 0.5) * 12, 1100 + random() * 700), kind: "confetti",
          color: colors[i % colors.length], size: Math.round(size * (random() < 0.3 ? 1.4 : 1)), spin: random() * Math.PI * 2, spinSpeed: 6 + random() * 10, gravity: 520,
        });
        p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
      }
    },
    sparkles(x: number, y: number, count: number, radius: number, color = GREEN, px = 3, delayStep = 60) {
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2, distance = radius * (0.4 + random() * 0.6);
        const p = add("top", { ...base(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 520 + random() * 260, i * delayStep), kind: "sparkle", px, color });
        p.vy = -16;
      }
    },
    ring(x: number, y: number, radius: number, color = INK, px = 3, life = 380, delay = 0) {
      add("top", { ...base(x, y, life, delay), kind: "ring", radius, color, px });
    },
    squares(x: number, y: number, count: number, colors: readonly string[], speed = 260, outline: string | null = INK, life = 900) {
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2, velocity = speed * (0.4 + random() * 0.8);
        const p = add("top", { ...base(x, y, life * (0.7 + random() * 0.5)), kind: "square", color: colors[i % colors.length], size: random() < 0.4 ? 6 : 4, gravity: 600, outline });
        p.vx = Math.cos(angle) * velocity; p.vy = Math.sin(angle) * velocity - speed * 0.5;
      }
    },
    update(dt: number) {
      const seconds = dt / 1000;
      for (const list of [floor, top]) {
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          if (p.delay > 0) { p.delay -= dt; continue; }
          p.age += dt;
          if (p.age >= p.life) { list.splice(i, 1); continue; }
          if (p.kind === "confetti") {
            p.vy += p.gravity * seconds; p.vx *= Math.exp(-2.4 * seconds); p.vy *= Math.exp(-1.6 * seconds);
            p.spin += p.spinSpeed * seconds;
          } else if (p.kind === "square") {
            p.vy += p.gravity * seconds; p.vx *= Math.exp(-1.5 * seconds);
          } else if (p.kind === "dust") {
            p.vx *= Math.exp(-5 * seconds); p.vy *= Math.exp(-5 * seconds);
          } else if (p.kind === "heart") {
            p.vx *= Math.exp(-2 * seconds);
          }
          p.x += p.vx * seconds; p.y += p.vy * seconds;
        }
      }
    },
    draw(ctx: CanvasRenderingContext2D, layer: Layer) {
      for (const p of layer === "floor" ? floor : top) {
        if (p.delay > 0) continue;
        const t = p.age / p.life;
        drawParticle(ctx, p, t);
      }
    },
  };
}

const snap = (value: number, step: number) => Math.round(value / step) * step;

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, t: number) {
  switch (p.kind) {
    case "dust": {
      const r = Math.max(1, Math.round((1 + 2.2 * easeOutCubic(t)) * p.size * (1 - t * 0.5)));
      const x = snap(p.x, 3), y = snap(p.y, 3);
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = MUTED;
      ctx.fillRect(x - r * 3, y - r * 3 + 3, r * 6, r * 6 - 6);
      ctx.fillRect(x - r * 3 + 3, y - r * 3, r * 6 - 6, r * 6);
      ctx.fillStyle = WHITE;
      ctx.fillRect(x - r * 3 + 3, y - r * 3 + 3, r * 6 - 6, r * 6 - 6);
      ctx.globalAlpha = 1;
      break;
    }
    case "heart": {
      const sprite = p.white ? HEART_WHITE : HEART;
      let px = p.px, x = p.x, y = p.y;
      if (p.sway < 0) {
        // Big heart: pops in with overshoot, holds, then floats and fades.
        const pop = t < 0.18 ? t / 0.18 : 1;
        px = Math.max(1, Math.round(p.px * (pop < 1 ? 0.4 + 0.9 * Math.sin(pop * Math.PI * 0.6) : 1)));
        y = p.y - (t > 0.55 ? (t - 0.55) * 60 : 0);
      } else {
        x += Math.sin(p.age / 160 + p.sway) * 6;
      }
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.drawImage(sprite, Math.round(x - (sprite.width * px) / 2), Math.round(y - sprite.height * px), sprite.width * px, sprite.height * px);
      ctx.globalAlpha = 1;
      break;
    }
    case "confetti": {
      const w = Math.max(2, Math.round(Math.abs(Math.cos(p.spin)) * p.size)), h = Math.round(p.size * (0.8 + 0.4 * Math.abs(Math.sin(p.spin * 0.7))));
      ctx.globalAlpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
      ctx.globalAlpha = 1;
      break;
    }
    case "sparkle": {
      const phase = Math.sin(clamp(t) * Math.PI);
      const size = Math.round(phase * 2) + 1;
      const x = snap(p.x, p.px), y = snap(p.y, p.px), u = p.px;
      ctx.fillStyle = INK;
      ctx.fillRect(x - u * size - u, y - u, (size * 2 + 3) * u, u * 3);
      ctx.fillRect(x - u, y - u * size - u, u * 3, (size * 2 + 3) * u);
      ctx.fillStyle = p.color;
      ctx.fillRect(x - u * size, y, (size * 2 + 1) * u, u);
      ctx.fillRect(x, y - u * size, u, (size * 2 + 1) * u);
      break;
    }
    case "ring": {
      const r = p.radius * easeOutCubic(t);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      const steps = Math.max(12, Math.round(r / 2));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        ctx.fillRect(snap(p.x + Math.cos(a) * r, p.px) - p.px / 2, snap(p.y + Math.sin(a) * r * 0.9, p.px) - p.px / 2, p.px, p.px);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "square": {
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      const x = Math.round(p.x - p.size / 2), y = Math.round(p.y - p.size / 2);
      if (p.outline) { ctx.fillStyle = p.outline; ctx.fillRect(x - 2, y - 2, p.size + 4, p.size + 4); }
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, p.size, p.size);
      ctx.globalAlpha = 1;
      break;
    }
  }
}

