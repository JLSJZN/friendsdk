// A 5 x 7 pixel font for in-world labels (uppercase, digits, a few symbols). Browser only.

const GLYPHS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 10001 01010 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
  "#": "01010 01010 11111 01010 11111 01010 01010", "-": "00000 00000 00000 11111 00000 00000 00000",
  "×": "00000 00000 10001 01010 00100 01010 10001", ".": "00000 00000 00000 00000 00000 01100 01100",
  "!": "00100 00100 00100 00100 00100 00000 00100", "?": "01110 10001 00001 00010 00100 00000 00100",
  ":": "00000 01100 01100 00000 01100 01100 00000", "/": "00001 00001 00010 00100 01000 10000 10000",
  "+": "00000 00100 00100 11111 00100 00100 00000", "'": "00100 00100 01000 00000 00000 00000 00000",
  ",": "00000 00000 00000 00000 01100 00100 01000", "♥": "00000 01010 11111 11111 01110 00100 00000",
  " ": "00000 00000 00000 00000 00000 00000 00000",
};

type Glyph = readonly (readonly [number, number, number])[]; // horizontal runs: x, y, length
const RUNS = new Map<string, Glyph>();
for (const [char, pattern] of Object.entries(GLYPHS)) {
  const runs: [number, number, number][] = [];
  pattern.split(" ").forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      const on = row[x] === "1";
      if (on && start < 0) start = x;
      if (!on && start >= 0) { runs.push([start, y, x - start]); start = -1; }
    }
  });
  RUNS.set(char, runs);
}

export const GLYPH_W = 5, GLYPH_H = 7;

export function textWidth(text: string, scale: number, spacing = 1) {
  const count = [...text].length;
  return count ? (count * (GLYPH_W + spacing) - spacing) * scale : 0;
}

export type TextOptions = Readonly<{
  scale: number;
  color: string;
  align?: "left" | "center" | "right";
  spacing?: number;
  /** Draws a one pixel (scaled) drop shadow / outline in this colour first. */
  shadow?: string | null;
  outline?: string | null;
  /** Optional per-character colour, e.g. for rainbow labels. */
  colorAt?: (index: number) => string;
}>;

/** Draws text with its top-left at (x, y) in the current transform. Returns the drawn width. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, options: TextOptions) {
  const { scale, color, align = "left", spacing = 1, shadow = null, outline = null, colorAt } = options;
  const upper = text.toUpperCase();
  const width = textWidth(upper, scale, spacing);
  const left = Math.round(align === "center" ? x - width / 2 : align === "right" ? x - width : x);
  const top = Math.round(y);
  const chars = [...upper];
  const paint = (dx: number, dy: number, fill: string | null) => {
    let cursor = left;
    chars.forEach((char, i) => {
      const runs = RUNS.get(char) ?? RUNS.get("?")!;
      ctx.fillStyle = fill ?? (colorAt ? colorAt(i) : color);
      for (const [rx, ry, length] of runs) ctx.fillRect(cursor + rx * scale + dx, top + ry * scale + dy, length * scale, scale);
      cursor += (GLYPH_W + spacing) * scale;
    });
  };
  if (outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) paint(dx * scale, dy * scale, outline);
  } else if (shadow) paint(0, scale, shadow);
  paint(0, 0, null);
  return width;
}
